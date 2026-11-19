import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { checkResources, CHECKER_VERSION } from '../src/audit/checks.js';
import type { Db } from '../src/db.js';
import { publishTemplate, reauditStale } from '../src/registry.js';
import { seedCommunity } from '../src/seed.js';
import { COMMUNITY_TEMPLATES } from '../src/templates/community.js';
import { freshDb } from './helpers.js';

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
    db = await freshDb();
    app = await buildApp(db, { rateLimit: false });
});

afterEach(async () => {
    await app.close();
    await db.destroy();
});

describe('resource links check', () => {
    it('skips a template with no resources', () => {
        expect(checkResources({}).status).toBe('skipped');
        expect(checkResources({ resources: [] }).status).toBe('skipped');
    });

    it('passes plain https links', () => {
        const result = checkResources({ resources: [{ name: 'A', url: 'https://github.com/x/y' }, { name: 'B', url: 'https://gitlab.com/z' }] });

        expect(result.status).toBe('pass');
        expect(result.message).toContain('2 resource links');
    });

    it.each([
        ['javascript:alert(1)', 'not a web link'],
        ['JaVaScRiPt:alert(1)', 'not a web link'],
        ['data:text/html,<b>x</b>', 'not a web link'],
        ['file:///etc/passwd', 'not a web link'],
        ['http://example.com/page', 'uses http, not https'],
        ['https://user:pass@evil.example/', 'login embedded'],
        ['not a url', 'not a valid address'],
        ['', 'no address given'],
        [42, 'no address given'],
    ])('warns about %j', (url, reason) => {
        const result = checkResources({ resources: [{ name: 'Bad one', url }] });

        expect(result.status).toBe('warn');
        expect(result.details?.[0]).toContain('Bad one');
        expect(result.details?.[0]).toContain(reason.split(' ')[0]!);
    });

    it('warns once with every problem listed, and never fails', () => {
        const result = checkResources({
            resources: [{ name: 'Good', url: 'https://ok.example' }, { name: 'Plain http', url: 'http://x.example' }, { name: 'Script', url: 'javascript:1' }],
        });

        expect(result.status).toBe('warn');
        expect(result.message).toContain('2 of 3');
        expect(result.details).toHaveLength(2);
    });

    it('warns when resources is not a list', () => {
        expect(checkResources({ resources: 'https://example.com' }).status).toBe('warn');
    });

    it('is part of the report, and the five community templates pass it', async () => {
        await seedCommunity(db);

        for (const entry of COMMUNITY_TEMPLATES) {
            const detail = (await app.inject({ method: 'GET', url: `/api/templates/${entry.identifier}` })).json();
            const check = detail.auditReport.results.find((result: { id: string }) => result.id === 'resources');

            expect(check?.status, entry.slug).toBe('pass');
            expect(detail.auditReport.checkerVersion).toBe(CHECKER_VERSION);
        }
    });

    it('a hostile template is still published and keeps its badge, with a warning shown', async () => {
        const base = JSON.parse(COMMUNITY_TEMPLATES.find((entry) => entry.slug === 'drip-mine')!.json);

        base.name = 'Hostile';
        base.resources = [{ name: 'Click me', description: 'x', url: 'javascript:alert(1)' }];

        const published = await publishTemplate(db, base, 'tester');
        const detail = (await app.inject({ method: 'GET', url: `/api/templates/${published.identifier}` })).json();
        const check = detail.auditReport.results.find((result: { id: string }) => result.id === 'resources');

        expect(published.badge).toBe('auto-checked');
        expect(check.status).toBe('warn');
        expect(detail.audit.counts.warn).toBeGreaterThanOrEqual(1);
        expect(detail.audit.counts.fail).toBe(0);
    });
});

describe('refreshing stale audit reports', () => {
    it('re-audits only templates whose latest report is from an older checker version', async () => {
        await seedCommunity(db);

        expect(await reauditStale(db)).toBe(0);

        // Pretend one template was last audited by version 1.
        const target = COMMUNITY_TEMPLATES[0]!.identifier;

        await db.updateTable('audit_reports').set({ checker_version: '1' }).where('identifier', '=', target).execute();

        expect(await reauditStale(db)).toBe(1);
        expect(await reauditStale(db)).toBe(0);

        const detail = (await app.inject({ method: 'GET', url: `/api/templates/${target}` })).json();

        expect(detail.auditReport.checkerVersion).toBe(CHECKER_VERSION);
    });
});
