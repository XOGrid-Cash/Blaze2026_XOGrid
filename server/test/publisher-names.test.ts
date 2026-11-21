import { binToHex, secp256k1 } from '@bitauth/libauth';
import { faucetCashTemplate, p2pkhTemplate } from '@xo-cash/templates';
import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedAdmins } from '../src/admin.js';
import { buildApp } from '../src/app.js';
import { signChallengeTransaction } from '../src/auth/challenge-transaction.js';
import type { Db } from '../src/db.js';
import { normalizePublisherName } from '../src/publisher-names.js';
import { addressOfPublicKey } from '../src/user-reviews.js';
import { freshDb } from './helpers.js';

const mod = new Uint8Array(32).fill(51);
const carol = new Uint8Array(32).fill(52);
const pub = (key: Uint8Array): string => binToHex(secp256k1.derivePublicKeyCompressed(key) as Uint8Array);
const carolAddress = addressOfPublicKey(pub(carol));
const P2PKH = serializeTemplate(p2pkhTemplate as never);
const FAUCET = serializeTemplate(faucetCashTemplate as never);
const idOf = (template: unknown): string => generateTemplateIdentifier(parseTemplate(serializeTemplate(template as never)));

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
    db = await freshDb();
    await seedAdmins(db, `mod=${pub(mod)}`);
    app = await buildApp(db, { rateLimit: false, clock: () => 1_000_000 });
});

afterEach(async () => {
    await app.close();
    await db.destroy();
});

const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token?: string) =>
    app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(): Promise<string> {
    const { nonce } = (await call('POST', '/api/admin/challenge')).json() as { nonce: string };

    return (await call('POST', '/api/admin/login', { nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(nonce, mod) } })).json().token;
}

const publish = (template: string, extra: Record<string, unknown> = {}) => call('POST', '/api/templates', { template, publisher: carolAddress, ...extra });
const detail = async (identifier: string) => (await call('GET', `/api/templates/${identifier}`)).json() as { publisher: string; publisherName: string | null };

describe('normalizePublisherName', () => {
    it('treats nothing as no name and tidies spaces', () => {
        expect(normalizePublisherName(undefined)).toBeNull();
        expect(normalizePublisherName(null)).toBeNull();
        expect(normalizePublisherName('   ')).toBeNull();
        expect(normalizePublisherName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    });

    it('refuses text that is too short or too long, not text, or hides characters', () => {
        expect(() => normalizePublisherName('A')).toThrow(/2 to 40/);
        expect(() => normalizePublisherName('x'.repeat(41))).toThrow(/2 to 40/);
        expect(() => normalizePublisherName(42)).toThrow(/must be text/);
        expect(() => normalizePublisherName('Ada\u202eLovelace')).toThrow(/not allowed/);
        expect(() => normalizePublisherName('Ada\u200bLovelace')).toThrow(/not allowed/);
        expect(() => normalizePublisherName('Ada\u0000Lovelace')).toThrow(/not allowed/);
    });
});

describe('naming a template when publishing', () => {
    it('shows the name the publisher gave, keeps the address, and finds the template by that name', async () => {
        const created = await publish(P2PKH, { publisherName: '  Ada   Lovelace ' });

        expect(created.statusCode).toBe(201);
        expect(await detail(created.json().identifier)).toMatchObject({ publisher: carolAddress, publisherName: 'Ada Lovelace' });

        const found = (await call('GET', '/api/templates?query=lovelace')).json() as { items: { identifier: string }[] };

        expect(found.items.map((item) => item.identifier)).toEqual([created.json().identifier]);
    });

    it('has no name when none is given', async () => {
        const created = await publish(FAUCET);

        expect((await detail(created.json().identifier)).publisherName).toBeNull();
        expect((await publish(P2PKH, { publisherName: '   ' })).statusCode).toBe(201);
        expect((await detail(idOf(p2pkhTemplate))).publisherName).toBeNull();
    });

    it('refuses a bad name and publishes nothing', async () => {
        for (const publisherName of ['A', 'x'.repeat(41), 7, 'Ada\u202eLovelace']) {
            expect((await publish(P2PKH, { publisherName })).statusCode, String(publisherName)).toBe(400);
        }

        expect((await call('GET', '/api/templates')).json().total).toBe(0);
    });

    it('lets only the first publisher name a template', async () => {
        const first = await publish(P2PKH, { publisherName: 'Ada Lovelace' });
        const again = await publish(P2PKH, { publisherName: 'Someone Else' });

        expect(again.statusCode).toBe(200);
        expect((await detail(first.json().identifier)).publisherName).toBe('Ada Lovelace');

        const unnamed = await publish(FAUCET);

        await publish(FAUCET, { publisherName: 'Latecomer' });

        expect((await detail(unnamed.json().identifier)).publisherName).toBeNull();
    });
});

describe('moderators changing the name', () => {
    it('requires a moderator session', async () => {
        const id = (await publish(P2PKH)).json().identifier as string;

        expect((await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: 'XO Team' })).statusCode).toBe(401);
        expect((await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: 'XO Team' }, 'bogus')).statusCode).toBe(401);
    });

    it('sets a name that beats the publisher\'s own, logs it, and can clear it', async () => {
        const t = await login();
        const id = (await publish(P2PKH, { publisherName: 'Ada Lovelace' })).json().identifier as string;
        const set = await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: ' XO   Team ' }, t);

        expect(set.statusCode).toBe(200);
        expect(set.json()).toEqual({ identifier: id, publisherName: 'XO Team' });
        expect((await detail(id)).publisherName).toBe('XO Team');

        const recent = (await call('GET', '/api/admin/summary', undefined, t)).json().recentActions as { actor: string; action: string; identifier: string | null; note: string }[];

        expect(recent.find((entry) => entry.action === 'publisher-name' && entry.identifier === id)).toMatchObject({ actor: 'mod', note: 'XO Team' });

        const cleared = await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: '' }, t);

        expect(cleared.json()).toEqual({ identifier: id, publisherName: null });
        expect((await detail(id)).publisherName).toBeNull();
    });

    it('refuses a bad name and an unknown template, and changes nothing', async () => {
        const t = await login();
        const id = (await publish(P2PKH, { publisherName: 'Ada Lovelace' })).json().identifier as string;

        expect((await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: 'A' }, t)).statusCode).toBe(400);
        expect((await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: 12 }, t)).statusCode).toBe(400);
        expect((await call('PUT', `/api/admin/templates/${'f'.repeat(64)}/publisher-name`, { name: 'XO Team' }, t)).statusCode).toBe(404);
        expect((await detail(id)).publisherName).toBe('Ada Lovelace');
    });

    it('lets a name a moderator registered for the wallet beat a self-chosen one', async () => {
        const t = await login();
        const id = (await publish(P2PKH, { publisherName: 'Totally The XO Team' })).json().identifier as string;

        expect((await call('POST', '/api/admin/users', { name: 'Carol', addresses: [carolAddress] }, t)).statusCode).toBe(201);
        expect((await detail(id)).publisherName).toBe('Carol');

        await call('PUT', `/api/admin/templates/${id}/publisher-name`, { name: 'Carol (verified)' }, t);

        expect((await detail(id)).publisherName).toBe('Carol (verified)');
    });
});
