import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { AdminAuth, type LoginProof } from './admin.js';
import { registerAdminRoutes } from './admin-routes.js';
import type { Db } from './db.js';
import { BADGE_RANK, type Badge } from './badges.js';
import { buildWalletSignRequest } from './auth/challenge-transaction.js';
import { transactionHashOf } from './review-receipt.js';
import { attachReceipt, broadcastReceipt, prepareReceipt, refreshPendingReceipts, receiptSettings, type ReceiptConfig } from './review-chain.js';
import { DRIP_MINE_BUILD, isRunNetwork, listDripCoins, runDripMine, type RunConfig } from './run-drip-mine.js';
import { isReceiptNetwork, publicKeyHexOrUndefined } from './review-address.js';
import { listUserReviews, ReviewAuth, saveUserReview, validateReview } from './user-reviews.js';
import { categoryCounts, isCategory, CATEGORIES } from './categories.js';
import { validatePolicy, type Policy } from './policy.js';
import {
    addFlag,
    evaluateForTemplate,
    getRawTemplate,
    getSpotlight,
    getTemplateDetail,
    listTemplates,
    publishTemplate,
    RegistryError,
    type ListParameters,
} from './registry.js';

export interface AppOptions {
    /** Disable rate limiting (tests). */
    rateLimit?: boolean;
    logger?: boolean;
    /** Clock for login challenges and sessions (tests). */
    clock?: () => number;
    /** Directory holding the built web app. When it exists it is served, with index.html for unknown non-API paths. */
    webDir?: string;
    /** On-chain review receipts: the admin identity that owns the review address and a chain source per network. */
    receipts?: ReceiptConfig;
    /** Live runs of templates that need no wallet (Drip Mine): a chain source per network. Off when absent. */
    run?: RunConfig;
}

const SORTS = new Set(['newest', 'name', 'flagged', 'rating']);

function toPositiveInteger(value: unknown): number | undefined {
    if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) {
        return undefined;
    }

    return Number(value);
}

export async function buildApp(db: Db, options: AppOptions = {}): Promise<FastifyInstance> {
    // Templates are up to 256 KB; leave headroom for the JSON wrapper.
    const app = Fastify({ logger: options.logger ?? false, bodyLimit: 600 * 1024 });

    if (options.rateLimit !== false) {
        await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
    }

    app.setErrorHandler((error: unknown, _request, reply) => {
        if (error instanceof RegistryError) {
            return reply.status(error.status).send({ error: error.message });
        }

        const status = (error as { statusCode?: number }).statusCode;

        if (typeof status === 'number' && status >= 400 && status < 500) {
            return reply.status(status).send({ error: (error as Error).message });
        }

        app.log.error(error);

        return reply.status(500).send({ error: 'Internal server error.' });
    });

    // Public read endpoints are open to any origin so other XO apps and wallets can fetch templates from the browser.
    // Admin routes never get this header, and no request with credentials is accepted anywhere.
    app.addHook('onSend', async (request, reply) => {
        if ((request.method === 'GET' || request.method === 'HEAD') && request.url.startsWith('/api/') && !request.url.startsWith('/api/admin')) {
            reply.header('access-control-allow-origin', '*');
        }
    });

    // Touches the database so an uptime pinger also keeps a hosted database awake, and reports 503 if it is unreachable.
    app.get('/api/health', async (_request, reply) => {
        try {
            await db.selectFrom('templates').select('identifier').limit(1).execute();

            return { ok: true };
        } catch (error) {
            app.log.error(error, 'Health check could not reach the database');

            return reply.code(503).send({ ok: false });
        }
    });

    // The template exactly as an XO tool expects it. The identifier is a hash of the content, so the response can
    // never change and may be cached forever.
    app.get('/api/templates/:identifier/raw', async (request, reply) => {
        const { identifier } = request.params as { identifier: string };
        const raw = await getRawTemplate(db, identifier);

        if (raw === undefined) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        if (raw === 'removed') {
            return reply.status(410).send({ error: 'This template was removed by a moderator.' });
        }

        return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('etag', `"${identifier}"`)
            .header('cache-control', 'public, max-age=31536000, immutable')
            .send(raw);
    });

    app.get('/api/templates', async (request, reply) => {
        const q = request.query as Record<string, unknown>;
        const parameters: ListParameters = {};

        if (typeof q.query === 'string') {
            parameters.query = q.query.slice(0, 100);
        }

        if (q.badge !== undefined) {
            if (typeof q.badge !== 'string' || !(q.badge in BADGE_RANK)) {
                return reply.status(400).send({ error: 'badge must be one of: unchecked, auto-checked, reviewed.' });
            }

            parameters.badge = q.badge as Badge;
        }

        if (q.category !== undefined && q.category !== '') {
            if (!isCategory(q.category)) {
                return reply.status(400).send({ error: `category must be one of: ${CATEGORIES.map((category) => category.slug).join(', ')}.` });
            }

            parameters.category = q.category;
        }

        if (q.sort !== undefined) {
            if (typeof q.sort !== 'string' || !SORTS.has(q.sort)) {
                return reply.status(400).send({ error: 'sort must be one of: newest, name, flagged, rating.' });
            }

            parameters.sort = q.sort as ListParameters['sort'];
        }

        parameters.page = toPositiveInteger(q.page);
        parameters.pageSize = toPositiveInteger(q.pageSize);

        return listTemplates(db, parameters);
    });

    // The categories and how many live templates each holds. "All" is the whole list, with no category filter.
    app.get('/api/categories', async () => categoryCounts(db));

    app.get('/api/templates/:identifier', async (request, reply) => {
        const { identifier } = request.params as { identifier: string };
        const detail = await getTemplateDetail(db, identifier);

        if (!detail) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        return detail;
    });

    app.post(
        '/api/templates',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const body = (request.body ?? {}) as { template?: unknown; publisher?: unknown; categories?: unknown };

            if (body.template === undefined) {
                return reply.status(400).send({ error: 'Request body must include a "template".' });
            }

            const publisher = typeof body.publisher === 'string' && body.publisher.trim() ? body.publisher.trim() : 'anonymous';
            const result = await publishTemplate(db, body.template, publisher, body.categories);

            return reply.status(result.created ? 201 : 200).send(result);
        },
    );

    app.post(
        '/api/templates/:identifier/flags',
        { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { identifier } = request.params as { identifier: string };
            const body = (request.body ?? {}) as { reason?: unknown; reporter?: unknown };
            const flag = await addFlag(db, identifier, body.reason, body.reporter);

            return reply.status(201).send(flag);
        },
    );


    // ----- wallet-signed community reviews -----
    // Step 1 stores the review on the server and returns a challenge. Step 2 accepts the wallet's proof and publishes
    // exactly the stored review. The text cannot change between the two steps.
    const reviews = new ReviewAuth(options.clock);

    app.get('/api/templates/:identifier/reviews', async (request, reply) => {
        const { identifier } = request.params as { identifier: string };
        const q = request.query as Record<string, unknown>;

        if (!(await getTemplateDetail(db, identifier))) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        await refreshPendingReceipts(db, options.receipts, identifier);

        return listUserReviews(db, identifier, toPositiveInteger(q.page) ?? 1, toPositiveInteger(q.pageSize) ?? 10);
    });

    app.post(
        '/api/templates/:identifier/reviews/challenge',
        { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { identifier } = request.params as { identifier: string };
            const body = (request.body ?? {}) as { rating?: unknown; body?: unknown; publicKey?: unknown };
            const draft = validateReview(body.rating, body.body);
            const template = await getTemplateDetail(db, identifier);

            if (!template) {
                return reply.status(404).send({ error: 'Template not found.' });
            }

            if (template.removed) {
                return reply.status(409).send({ error: 'A removed template cannot be reviewed.' });
            }

            const challenge = reviews.begin(identifier, draft);
            const result: Record<string, unknown> = { ...challenge, review: draft };

            // A wallet that signs transactions needs the request built around its own public key.
            if (typeof body.publicKey === 'string' && /^0[23][0-9a-f]{64}$/.test(body.publicKey)) {
                const publicKey = Uint8Array.from(Buffer.from(body.publicKey, 'hex'));

                result.walletSignRequest = buildWalletSignRequest(
                    challenge.nonce,
                    publicKey,
                    `Post your ${draft.rating}-star review on XOGrid. This signs a message-only transaction that is never broadcast and moves no funds.`,
                );
            }

            return result;
        },
    );

    app.post(
        '/api/templates/:identifier/reviews',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { identifier } = request.params as { identifier: string };
            const body = (request.body ?? {}) as Record<string, unknown>;
            const proof = body.proof as Record<string, unknown> | undefined;
            let loginProof: LoginProof | undefined;

            if (proof?.type === 'transaction' && typeof proof.signedTransaction === 'string') {
                loginProof = { type: 'transaction', signedTransaction: proof.signedTransaction };
            } else if (proof?.type === 'message' && typeof proof.signature === 'string') {
                loginProof = { type: 'message', signature: proof.signature };
            }

            if (typeof body.nonce !== 'string' || !loginProof) {
                return reply.status(400).send({ error: 'Request needs a nonce and a proof.' });
            }

            const outcome = reviews.complete(identifier, body.nonce, loginProof);

            if ('failure' in outcome) {
                app.log.info({ reason: outcome.failure }, 'review proof rejected');

                return reply.status(401).send({ error: 'The wallet signature could not be verified. Start the review again.' });
            }

            const saved = await saveUserReview(db, identifier, outcome.publicKey, outcome.draft);

            return reply.status(201).send({ ...saved, rating: outcome.draft.rating, body: outcome.draft.body });
        },
    );

    // ----- live runs of templates that need no wallet: Drip Mine (see server/src/run-drip-mine.ts) -----
    app.get('/api/run/drip-mine/coins', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { network } = request.query as { network?: unknown };

        if (!options.run) {
            return reply.status(503).send({ error: 'Live runs are not available on this server.' });
        }

        if (!isRunNetwork(network)) {
            return reply.status(400).send({ error: 'Network must be mainnet or chipnet.' });
        }

        return listDripCoins(options.run, network);
    });

    app.post('/api/run/drip-mine', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = (request.body ?? {}) as { network?: unknown; txid?: unknown; index?: unknown; confirmMainnet?: unknown; anyCoin?: unknown };

        if (!options.run) {
            return reply.status(503).send({ error: 'Live runs are not available on this server.' });
        }

        if (
            !isRunNetwork(body.network) ||
            typeof body.txid !== 'string' ||
            !/^[0-9a-f]{64}$/i.test(body.txid) ||
            typeof body.index !== 'number' ||
            !Number.isInteger(body.index) ||
            body.index < 0 ||
            body.index > 1_000_000
        ) {
            return reply.status(400).send({ error: 'Request needs a network (mainnet or chipnet), a 64-character transaction id and an output index.' });
        }

        return { ...(await runDripMine(options.run, body.network, body.txid.toLowerCase(), body.index, body.confirmMainnet === true, body.anyCoin === true)), builtBy: DRIP_MINE_BUILD };
    });

    // ----- optional on-chain receipts for a published review (see docs/REVIEW_TRACKING.md) -----
    app.get('/api/receipts/config', async () => receiptSettings(options.receipts));

    async function reviewRow(identifier: string, idText: string) {
        const id = Number(idText);

        return Number.isInteger(id) && id > 0
            ? db.selectFrom('user_reviews').selectAll().where('id', '=', id).where('identifier', '=', identifier).where('hidden', '=', 0).executeTakeFirst()
            : undefined;
    }

    app.post(
        '/api/templates/:identifier/reviews/:id/receipt/prepare',
        { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { identifier, id } = request.params as { identifier: string; id: string };
            const body = (request.body ?? {}) as { network?: unknown; publicKey?: unknown };
            const review = await reviewRow(identifier, id);

            if (!review) {
                return reply.status(404).send({ error: 'Review not found.' });
            }

            const publicKey = publicKeyHexOrUndefined(body.publicKey);

            if (!isReceiptNetwork(body.network) || !publicKey) {
                return reply.status(400).send({ error: 'Request needs a network (mainnet or chipnet) and the wallet public key.' });
            }

            return prepareReceipt(options.receipts, body.network, review, publicKey);
        },
    );

    app.post(
        '/api/templates/:identifier/reviews/:id/receipt',
        { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { identifier, id } = request.params as { identifier: string; id: string };
            const body = (request.body ?? {}) as { network?: unknown; txid?: unknown; signedTransaction?: unknown };
            const review = await reviewRow(identifier, id);

            if (!review) {
                return reply.status(404).send({ error: 'Review not found.' });
            }

            if (!isReceiptNetwork(body.network)) {
                return reply.status(400).send({ error: 'Request needs a network (mainnet or chipnet).' });
            }

            let txid = typeof body.txid === 'string' ? body.txid : undefined;

            // A wallet may hand back the signed transaction instead of an id: derive the id from the bytes.
            if (!txid && typeof body.signedTransaction === 'string' && /^([0-9a-fA-F]{2}){1,100000}$/.test(body.signedTransaction)) {
                const decoded = decodeTransaction(hexToBin(body.signedTransaction));

                if (typeof decoded !== 'string') {
                    txid = transactionHashOf(decoded);
                }
            }

            if (!txid) {
                return reply.status(400).send({ error: 'Request needs a txid or a signedTransaction.' });
            }

            return attachReceipt(db, options.receipts, body.network, review, txid);
        },
    );

    app.post(
        '/api/templates/:identifier/reviews/:id/receipt/broadcast',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { identifier, id } = request.params as { identifier: string; id: string };
            const body = (request.body ?? {}) as { network?: unknown; signedTransaction?: unknown };
            const review = await reviewRow(identifier, id);

            if (!review) {
                return reply.status(404).send({ error: 'Review not found.' });
            }

            if (!isReceiptNetwork(body.network) || typeof body.signedTransaction !== 'string') {
                return reply.status(400).send({ error: 'Request needs a network and a signedTransaction.' });
            }

            return broadcastReceipt(db, options.receipts, body.network, review, body.signedTransaction);
        },
    );

    app.get('/api/spotlight', async () => ({ items: await getSpotlight(db) }));

    app.post('/api/policy/evaluate', async (request, reply) => {
        const body = (request.body ?? {}) as { policy?: unknown; identifier?: unknown };
        const problems = validatePolicy(body.policy);

        if (problems.length > 0) {
            return reply.status(400).send({ error: problems.join('; ') });
        }

        if (typeof body.identifier !== 'string') {
            return reply.status(400).send({ error: 'identifier is required.' });
        }

        const decision = await evaluateForTemplate(db, body.policy as Policy, body.identifier);

        if (!decision) {
            return reply.status(404).send({ error: 'Template not found.' });
        }

        return decision;
    });

    registerAdminRoutes(app, db, new AdminAuth(db, options.clock), { rateLimit: options.rateLimit !== false });

    if (options.webDir && existsSync(resolve(options.webDir, 'index.html'))) {
        await app.register(fastifyStatic, { root: resolve(options.webDir) });
        app.setNotFoundHandler((request, reply) => {
            if (request.method === 'GET' && !request.url.startsWith('/api/')) {
                return reply.sendFile('index.html');
            }

            return reply.status(404).send({ error: 'Not found.' });
        });
    }

    return app;
}
