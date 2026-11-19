import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { setSpotlight } from '../src/registry.js';
import { seed, seedCommunity } from '../src/seed.js';
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

const get = async (url: string) => app.inject({ method: 'GET', url });

describe('community templates in the registry', () => {
    it('lists the five templates from the templates/ folder', () => {
        expect(COMMUNITY_TEMPLATES.map((entry) => entry.slug).sort()).toEqual([
            'badgers-stake',
            'block-points',
            'drip-mine',
            'revenue-split',
            'token-burner',
        ]);
    });

    it.each(COMMUNITY_TEMPLATES.map((entry) => [entry.slug, entry] as const))('%s keeps the identifier its README records', (_slug, entry) => {
        expect(entry.identifier).toMatch(/^[0-9a-f]{64}$/);
        expect(generateTemplateIdentifier(parseTemplate(entry.json))).toBe(entry.identifier);
    });

    it('matches the template.json files in the templates/ folder (run scripts/sync-community-templates.mjs if this fails)', () => {
        const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

        if (!existsSync(root)) {
            return; // The production image has no templates/ folder; the copy in src/ is what ships.
        }

        for (const entry of COMMUNITY_TEMPLATES) {
            expect(entry.json, entry.slug).toBe(readFileSync(join(root, entry.slug, 'template.json'), 'utf8'));
        }
    });

    it('publishes all five once, and again changes nothing', async () => {
        expect(await seedCommunity(db)).toEqual({ published: 5, alreadyPresent: 0 });
        expect(await seedCommunity(db)).toEqual({ published: 0, alreadyPresent: 5 });
        expect((await get('/api/templates?pageSize=50')).json().total).toBe(5);
    });

    it.each(COMMUNITY_TEMPLATES.map((entry) => [entry.slug, entry] as const))('%s is served with no audit failure and its resources', async (_slug, entry) => {
        await seedCommunity(db);

        const detail = (await get(`/api/templates/${entry.identifier}`)).json();

        expect(detail.badge).toBe('auto-checked');
        expect(detail.audit.counts.fail).toBe(0);
        expect(detail.publisher).toBe('XOGrid');

        const resources = detail.template.resources as { name: string; url: string }[];

        expect(resources.length).toBeGreaterThanOrEqual(2);
        expect(resources.every((resource) => resource.name.length > 0 && resource.url.startsWith('https://'))).toBe(true);
        expect(resources.some((resource) => resource.url.includes('XOGrid-Cash/Blaze2026_XOGrid'))).toBe(true);
    });

    it('serves the exact published JSON at /raw so a copy imports as it is', async () => {
        await seedCommunity(db);

        const entry = COMMUNITY_TEMPLATES[0]!;
        const raw = await get(`/api/templates/${entry.identifier}/raw`);

        expect(raw.statusCode).toBe(200);
        expect(generateTemplateIdentifier(parseTemplate(raw.body))).toBe(entry.identifier);
    });

    it('adds the five to a registry that already holds data, without touching the spotlight', async () => {
        await seed(db);

        const before = (await get('/api/spotlight')).json();

        // A moderator picks something else for the spotlight.
        const drip = COMMUNITY_TEMPLATES.find((entry) => entry.slug === 'drip-mine')!;

        await seedCommunity(db);
        await setSpotlight(db, drip.identifier, 'Chosen by a moderator for the Home page.', 0);

        const chosen = (await get('/api/spotlight')).json();

        expect(await seedCommunity(db)).toEqual({ published: 0, alreadyPresent: 5 });
        expect((await get('/api/spotlight')).json()).toEqual(chosen);
        expect(JSON.stringify(chosen)).not.toBe(JSON.stringify(before));
        expect((await get('/api/templates?pageSize=50')).json().total).toBe(11);
    });

    it('does not bring back a template a moderator removed', async () => {
        await seedCommunity(db);

        const entry = COMMUNITY_TEMPLATES[0]!;

        await db
            .updateTable('templates')
            .set({ removed: 1, removed_reason: 'test removal' })
            .where('identifier', '=', entry.identifier)
            .execute();

        expect(await seedCommunity(db)).toEqual({ published: 0, alreadyPresent: 5 });
        expect((await get(`/api/templates/${entry.identifier}/raw`)).statusCode).toBe(410);
    });
});
