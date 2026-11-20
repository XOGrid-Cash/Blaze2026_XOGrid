import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuth, type AdminSession, type LoginProof } from './admin.js';
import { buildWalletSignRequest } from './auth/challenge-transaction.js';
import { normalizeCategories, setCategories } from './categories.js';
import type { Db } from './db.js';
import { addressOfPublicKey, setReviewHidden } from './user-reviews.js';
import { addUserAddresses, createUser, deleteUser, listUsers, removeUserAddress, renameUser, resolveNames } from './user-names.js';
import { getSummary, listTemplates, RegistryError, setSpotlight } from './registry.js';

declare module 'fastify' {
    interface FastifyRequest {
        admin?: AdminSession;
    }
}

const now = (): string => new Date().toISOString();

async function logAction(db: Db, actor: string, action: string, identifier: string | null, note: string): Promise<void> {
    await db.insertInto('moderation_log').values({ actor, action, identifier, note: note.slice(0, 500), created_at: now() }).execute();
}

function text(value: unknown, field: string, min: number, max: number): string {
    if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
        throw new RegistryError(`${field} must be ${min} to ${max} characters.`, 400);
    }

    return value.trim();
}

function parseProof(body: Record<string, unknown>): LoginProof | undefined {
    const proof = body.proof as Record<string, unknown> | undefined;

    if (proof?.type === 'transaction' && typeof proof.signedTransaction === 'string') {
        return { type: 'transaction', signedTransaction: proof.signedTransaction };
    }

    if (proof?.type === 'message' && typeof proof.signature === 'string') {
        return { type: 'message', signature: proof.signature };
    }

    return undefined;
}

export function registerAdminRoutes(app: FastifyInstance, db: Db, auth: AdminAuth, options: { rateLimit: boolean }): void {
    const limit = (max: number) => (options.rateLimit ? { config: { rateLimit: { max, timeWindow: '1 minute' } } } : {});

    const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const header = request.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
        const session = auth.getSession(token);

        if (!session) {
            return reply.status(401).send({ error: 'Moderator login required.' });
        }

        request.admin = session;
    };

    // ----- login -----

    // A wallet that signs transactions needs the request built around its own public key. Sending the key here lets a
    // browser app ask the wallet to sign without bundling any signing code of its own (the reviews flow does the same).
    app.post('/api/admin/challenge', limit(20), async (request) => {
        const body = (request.body ?? {}) as { publicKey?: unknown };
        const challenge = auth.issueChallenge();

        if (typeof body.publicKey === 'string' && /^0[23][0-9a-f]{64}$/.test(body.publicKey)) {
            return { ...challenge, walletSignRequest: buildWalletSignRequest(challenge.nonce, Uint8Array.from(Buffer.from(body.publicKey, 'hex'))) };
        }

        return challenge;
    });

    app.post('/api/admin/login', limit(10), async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        const proof = parseProof(body);

        if (typeof body.nonce !== 'string' || !proof) {
            return reply.status(400).send({ error: 'Request needs a nonce and a proof.' });
        }

        const result = await auth.login(body.nonce, proof);

        if ('failure' in result) {
            // The reason goes to the server log only, so the response never helps someone probe the allowlist.
            app.log.info({ reason: result.failure }, 'admin login rejected');

            return reply.status(401).send({ error: 'Login failed.' });
        }

        await logAction(db, result.session.label, 'login', null, `key ${result.session.publicKey.slice(0, 12)}...`);

        return {
            token: result.session.token,
            admin: result.session.label,
            expiresAt: new Date(result.session.expiresAt).toISOString(),
        };
    });

    // ----- everything below needs a session -----

    app.post('/api/admin/logout', { preHandler: requireAdmin }, async (request) => {
        auth.logout(request.headers.authorization!.slice(7).trim());

        return { ok: true };
    });

    app.get('/api/admin/me', { preHandler: requireAdmin }, async (request) => ({
        admin: request.admin!.label,
        expiresAt: new Date(request.admin!.expiresAt).toISOString(),
    }));

    app.get('/api/admin/summary', { preHandler: requireAdmin }, async () => {
        const { items } = await listTemplates(db, { pageSize: 50, includeRemoved: true });
        const all = (await db.selectFrom('templates').select('identifier').execute()).length;
        const byBadge = { unchecked: 0, 'auto-checked': 0, reviewed: 0 };
        let removed = 0;
        let failing = 0;

        for (const item of items) {
            if (item.removed) {
                removed += 1;
                continue;
            }

            byBadge[item.badge] += 1;
            failing += item.audit && item.audit.counts.fail > 0 ? 1 : 0;
        }

        const openFlags = (await db.selectFrom('flags').select('id').where('status', '=', 'open').execute()).length;
        const recent = await db.selectFrom('moderation_log').selectAll().orderBy('id', 'desc').limit(20).execute();

        return {
            templates: { total: all, removed, byBadge, withFailingChecks: failing },
            openFlags,
            reviews: (await db.selectFrom('reviews').select('id').execute()).length,
            recentActions: recent.map((row) => ({ actor: row.actor, action: row.action, identifier: row.identifier, note: row.note, at: row.created_at })),
        };
    });

    // Every template including removed ones, so a moderator can find a tombstone and restore it. The public list hides them.
    app.get('/api/admin/templates', { preHandler: requireAdmin }, async (request) => {
        const q = request.query as { query?: string; page?: string; pageSize?: string };
        const toNumber = (value: string | undefined): number | undefined => (typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : undefined);

        return listTemplates(db, {
            query: typeof q.query === 'string' ? q.query.slice(0, 100) : undefined,
            page: toNumber(q.page),
            pageSize: toNumber(q.pageSize),
            sort: 'newest',
            includeRemoved: true,
        });
    });

    app.get('/api/admin/flags', { preHandler: requireAdmin }, async (request) => {
        const status = (request.query as { status?: string }).status ?? 'open';
        const rows = await db.selectFrom('flags').selectAll().where('status', '=', status).orderBy('id', 'desc').limit(200).execute();
        const items = [];

        for (const row of rows) {
            const template = await getSummary(db, row.identifier);

            items.push({
                id: row.id,
                identifier: row.identifier,
                templateName: template?.name ?? '(unknown)',
                reason: row.reason,
                reporter: row.reporter,
                status: row.status,
                createdAt: row.created_at,
            });
        }

        return { items };
    });

    app.post('/api/admin/flags/:id/resolve', { preHandler: requireAdmin }, async (request, reply) => {
        const id = Number((request.params as { id: string }).id);
        const body = (request.body ?? {}) as { status?: unknown; note?: unknown };

        if (body.status !== 'dismissed' && body.status !== 'upheld') {
            return reply.status(400).send({ error: 'status must be "dismissed" or "upheld".' });
        }

        const flag = Number.isInteger(id) ? await db.selectFrom('flags').selectAll().where('id', '=', id).executeTakeFirst() : undefined;

        if (!flag) {
            return reply.status(404).send({ error: 'Flag not found.' });
        }

        await db.updateTable('flags').set({ status: body.status }).where('id', '=', id).execute();
        await logAction(db, request.admin!.label, `flag-${body.status}`, flag.identifier, typeof body.note === 'string' ? body.note : `flag ${id}`);

        return { id, status: body.status };
    });

    app.post('/api/admin/templates/:identifier/review', { preHandler: requireAdmin }, async (request, reply) => {
        const { identifier } = request.params as { identifier: string };
        const note = text((request.body as { note?: unknown } | undefined)?.note, 'note', 3, 500);
        const template = await getSummary(db, identifier);

        if (!template) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        if (template.removed) {
            return reply.status(409).send({ error: 'A removed template cannot be reviewed.' });
        }

        const admin = request.admin!;
        const existing = await db
            .selectFrom('reviews')
            .select('id')
            .where('identifier', '=', identifier)
            .where('reviewer_address', '=', admin.publicKey)
            .executeTakeFirst();

        if (existing) {
            return reply.status(409).send({ error: 'You have already reviewed this template.' });
        }

        await db
            .insertInto('reviews')
            .values({ identifier, reviewer_address: admin.publicKey, reviewer_label: admin.label, signature: null, note, created_at: now() })
            .execute();
        await logAction(db, admin.label, 'review', identifier, note);

        return reply.status(201).send({ identifier, reviewer: admin.label });
    });

    app.post('/api/admin/templates/:identifier/remove', { preHandler: requireAdmin }, async (request, reply) => {
        const { identifier } = request.params as { identifier: string };
        const reason = text((request.body as { reason?: unknown } | undefined)?.reason, 'reason', 3, 300);

        if (!(await getSummary(db, identifier))) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        await db.updateTable('templates').set({ removed: 1, removed_reason: reason }).where('identifier', '=', identifier).execute();
        await db.deleteFrom('spotlight').where('identifier', '=', identifier).execute();
        await logAction(db, request.admin!.label, 'remove', identifier, reason);

        return { identifier, removed: true };
    });

    app.post('/api/admin/templates/:identifier/restore', { preHandler: requireAdmin }, async (request, reply) => {
        const { identifier } = request.params as { identifier: string };

        if (!(await getSummary(db, identifier))) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        await db.updateTable('templates').set({ removed: 0, removed_reason: null }).where('identifier', '=', identifier).execute();
        await logAction(db, request.admin!.label, 'restore', identifier, 'restored');

        return { identifier, removed: false };
    });


    // Moderators can re-file a template. Publishers only choose categories when they first publish.
    app.put('/api/admin/templates/:identifier/categories', { preHandler: requireAdmin }, async (request, reply) => {
        const { identifier } = request.params as { identifier: string };
        const categories = normalizeCategories((request.body as { categories?: unknown } | undefined)?.categories);

        if (!(await getSummary(db, identifier))) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        await setCategories(db, identifier, categories);
        await logAction(db, request.admin!.label, 'categories', identifier, categories.join(', ') || '(none)');

        return { identifier, categories };
    });

    app.get('/api/admin/user-reviews', { preHandler: requireAdmin }, async (request) => {
        const q = request.query as { hidden?: string };
        let query = db.selectFrom('user_reviews').selectAll().orderBy('id', 'desc').limit(200);

        if (q.hidden === '1' || q.hidden === '0') {
            query = query.where('hidden', '=', Number(q.hidden));
        }

        const items = await query.execute();
        const names = await resolveNames(db, items.map((row) => row.reviewer));

        return {
            items: items.map((row) => ({ ...row, reviewerAddress: addressOfPublicKey(row.reviewer), reviewerName: names.get(row.reviewer) ?? null })),
        };
    });

    // ----- named users: display names for outside publishers and reviewers -----

    const userId = (request: FastifyRequest): number => {
        const id = Number((request.params as { id: string }).id);

        if (!Number.isInteger(id) || id <= 0) {
            throw new RegistryError('User not found.', 404);
        }

        return id;
    };

    app.get('/api/admin/users', { preHandler: requireAdmin }, async () => ({ items: await listUsers(db) }));

    app.post('/api/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
        const body = (request.body ?? {}) as { name?: unknown; addresses?: unknown };
        const user = await createUser(db, body.name, body.addresses ?? [], request.admin!.label);

        await logAction(db, request.admin!.label, 'user-create', null, `${user.name} (${user.addresses.length} address${user.addresses.length === 1 ? '' : 'es'})`);

        return reply.status(201).send(user);
    });

    app.put('/api/admin/users/:id', { preHandler: requireAdmin }, async (request) => {
        const { before, user } = await renameUser(db, userId(request), (request.body as { name?: unknown } | undefined)?.name);

        await logAction(db, request.admin!.label, 'user-rename', null, `${before} -> ${user.name}`);

        return user;
    });

    app.post('/api/admin/users/:id/addresses', { preHandler: requireAdmin }, async (request) => {
        const addresses = (request.body as { addresses?: unknown } | undefined)?.addresses;
        const user = await addUserAddresses(db, userId(request), addresses);

        await logAction(db, request.admin!.label, 'user-address-add', null, `${user.name}: ${Array.isArray(addresses) ? addresses.join(', ') : ''}`);

        return user;
    });

    app.delete('/api/admin/users/:id/addresses/:address', { preHandler: requireAdmin }, async (request) => {
        const { address } = request.params as { address: string };
        const user = await removeUserAddress(db, userId(request), address);

        await logAction(db, request.admin!.label, 'user-address-remove', null, `${user.name}: ${address}`);

        return user;
    });

    app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (request) => {
        const user = await deleteUser(db, userId(request));

        await logAction(db, request.admin!.label, 'user-delete', null, user.name);

        return { id: user.id, deleted: true };
    });

    app.post('/api/admin/user-reviews/:id/hide', { preHandler: requireAdmin }, async (request, reply) => {
        const id = Number((request.params as { id: string }).id);
        const reason = text((request.body as { reason?: unknown } | undefined)?.reason, 'reason', 3, 300);
        const row = Number.isInteger(id) ? await setReviewHidden(db, id, true, reason) : undefined;

        if (!row) {
            return reply.status(404).send({ error: 'Review not found.' });
        }

        await logAction(db, request.admin!.label, 'hide-review', row.identifier, `review ${id}: ${reason}`);

        return { id, hidden: true };
    });

    app.post('/api/admin/user-reviews/:id/unhide', { preHandler: requireAdmin }, async (request, reply) => {
        const id = Number((request.params as { id: string }).id);
        const row = Number.isInteger(id) ? await setReviewHidden(db, id, false, null) : undefined;

        if (!row) {
            return reply.status(404).send({ error: 'Review not found.' });
        }

        await logAction(db, request.admin!.label, 'unhide-review', row.identifier, `review ${id}`);

        return { id, hidden: false };
    });

    app.put('/api/admin/spotlight', { preHandler: requireAdmin }, async (request, reply) => {
        const items = (request.body as { items?: unknown } | undefined)?.items;

        if (!Array.isArray(items) || items.length > 6) {
            return reply.status(400).send({ error: 'items must be a list of at most 6 templates.' });
        }

        const cleaned: { identifier: string; blurb: string }[] = [];

        for (const item of items as { identifier?: unknown; blurb?: unknown }[]) {
            const identifier = text(item?.identifier, 'identifier', 1, 128);
            const blurb = text(item?.blurb, 'blurb', 3, 200);
            const template = await getSummary(db, identifier);

            if (!template || template.removed) {
                throw new RegistryError(`Template ${identifier.slice(0, 12)} cannot be featured.`, 400);
            }

            cleaned.push({ identifier, blurb });
        }

        await db.deleteFrom('spotlight').execute();

        for (const [position, item] of cleaned.entries()) {
            await setSpotlight(db, item.identifier, item.blurb, position);
        }

        await logAction(db, request.admin!.label, 'spotlight', null, `${cleaned.length} featured`);

        return { count: cleaned.length };
    });
}
