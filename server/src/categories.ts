import type { Db } from './db.js';
import { RegistryError } from './registry.js';

/**
 * The categories a template can be filed under. A template can be in several. This list is the only place to add or
 * rename one: the order here is the order shown on the Explore page and the publish form.
 */
export const CATEGORIES = [
    { slug: 'payment', label: 'Payment' },
    { slug: 'identity', label: 'Identity' },
    { slug: 'tokens', label: 'Tokens' },
    { slug: 'staking', label: 'Staking' },
    { slug: 'chipnet', label: 'Chipnet' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

const ORDER = new Map<string, number>(CATEGORIES.map((category, index) => [category.slug, index]));

export const isCategory = (value: unknown): value is CategorySlug => typeof value === 'string' && ORDER.has(value);

/**
 * Checks a list of categories from a request. Missing means none. Anything that is not a list of known categories is
 * refused rather than guessed at. Duplicates are dropped and the result is in the canonical order.
 */
export function normalizeCategories(input: unknown): CategorySlug[] {
    if (input === undefined || input === null) {
        return [];
    }

    if (!Array.isArray(input) || input.length > CATEGORIES.length * 2) {
        throw new RegistryError('categories must be a list of category names.', 400);
    }

    const unknown = input.filter((value) => !isCategory(value));

    if (unknown.length > 0) {
        throw new RegistryError(`Unknown categor${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.map((value) => String(value).slice(0, 30)).join(', ')}. Choose from: ${CATEGORIES.map((category) => category.slug).join(', ')}.`, 400);
    }

    return [...new Set(input as CategorySlug[])].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

/** Every template's categories in one query, in canonical order. */
export async function loadCategories(db: Db): Promise<Map<string, string[]>> {
    const byTemplate = new Map<string, string[]>();

    for (const row of await db.selectFrom('template_categories').selectAll().execute()) {
        byTemplate.set(row.identifier, [...(byTemplate.get(row.identifier) ?? []), row.category]);
    }

    for (const [identifier, list] of byTemplate) {
        byTemplate.set(identifier, list.sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99)));
    }

    return byTemplate;
}

/** Replaces a template's categories with exactly this list. */
export async function setCategories(db: Db, identifier: string, categories: CategorySlug[]): Promise<void> {
    await db.deleteFrom('template_categories').where('identifier', '=', identifier).execute();

    for (const category of categories) {
        await db.insertInto('template_categories').values({ identifier, category }).execute();
    }
}

/**
 * Files a template only if it has no categories yet. Used for the first publisher's choice and for the built-in
 * templates, so a moderator's later change is never undone by a restart or by someone re-publishing the template.
 * Returns the categories the template has afterwards.
 */
export async function setCategoriesIfEmpty(db: Db, identifier: string, categories: CategorySlug[]): Promise<string[]> {
    const existing = await db.selectFrom('template_categories').select('category').where('identifier', '=', identifier).execute();

    if (existing.length > 0 || categories.length === 0) {
        return (await loadCategories(db)).get(identifier) ?? [];
    }

    await setCategories(db, identifier, categories);

    return categories;
}

export interface CategoryCount {
    slug: CategorySlug;
    label: string;
    count: number;
}

/** How many live (not removed) templates are in each category, plus the number of all live templates. */
export async function categoryCounts(db: Db): Promise<{ total: number; categories: CategoryCount[] }> {
    const live = await db.selectFrom('templates').select('identifier').where('removed', '=', 0).execute();
    const liveIds = new Set(live.map((row) => row.identifier));
    const counts = new Map<string, number>();

    for (const [identifier, list] of await loadCategories(db)) {
        if (liveIds.has(identifier)) {
            for (const category of list) {
                counts.set(category, (counts.get(category) ?? 0) + 1);
            }
        }
    }

    return { total: liveIds.size, categories: CATEGORIES.map((category) => ({ slug: category.slug, label: category.label, count: counts.get(category.slug) ?? 0 })) };
}
