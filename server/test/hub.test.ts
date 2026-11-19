import { p2pkhTemplate } from '@xo-cash/templates';
import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

let db: Db;
let app: FastifyInstance;

const canonicalJson = serializeTemplate(p2pkhTemplate);
const canonicalId = generateTemplateIdentifier(parseTemplate(canonicalJson));

beforeEach(async () => {
    db = await freshDb();
    app = await buildApp(db, { rateLimit: false });
});

afterEach(async () => {
    await app.close();
    await db.destroy();
});

const get = async (url: string) => app.inject({ method: 'GET', url });
const post = async (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

describe('seed and canonical identifiers', () => {
    it('publishes the five XO templates and the hub-authored one once, idempotently', async () => {
        expect(await seed(db)).toEqual({ published: 6, alreadyPresent: 0 });
        expect(await seed(db)).toEqual({ published: 0, alreadyPresent: 6 });

        const list = (await get('/api/templates?pageSize=50')).json();

        expect(list.total).toBe(6);
    });

    it('uses the canonical identifier, not the hash of the raw object', async () => {
        await seed(db);

        const detail = (await get(`/api/templates/${canonicalId}`)).json();

        expect(detail.identifier).toBe(canonicalId);
        expect(detail.name).toBe('Wallet (P2PKH)');
    });

    it('returns the same identifier when the same template is published with reordered keys', async () => {
        const object = JSON.parse(canonicalJson) as Record<string, unknown>;
        const reordered = Object.fromEntries(Object.entries(object).reverse());

        const first = await post('/api/templates', { template: object, publisher: 'tester' });
        const second = await post('/api/templates', { template: reordered, publisher: 'tester' });

        expect(first.statusCode).toBe(201);
        expect(second.statusCode).toBe(200);
        expect(second.json().identifier).toBe(first.json().identifier);
        expect(second.json().created).toBe(false);
        expect((await get('/api/templates')).json().total).toBe(1);
    });

    it('warns when the submitted key order was not canonical', async () => {
        const object = JSON.parse(canonicalJson) as Record<string, unknown>;
        const reordered = Object.fromEntries(Object.entries(object).reverse());
        const { identifier } = (await post('/api/templates', { template: reordered })).json();
        const detail = (await get(`/api/templates/${identifier}`)).json();
        const check = detail.auditReport.results.find((r: { id: string }) => r.id === 'identifier');

        expect(check.status).toBe('warn');
    });
});

describe('publishing', () => {
    it('rejects bodies without a template', async () => {
        const response = await post('/api/templates', {});

        expect(response.statusCode).toBe(400);
    });

    it('rejects JSON that is not an XO template with a plain message', async () => {
        const response = await post('/api/templates', { template: { name: 'nope' } });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatch(/not a valid XO template/i);
    });

    it('rejects oversized templates', async () => {
        const big = JSON.parse(canonicalJson) as Record<string, unknown>;

        big.description = 'x'.repeat(300 * 1024);

        const response = await post('/api/templates', { template: big });

        expect(response.statusCode).toBe(413);
    });

    it('stores an audit report and derives auto-checked for a clean template', async () => {
        const { identifier, badge } = (await post('/api/templates', { template: JSON.parse(canonicalJson) })).json();

        expect(badge).toBe('auto-checked');

        const detail = (await get(`/api/templates/${identifier}`)).json();
        const ids = detail.auditReport.results.map((r: { id: string }) => r.id);

        expect(ids).toEqual(['schema', 'size', 'identifier', 'references', 'compile', 'scenarios', 'resources']);
        expect(detail.audit.counts.fail).toBe(0);
    });

    it('fails the reference check and keeps the badge at unchecked when an action points at a missing transaction', async () => {
        const broken = JSON.parse(canonicalJson) as { actions: Record<string, { transaction: string }> };
        const firstAction = Object.keys(broken.actions)[0]!;

        broken.actions[firstAction]!.transaction = 'doesNotExist';

        const { identifier, badge } = (await post('/api/templates', { template: broken })).json();
        const detail = (await get(`/api/templates/${identifier}`)).json();
        const references = detail.auditReport.results.find((r: { id: string }) => r.id === 'references');

        expect(badge).toBe('unchecked');
        expect(references.status).toBe('fail');
        expect(references.details.join(' ')).toContain('doesNotExist');
    });
});

describe('flags and badges', () => {
    it('shows open flags on the template and never hides the badge', async () => {
        await seed(db);

        const flag = await post(`/api/templates/${canonicalId}/flags`, { reason: 'Looks suspicious', reporter: 'alice' });

        expect(flag.statusCode).toBe(201);

        const detail = (await get(`/api/templates/${canonicalId}`)).json();

        expect(detail.openFlags).toBe(1);
        expect(detail.badge).toBe('auto-checked');
        expect(detail.flags[0].reason).toBe('Looks suspicious');
    });

    it('validates flag input and unknown templates', async () => {
        await seed(db);

        expect((await post(`/api/templates/${canonicalId}/flags`, { reason: 'x' })).statusCode).toBe(400);
        expect((await post('/api/templates/not-a-real-id/flags', { reason: 'valid reason' })).statusCode).toBe(404);
    });

    it('shows reviewed when a review row exists for that exact identifier', async () => {
        await seed(db);
        await db
            .insertInto('reviews')
            .values({
                identifier: canonicalId,
                reviewer_address: 'bitcoincash:qtest',
                signature: null,
                note: 'Read the scripts',
                created_at: new Date().toISOString(),
            })
            .execute();

        const detail = (await get(`/api/templates/${canonicalId}`)).json();

        expect(detail.badge).toBe('reviewed');
        expect(detail.reviews).toHaveLength(1);
    });
});

describe('browse, search and spotlight', () => {
    beforeEach(async () => {
        await seed(db);
    });

    it('searches by name, description and identifier prefix', async () => {
        expect((await get('/api/templates?query=faucet')).json().total).toBe(1);
        expect((await get(`/api/templates?query=${canonicalId.slice(0, 8)}`)).json().total).toBe(1);
        expect((await get('/api/templates?query=zzzzzz')).json().total).toBe(0);
    });

    it('sorts by name and paginates', async () => {
        const page1 = (await get('/api/templates?sort=name&pageSize=4&page=1')).json();
        const page2 = (await get('/api/templates?sort=name&pageSize=4&page=2')).json();

        expect(page1.items).toHaveLength(4);
        expect(page2.items).toHaveLength(2);
        expect(page1.total).toBe(6);

        const names = page1.items.map((i: { name: string }) => i.name);

        expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    });

    it('sorts flagged templates first', async () => {
        await post(`/api/templates/${canonicalId}/flags`, { reason: 'Needs a look' });

        const list = (await get('/api/templates?sort=flagged')).json();

        expect(list.items[0].identifier).toBe(canonicalId);
    });

    it('filters by badge and rejects bad parameters', async () => {
        expect((await get('/api/templates?badge=auto-checked')).json().total).toBe(6);
        expect((await get('/api/templates?badge=reviewed')).json().total).toBe(0);
        expect((await get('/api/templates?badge=nonsense')).statusCode).toBe(400);
        expect((await get('/api/templates?sort=nonsense')).statusCode).toBe(400);
    });

    it('returns the seeded spotlight with blurbs', async () => {
        const { items } = (await get('/api/spotlight')).json();

        expect(items).toHaveLength(3);
        expect(items[0].blurb.length).toBeGreaterThan(10);
    });

    it('returns 404 for an unknown template', async () => {
        expect((await get('/api/templates/deadbeef')).statusCode).toBe(404);
    });
});

describe('policy preview', () => {
    beforeEach(async () => {
        await seed(db);
    });

    const evaluate = async (policy: unknown, identifier = canonicalId) =>
        (await post('/api/policy/evaluate', { policy, identifier })).json();

    it('allows an auto-checked template under a lenient policy', async () => {
        expect((await evaluate({ minBadge: 'auto-checked' })).decision).toBe('allow');
    });

    it('blocks when the policy requires a human review', async () => {
        const result = await evaluate({ minBadge: 'reviewed' });

        expect(result.decision).toBe('block');
        expect(result.reasons[0]).toMatch(/below the required/);
    });

    it('blocks flagged templates when asked, and the allow list overrides it', async () => {
        await post(`/api/templates/${canonicalId}/flags`, { reason: 'Suspicious output' });

        expect((await evaluate({ blockFlagged: true })).decision).toBe('block');
        expect((await evaluate({ blockFlagged: true, allowIdentifiers: [canonicalId] })).decision).toBe('allow');
        expect((await evaluate({ allowIdentifiers: [canonicalId], blockIdentifiers: [canonicalId] })).decision).toBe('block');
    });

    it('rejects malformed policies and unknown templates', async () => {
        expect((await post('/api/policy/evaluate', { policy: { minBadge: 'gold' }, identifier: canonicalId })).statusCode).toBe(400);
        expect((await post('/api/policy/evaluate', { policy: {}, identifier: 'missing' })).statusCode).toBe(404);
    });
});

describe('moderator removal', () => {
    it('keeps a visible tombstone and hides the template body', async () => {
        await seed(db);
        await db
            .updateTable('templates')
            .set({ removed: 1, removed_reason: 'Abusive description' })
            .where('identifier', '=', canonicalId)
            .execute();

        const detail = (await get(`/api/templates/${canonicalId}`)).json();

        expect(detail.removed).toBe(true);
        expect(detail.removedReason).toBe('Abusive description');
        expect(detail.template).toBeNull();
        expect((await get('/api/templates?pageSize=50')).json().total).toBe(5);
        expect((await post('/api/policy/evaluate', { policy: {}, identifier: canonicalId })).json().decision).toBe('block');
    });
});

describe('static web app', () => {
    it('serves index.html for client routes but keeps unknown API paths as JSON 404', async () => {
        const { mkdtempSync, writeFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'web-'));

        writeFileSync(join(dir, 'index.html'), '<html>app</html>');

        const web = await buildApp(db, { rateLimit: false, webDir: dir });
        const page = await web.inject({ method: 'GET', url: '/browse' });
        const api404 = await web.inject({ method: 'GET', url: '/api/nope' });

        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('app');
        expect(api404.statusCode).toBe(404);
        expect(api404.json()).toEqual({ error: 'Not found.' });
        await web.close();
    });
});

describe('raw template endpoint and CORS', () => {
    it('serves the stored canonical JSON, immutable, and the identifier verifies against it', async () => {
        await seed(db);

        const res = await get(`/api/templates/${canonicalId}/raw`);

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.headers['cache-control']).toContain('immutable');
        expect(res.headers.etag).toBe(`"${canonicalId}"`);
        expect(generateTemplateIdentifier(parseTemplate(res.body))).toBe(canonicalId);
        expect(res.body).toBe(serializeTemplate(parseTemplate(canonicalJson)));
        expect(serializeTemplate(parseTemplate(res.body))).toBe(res.body);
    });

    it('answers 404 for unknown identifiers and 410 for removed ones', async () => {
        await seed(db);

        expect((await get('/api/templates/nope/raw')).statusCode).toBe(404);

        await db.updateTable('templates').set({ removed: 1, removed_reason: 'test' }).where('identifier', '=', canonicalId).execute();

        expect((await get(`/api/templates/${canonicalId}/raw`)).statusCode).toBe(410);
    });

    it('allows any origin on public reads but never on admin routes or POSTs', async () => {
        await seed(db);

        expect((await get('/api/templates')).headers['access-control-allow-origin']).toBe('*');
        expect((await get(`/api/templates/${canonicalId}/raw`)).headers['access-control-allow-origin']).toBe('*');
        expect((await get('/api/admin/me')).headers['access-control-allow-origin']).toBeUndefined();
        expect((await post('/api/admin/challenge', {})).headers['access-control-allow-origin']).toBeUndefined();
        expect((await post(`/api/templates/${canonicalId}/flags`, { reason: 'testing cors' })).headers['access-control-allow-origin']).toBeUndefined();
    });
});

describe('first start', () => {
    it('seed is safe to run when the database already has templates', async () => {
        expect((await seed(db)).published).toBe(6);
        expect((await seed(db)).published).toBe(0);
        expect((await db.selectFrom('templates').select('identifier').execute()).length).toBe(6);
    });
});
