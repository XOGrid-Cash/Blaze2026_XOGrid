import { faucetCashTemplate, p2pkhTemplate } from '@xo-cash/templates';
import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CATEGORIES, categoryCounts, normalizeCategories, setCategories } from '../src/categories.js';
import type { Db } from '../src/db.js';
import { publishTemplate } from '../src/registry.js';
import { seed, seedCategories, seedCommunity } from '../src/seed.js';
import { COMMUNITY_TEMPLATES } from '../src/templates/community.js';
import { freshDb } from './helpers.js';

const idOf = (template: unknown): string => generateTemplateIdentifier(parseTemplate(serializeTemplate(template as never)));
const P2PKH = serializeTemplate(p2pkhTemplate as never);
const FAUCET = serializeTemplate(faucetCashTemplate as never);

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

const categoriesOf = async (identifier: string): Promise<string[]> => ((await app.inject({ method: 'GET', url: `/api/templates/${identifier}` })).json().categories as string[]);

describe('normalizeCategories', () => {
    it('treats nothing as no categories', () => {
        expect(normalizeCategories(undefined)).toEqual([]);
        expect(normalizeCategories(null)).toEqual([]);
        expect(normalizeCategories([])).toEqual([]);
    });

    it('drops duplicates and puts the result in the display order', () => {
        expect(normalizeCategories(['chipnet', 'payment', 'chipnet', 'identity'])).toEqual(['payment', 'identity', 'chipnet']);
    });

    it('refuses unknown names and anything that is not a list, instead of guessing', () => {
        expect(() => normalizeCategories(['payment', 'banking'])).toThrow(/Unknown category: banking/);
        expect(() => normalizeCategories('payment')).toThrow(/list of category names/);
        expect(() => normalizeCategories([1, 2])).toThrow(/Unknown categories/);
        expect(() => normalizeCategories(Array(50).fill('payment'))).toThrow(/list of category names/);
    });

    it('offers payment, identity and chipnet among the categories', () => {
        const slugs = CATEGORIES.map((category) => category.slug);

        expect(slugs).toEqual(expect.arrayContaining(['payment', 'identity', 'chipnet']));
    });
});

describe('publishing with categories', () => {
    it('files a new template under every category chosen, and returns them', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/templates', payload: { template: P2PKH, categories: ['chipnet', 'payment'] } });

        expect(response.statusCode).toBe(201);
        expect(response.json().categories).toEqual(['payment', 'chipnet']);
        expect(await categoriesOf(response.json().identifier)).toEqual(['payment', 'chipnet']);
    });

    it('still publishes with no categories at all', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/templates', payload: { template: P2PKH } });

        expect(response.statusCode).toBe(201);
        expect(response.json().categories).toEqual([]);
    });

    it('refuses an unknown category and publishes nothing', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/templates', payload: { template: P2PKH, categories: ['banking'] } });

        expect(response.statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/api/templates' })).json().total).toBe(0);
    });

    it('lets the first publisher file it, but nobody re-file it by publishing it again', async () => {
        const first = await publishTemplate(db, P2PKH, 'alice', ['payment']);
        const second = await publishTemplate(db, P2PKH, 'mallory', ['identity']);

        expect(first.categories).toEqual(['payment']);
        expect(second.created).toBe(false);
        expect(second.categories).toEqual(['payment']);
    });

    it('lets a re-publish file a template that has no categories yet', async () => {
        await publishTemplate(db, P2PKH, 'alice');

        expect((await publishTemplate(db, P2PKH, 'alice', ['identity'])).categories).toEqual(['identity']);
    });
});

describe('filtering by category', () => {
    beforeEach(async () => {
        await publishTemplate(db, P2PKH, 'a', ['payment', 'identity']);
        await publishTemplate(db, FAUCET, 'b', ['payment', 'chipnet']);
    });

    const names = async (url: string): Promise<string[]> => ((await app.inject({ method: 'GET', url })).json().items as { identifier: string }[]).map((item) => item.identifier);

    it('shows everything with no category, as before', async () => {
        expect(await names('/api/templates')).toHaveLength(2);
        expect(await names('/api/templates?category=')).toHaveLength(2);
    });

    it('shows a template under each of its categories', async () => {
        expect(await names('/api/templates?category=payment')).toHaveLength(2);
        expect(await names('/api/templates?category=identity')).toEqual([idOf(p2pkhTemplate)]);
        expect(await names('/api/templates?category=chipnet')).toEqual([idOf(faucetCashTemplate)]);
        expect(await names('/api/templates?category=tokens')).toEqual([]);
    });

    it('combines with search and the other filters', async () => {
        expect(await names('/api/templates?category=payment&query=faucet')).toEqual([idOf(faucetCashTemplate)]);
        expect(await names('/api/templates?category=identity&query=faucet')).toEqual([]);
    });

    it('rejects a category that does not exist', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/templates?category=banking' });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatch(/category must be one of/);
    });

    it('puts the categories on every summary', async () => {
        const items = (await app.inject({ method: 'GET', url: '/api/templates' })).json().items as { identifier: string; categories: string[] }[];

        expect(items.find((item) => item.identifier === idOf(p2pkhTemplate))?.categories).toEqual(['payment', 'identity']);
    });
});

describe('category counts', () => {
    it('counts live templates per category and the total, with every category listed', async () => {
        await publishTemplate(db, P2PKH, 'a', ['payment', 'identity']);
        await publishTemplate(db, FAUCET, 'b', ['payment']);

        const counts = (await app.inject({ method: 'GET', url: '/api/categories' })).json();

        expect(counts.total).toBe(2);
        expect(counts.categories.map((category: { slug: string }) => category.slug)).toEqual(CATEGORIES.map((category) => category.slug));
        expect(Object.fromEntries(counts.categories.map((category: { slug: string; count: number }) => [category.slug, category.count]))).toMatchObject({ payment: 2, identity: 1, chipnet: 0 });
    });

    it('leaves removed templates out', async () => {
        await publishTemplate(db, P2PKH, 'a', ['payment']);
        await db.updateTable('templates').set({ removed: 1, removed_reason: 'test' }).execute();

        expect(await categoryCounts(db)).toMatchObject({ total: 0, categories: expect.arrayContaining([{ slug: 'payment', label: 'Payment', count: 0 }]) });
    });
});

describe('moderators re-filing', () => {
    it('needs a moderator sign-in', async () => {
        const response = await app.inject({ method: 'PUT', url: `/api/admin/templates/${idOf(p2pkhTemplate)}/categories`, payload: { categories: ['identity'] } });

        expect(response.statusCode).toBe(401);
    });

    it('replaces the categories, and a restart does not undo it', async () => {
        await seed(db);

        const identifier = idOf(p2pkhTemplate);

        expect((await app.inject({ method: 'GET', url: `/api/templates/${identifier}` })).json().categories).toEqual(['payment']);

        await setCategories(db, identifier, ['identity']);
        await seedCategories(db);
        await seedCommunity(db);

        expect(await categoriesOf(identifier)).toEqual(['identity']);
    });
});

describe('built-in templates', () => {
    it('files the shipped and community templates, and is safe to run again', async () => {
        await seed(db);
        await seedCommunity(db);
        await seedCategories(db);

        const everything = (await app.inject({ method: 'GET', url: '/api/templates?pageSize=50' })).json().items as { identifier: string; categories: string[] }[];

        expect(everything.length).toBe(11);
        expect(everything.every((item) => item.categories.length > 0)).toBe(true);
        expect(everything.find((item) => item.identifier === COMMUNITY_TEMPLATES.find((entry) => entry.slug === 'badgers-stake')!.identifier)?.categories).toEqual(['payment', 'staking']);
        expect((await app.inject({ method: 'GET', url: '/api/templates?category=chipnet' })).json().total).toBe(1);
    });

    it('fills in categories on a registry that was seeded before categories existed', async () => {
        await seed(db);
        await db.deleteFrom('template_categories').execute();

        await seedCommunity(db);

        expect((await app.inject({ method: 'GET', url: '/api/templates?category=payment' })).json().total).toBeGreaterThan(0);
    });
});
