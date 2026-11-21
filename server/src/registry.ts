import { describeTemplate, type PlainEnglish } from './describe.js';
import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { CHECKER_VERSION, hasNoFailures, MAX_TEMPLATE_BYTES, runAudit, type AuditReport, type CheckResult } from './audit/index.js';
import { deriveBadge, type Badge } from './badges.js';
import { loadCategories, normalizeCategories, setCategoriesIfEmpty } from './categories.js';
import type { Db } from './db.js';
import { loadRatings, type RatingStats } from './user-reviews.js';
import { resolveNames } from './user-names.js';
import { loadTemplateNames, type TemplateName } from './publisher-names.js';
import { evaluatePolicy, type Policy, type PolicyDecision } from './policy.js';

export class RegistryError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
    }
}

export interface AuditCounts {
    pass: number;
    warn: number;
    fail: number;
    skipped: number;
}

export interface TemplateSummary {
    identifier: string;
    name: string;
    description: string;
    publisher: string;
    /** The name an admin registered for the publisher's address, or null. */
    publisherName: string | null;
    createdAt: string;
    badge: Badge;
    openFlags: number;
    reviewCount: number;
    /** Wallet-signed community reviews (hidden ones excluded) and their mean rating, one decimal. */
    userReviewCount: number;
    averageRating: number | null;
    removed: boolean;
    removedReason: string | null;
    /** Category names (see categories.ts), in display order. A template can be in several. */
    categories: string[];
    audit: { checkerVersion: string; counts: AuditCounts } | null;
}

export interface TemplateDetail extends TemplateSummary {
    /** Parsed canonical template JSON (extended-JSON encoded values stay as strings). Null when removed. */
    template: unknown;
    auditReport: AuditReport | null;
    actions: { id: string; name: string; description: string; roles: string[] }[];
    roles: { id: string; name: string; description: string }[];
    flags: { id: number; reason: string; reporter: string; status: string; createdAt: string }[];
    reviews: { id: number; reviewerAddress: string; note: string; createdAt: string }[];
    /** What the template does, restated in plain English from its own fields. Null when removed. */
    plainEnglish: PlainEnglish | null;
}

export interface ListParameters {
    query?: string;
    badge?: Badge;
    category?: string;
    sort?: 'newest' | 'name' | 'flagged' | 'rating';
    page?: number;
    pageSize?: number;
    includeRemoved?: boolean;
}

export interface ListResult {
    items: TemplateSummary[];
    total: number;
    page: number;
    pageSize: number;
}

const now = (): string => new Date().toISOString();

function countResults(results: CheckResult[]): AuditCounts {
    const counts: AuditCounts = { pass: 0, warn: 0, fail: 0, skipped: 0 };

    for (const result of results) {
        counts[result.status] += 1;
    }

    return counts;
}

/**
 * Publishes a template. The identifier is always recomputed by the server from the canonical (parsed) form, so the
 * same template cannot be stored twice under different key orders. Publishing an existing template returns it.
 */
export async function publishTemplate(
    db: Db,
    input: unknown,
    publisher: string,
    categories: unknown = [],
): Promise<{ identifier: string; created: boolean; badge: Badge; categories: string[] }> {
    const chosenCategories = normalizeCategories(categories);
    const rawText = typeof input === 'string' ? input : safeStringify(input);

    if (Buffer.byteLength(rawText, 'utf8') > MAX_TEMPLATE_BYTES) {
        throw new RegistryError(`Template is larger than the ${MAX_TEMPLATE_BYTES} byte limit.`, 413);
    }

    let parsed: ReturnType<typeof parseTemplate>;

    try {
        parsed = parseTemplate(typeof input === 'string' ? input : (input as never));
    } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);

        throw new RegistryError(`Not a valid XO template: ${message}`, 400);
    }

    const identifier = generateTemplateIdentifier(parsed);
    const json = serializeTemplate(parsed);
    let submittedIdentifier: string | undefined;

    try {
        submittedIdentifier = typeof input === 'string' ? undefined : generateTemplateIdentifier(input as never);
    } catch {
        submittedIdentifier = undefined;
    }

    const existing = await db.selectFrom('templates').select('identifier').where('identifier', '=', identifier).executeTakeFirst();

    if (existing) {
        const summary = await getSummary(db, identifier);

        // Someone re-publishing a template can file it only if nobody has yet; they cannot re-file it afterwards.
        return { identifier, created: false, badge: summary?.badge ?? 'unchecked', categories: await setCategoriesIfEmpty(db, identifier, chosenCategories) };
    }

    const template = parsed as unknown as { name?: unknown; description?: unknown };

    await db
        .insertInto('templates')
        .values({
            identifier,
            name: typeof template.name === 'string' ? template.name.slice(0, 200) : identifier.slice(0, 12),
            description: typeof template.description === 'string' ? template.description.slice(0, 2000) : '',
            json,
            publisher: publisher.slice(0, 64),
            created_at: now(),
            removed: 0,
            removed_reason: null,
        })
        .execute();

    await recordAudit(db, identifier, json, submittedIdentifier);

    const filedUnder = await setCategoriesIfEmpty(db, identifier, chosenCategories);
    const summary = await getSummary(db, identifier);

    return { identifier, created: true, badge: summary?.badge ?? 'unchecked', categories: filedUnder };
}

/** Runs the audit for a stored template and stores a new report row. */
export async function recordAudit(db: Db, identifier: string, json: string, submittedIdentifier?: string): Promise<AuditReport> {
    const report = runAudit({ storedJson: json, storedIdentifier: identifier, submittedIdentifier });

    await db
        .insertInto('audit_reports')
        .values({
            identifier,
            checker_version: report.checkerVersion,
            results_json: JSON.stringify(report.results),
            created_at: now(),
        })
        .execute();

    return report;
}

/** Re-runs the audit for every stored template. Returns the number of templates audited. */
export async function reauditAll(db: Db): Promise<number> {
    const rows = await db.selectFrom('templates').select(['identifier', 'json']).execute();

    for (const row of rows) {
        await recordAudit(db, row.identifier, row.json);
    }

    return rows.length;
}

/**
 * Re-runs the audit only for templates whose latest report came from an older checker version (or that have none).
 * Safe to run on every start: once reports are current it does nothing. Returns how many templates were re-audited.
 */
export async function reauditStale(db: Db): Promise<number> {
    const latest = new Map<string, string>();

    for (const row of await db.selectFrom('audit_reports').select(['identifier', 'checker_version']).orderBy('id', 'asc').execute()) {
        latest.set(row.identifier, row.checker_version);
    }

    const rows = await db.selectFrom('templates').select(['identifier', 'json']).execute();
    let count = 0;

    for (const row of rows) {
        if (latest.get(row.identifier) !== CHECKER_VERSION) {
            await recordAudit(db, row.identifier, row.json);
            count += 1;
        }
    }

    return count;
}

interface Enrichment {
    reports: Map<string, { checkerVersion: string; results: CheckResult[] }>;
    reviews: Map<string, number>;
    openFlags: Map<string, number>;
    ratings: Map<string, RatingStats>;
    categories: Map<string, string[]>;
    /** Registered display names, keyed by publisher address. */
    names: Map<string, string>;
    /** A name given to one template: typed by its publisher or set by a moderator. */
    templateNames: Map<string, TemplateName>;
}

async function loadEnrichment(db: Db, publishers: Iterable<string>): Promise<Enrichment> {
    const reports = new Map<string, { checkerVersion: string; results: CheckResult[] }>();
    const reportRows = await db.selectFrom('audit_reports').selectAll().orderBy('id', 'asc').execute();

    for (const row of reportRows) {
        // Rows are ordered oldest to newest, so the last write for an identifier is the latest report.
        reports.set(row.identifier, { checkerVersion: row.checker_version, results: JSON.parse(row.results_json) as CheckResult[] });
    }

    const reviews = new Map<string, number>();

    for (const row of await db.selectFrom('reviews').select('identifier').execute()) {
        reviews.set(row.identifier, (reviews.get(row.identifier) ?? 0) + 1);
    }

    const openFlags = new Map<string, number>();

    for (const row of await db.selectFrom('flags').select('identifier').where('status', '=', 'open').execute()) {
        openFlags.set(row.identifier, (openFlags.get(row.identifier) ?? 0) + 1);
    }

    return { reports, reviews, openFlags, ratings: await loadRatings(db), categories: await loadCategories(db), names: await resolveNames(db, publishers), templateNames: await loadTemplateNames(db) };
}

type TemplateRow = {
    identifier: string;
    name: string;
    description: string;
    publisher: string;
    created_at: string;
    removed: number;
    removed_reason: string | null;
};

function publisherNameOf(row: TemplateRow, enrichment: Enrichment): string | null {
    const own = enrichment.templateNames.get(row.identifier);

    if (own?.setBy === 'admin') {
        return own.name;
    }

    return enrichment.names.get(row.publisher) ?? own?.name ?? null;
}

function toSummary(row: TemplateRow, enrichment: Enrichment): TemplateSummary {
    const report = enrichment.reports.get(row.identifier);
    const reviewCount = enrichment.reviews.get(row.identifier) ?? 0;

    return {
        identifier: row.identifier,
        name: row.name,
        description: row.description,
        publisher: row.publisher,
        // A moderator's name for this template wins, then the name registered for the wallet, then what the publisher typed.
        publisherName: publisherNameOf(row, enrichment),
        createdAt: row.created_at,
        badge: deriveBadge({
            hasReport: report !== undefined,
            reportHasNoFailures: report ? hasNoFailures(report) : false,
            reviewCount,
        }),
        openFlags: enrichment.openFlags.get(row.identifier) ?? 0,
        reviewCount,
        userReviewCount: enrichment.ratings.get(row.identifier)?.count ?? 0,
        averageRating: enrichment.ratings.get(row.identifier)?.average ?? null,
        removed: row.removed === 1,
        removedReason: row.removed_reason,
        categories: enrichment.categories.get(row.identifier) ?? [],
        audit: report ? { checkerVersion: report.checkerVersion, counts: countResults(report.results) } : null,
    };
}

const SUMMARY_COLUMNS = ['identifier', 'name', 'description', 'publisher', 'created_at', 'removed', 'removed_reason'] as const;

export async function getSummary(db: Db, identifier: string): Promise<TemplateSummary | undefined> {
    const row = await db.selectFrom('templates').select(SUMMARY_COLUMNS).where('identifier', '=', identifier).executeTakeFirst();

    return row ? toSummary(row, await loadEnrichment(db, [row.publisher])) : undefined;
}

/** Lists and searches templates. Filtering and sorting happen in memory, which is fine at hackathon scale. */
export async function listTemplates(db: Db, parameters: ListParameters = {}): Promise<ListResult> {
    const rows = await db.selectFrom('templates').select(SUMMARY_COLUMNS).execute();
    const enrichment = await loadEnrichment(db, rows.map((row) => row.publisher));
    const query = parameters.query?.trim().toLowerCase();
    let items = rows.map((row) => toSummary(row, enrichment));

    if (!parameters.includeRemoved) {
        items = items.filter((item) => !item.removed);
    }

    if (query) {
        items = items.filter(
            (item) =>
                item.name.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query) ||
                (item.publisherName?.toLowerCase().includes(query) ?? false) ||
                item.identifier.startsWith(query),
        );
    }

    if (parameters.badge) {
        items = items.filter((item) => item.badge === parameters.badge);
    }

    if (parameters.category) {
        items = items.filter((item) => item.categories.includes(parameters.category!));
    }

    const sort = parameters.sort ?? 'newest';

    items.sort((a, b) => {
        if (sort === 'name') {
            return a.name.localeCompare(b.name);
        }

        if (sort === 'rating') {
            // Rated templates first (best average, then most reviews); unrated ones keep name order at the end.
            return (b.averageRating ?? -1) - (a.averageRating ?? -1) || b.userReviewCount - a.userReviewCount || a.name.localeCompare(b.name);
        }

        if (sort === 'flagged') {
            return b.openFlags - a.openFlags || a.name.localeCompare(b.name);
        }

        return b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name);
    });

    const pageSize = Math.min(Math.max(parameters.pageSize ?? 12, 1), 50);
    const page = Math.max(parameters.page ?? 1, 1);

    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

export async function getTemplateDetail(db: Db, identifier: string): Promise<TemplateDetail | undefined> {
    const row = await db.selectFrom('templates').selectAll().where('identifier', '=', identifier).executeTakeFirst();

    if (!row) {
        return undefined;
    }

    const enrichment = await loadEnrichment(db, [row.publisher]);
    const summary = toSummary(row, enrichment);
    const report = enrichment.reports.get(identifier);
    const flagRows = await db.selectFrom('flags').selectAll().where('identifier', '=', identifier).orderBy('id', 'desc').execute();
    const reviewRows = await db.selectFrom('reviews').selectAll().where('identifier', '=', identifier).orderBy('id', 'desc').execute();
    const parsed = summary.removed ? undefined : (JSON.parse(row.json) as Record<string, unknown>);
    const roles = (parsed?.roles ?? {}) as Record<string, { name?: string; description?: string }>;
    const actions = (parsed?.actions ?? {}) as Record<string, { name?: string; description?: string; roles?: Record<string, unknown> }>;

    return {
        ...summary,
        template: parsed ?? null,
        plainEnglish: parsed ? describeTemplate(parsed) : null,
        auditReport: report ? { checkerVersion: report.checkerVersion, results: report.results } : null,
        actions: Object.entries(actions).map(([id, action]) => ({
            id,
            name: action.name ?? id,
            description: action.description ?? '',
            roles: Object.keys(action.roles ?? {}),
        })),
        roles: Object.entries(roles).map(([id, role]) => ({ id, name: role.name ?? id, description: role.description ?? '' })),
        flags: flagRows.map((flag) => ({
            id: flag.id,
            reason: flag.reason,
            reporter: flag.reporter,
            status: flag.status,
            createdAt: flag.created_at,
        })),
        reviews: reviewRows.map((review) => ({
            id: review.id,
            reviewerAddress: review.reviewer_address,
            note: review.note,
            createdAt: review.created_at,
        })),
    };
}

export async function addFlag(db: Db, identifier: string, reason: unknown, reporter: unknown): Promise<{ id: number }> {
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) {
        throw new RegistryError('A flag needs a reason of 3 to 500 characters.', 400);
    }

    if (reporter !== undefined && (typeof reporter !== 'string' || reporter.length > 64)) {
        throw new RegistryError('Reporter must be text of at most 64 characters.', 400);
    }

    const template = await db.selectFrom('templates').select('identifier').where('identifier', '=', identifier).executeTakeFirst();

    if (!template) {
        throw new RegistryError('Template not found.', 404);
    }

    const result = await db
        .insertInto('flags')
        .values({
            identifier,
            reason: reason.trim(),
            reporter: (typeof reporter === 'string' && reporter.trim()) || 'anonymous',
            status: 'open',
            created_at: now(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    return { id: result.id };
}

export async function getSpotlight(db: Db): Promise<(TemplateSummary & { blurb: string })[]> {
    const rows = await db.selectFrom('spotlight').selectAll().orderBy('position', 'asc').execute();
    const templates = new Map<string, TemplateRow>();

    for (const spot of rows) {
        const row = await db.selectFrom('templates').select(SUMMARY_COLUMNS).where('identifier', '=', spot.identifier).executeTakeFirst();

        if (row) {
            templates.set(spot.identifier, row);
        }
    }

    const enrichment = await loadEnrichment(db, [...templates.values()].map((row) => row.publisher));
    const items: (TemplateSummary & { blurb: string })[] = [];

    for (const spot of rows) {
        const row = templates.get(spot.identifier);

        if (row && row.removed === 0) {
            items.push({ ...toSummary(row, enrichment), blurb: spot.blurb });
        }
    }

    return items;
}

export async function setSpotlight(db: Db, identifier: string, blurb: string, position: number): Promise<void> {
    await db.deleteFrom('spotlight').where('identifier', '=', identifier).execute();
    await db.insertInto('spotlight').values({ identifier, blurb, position, added_at: now() }).execute();
}

export async function evaluateForTemplate(db: Db, policy: Policy, identifier: string): Promise<PolicyDecision | undefined> {
    const summary = await getSummary(db, identifier);

    if (!summary) {
        return undefined;
    }

    return evaluatePolicy(policy, {
        identifier,
        badge: summary.badge,
        openFlags: summary.openFlags,
        removed: summary.removed,
    });
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)) ?? '';
    } catch {
        throw new RegistryError('Template could not be read as JSON.', 400);
    }
}


/**
 * The canonical JSON exactly as stored, for tools that fetch a template by identifier.
 * Returns 'removed' for a tombstoned template so callers can answer 410 instead of 404.
 */
export async function getRawTemplate(db: Db, identifier: string): Promise<string | 'removed' | undefined> {
    const row = await db.selectFrom('templates').select(['json', 'removed']).where('identifier', '=', identifier).executeTakeFirst();

    if (!row) {
        return undefined;
    }

    return row.removed === 1 ? 'removed' : row.json;
}
