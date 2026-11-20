import { binToHex, secp256k1 } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedAdmins } from '../src/admin.js';
import { buildApp } from '../src/app.js';
import { signChallengeTransaction } from '../src/auth/challenge-transaction.js';
import type { Db } from '../src/db.js';
import { seed } from '../src/seed.js';
import { matchKeyOf, resolveNames } from '../src/user-names.js';
import { addressOfPublicKey } from '../src/user-reviews.js';
import { freshDb } from './helpers.js';

const mod = new Uint8Array(32).fill(41);
const carol = new Uint8Array(32).fill(42);
const dave = new Uint8Array(32).fill(43);
const pub = (key: Uint8Array): string => binToHex(secp256k1.derivePublicKeyCompressed(key) as Uint8Array);
const carolAddress = addressOfPublicKey(pub(carol));
const carolBare = carolAddress.slice('bitcoincash:'.length);

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
    db = await freshDb();
    await seed(db);
    await seedAdmins(db, `mod=${pub(mod)}`);
    app = await buildApp(db, { rateLimit: false, clock: () => 1_000_000 });
});

afterEach(async () => {
    await app.close();
    await db.destroy();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, token?: string) =>
    app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(): Promise<string> {
    const { nonce } = (await call('POST', '/api/admin/challenge')).json() as { nonce: string };

    return (await call('POST', '/api/admin/login', { nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(nonce, mod) } })).json().token;
}

const firstId = async (): Promise<string> => (await call('GET', '/api/templates')).json().items[0].identifier;

describe('matchKeyOf', () => {
    it('gives a public key and every form of its P2PKH address the same key', () => {
        const key = matchKeyOf(pub(carol));

        expect(key).toMatch(/^[0-9a-f]{40}$/);
        expect(matchKeyOf(carolAddress)).toBe(key);
        expect(matchKeyOf(carolBare)).toBe(key);
        expect(matchKeyOf(` ${carolAddress.toUpperCase()} `)).toBe(key);
    });

    it('returns null for anything that is not a P2PKH identity', () => {
        expect(matchKeyOf('anonymous')).toBeNull();
        expect(matchKeyOf('')).toBeNull();
        expect(matchKeyOf('bitcoincash:qqqq')).toBeNull();
    });
});

describe('admin user routes', () => {
    it('require a moderator session', async () => {
        expect((await call('GET', '/api/admin/users')).statusCode).toBe(401);
        expect((await call('POST', '/api/admin/users', { name: 'Carol', addresses: [] })).statusCode).toBe(401);
        expect((await call('DELETE', '/api/admin/users/1')).statusCode).toBe(401);
    });

    it('create, rename, add and remove addresses, and delete a user', async () => {
        const token = await login();
        const created = await call('POST', '/api/admin/users', { name: '  Carol  ', addresses: [carolAddress, carolBare] }, token);

        expect(created.statusCode).toBe(201);
        expect(created.json().name).toBe('Carol');
        // Two forms of one address are stored once.
        expect(created.json().addresses).toHaveLength(1);

        const id = created.json().id as number;

        expect((await call('PUT', `/api/admin/users/${id}`, { name: 'Carol B.' }, token)).json().name).toBe('Carol B.');
        expect((await call('POST', `/api/admin/users/${id}/addresses`, { addresses: [pub(dave)] }, token)).json().addresses).toHaveLength(2);
        expect((await call('DELETE', `/api/admin/users/${id}/addresses/${encodeURIComponent(carolBare)}`, undefined, token)).json().addresses).toHaveLength(1);
        expect((await call('GET', '/api/admin/users', undefined, token)).json().items).toHaveLength(1);
        expect((await call('DELETE', `/api/admin/users/${id}`, undefined, token)).statusCode).toBe(200);
        expect((await call('GET', '/api/admin/users', undefined, token)).json().items).toHaveLength(0);
        expect(await db.selectFrom('user_addresses').selectAll().execute()).toHaveLength(0);

        const log = await db.selectFrom('moderation_log').select('action').execute();

        expect(log.map((row) => row.action)).toEqual(
            expect.arrayContaining(['user-create', 'user-rename', 'user-address-add', 'user-address-remove', 'user-delete']),
        );
    });

    it('reject bad input, a taken name, and an address registered to someone else', async () => {
        const token = await login();

        expect((await call('POST', '/api/admin/users', { name: 'x', addresses: [] }, token)).statusCode).toBe(400);
        expect((await call('POST', '/api/admin/users', { name: 'Carol', addresses: ['not-an-address'] }, token)).statusCode).toBe(400);

        const carolUser = (await call('POST', '/api/admin/users', { name: 'Carol', addresses: [carolAddress] }, token)).json();

        expect((await call('POST', '/api/admin/users', { name: 'carol', addresses: [] }, token)).statusCode).toBe(409);

        const daveUser = (await call('POST', '/api/admin/users', { name: 'Dave', addresses: [pub(dave)] }, token)).json();
        // Carol's public key is the same wallet as her registered address.
        const conflict = await call('POST', `/api/admin/users/${daveUser.id}/addresses`, { addresses: [pub(carol)] }, token);

        expect(conflict.statusCode).toBe(409);
        expect(conflict.json().error).toContain('Carol');
        expect((await call('PUT', `/api/admin/users/${carolUser.id}`, { name: 'Dave' }, token)).statusCode).toBe(409);
        expect((await call('PUT', '/api/admin/users/9999', { name: 'Nobody' }, token)).statusCode).toBe(404);
    });
});

describe('names on public data', () => {
    it('shows the publisher name on summaries and detail, and Explore search finds it', async () => {
        const token = await login();
        const identifier = await firstId();

        await db.updateTable('templates').set({ publisher: carolBare }).where('identifier', '=', identifier).execute();

        const before = (await call('GET', `/api/templates/${identifier}`)).json();

        expect(before.publisherName).toBeNull();

        await call('POST', '/api/admin/users', { name: 'Carol Studio', addresses: [carolAddress] }, token);

        const detail = (await call('GET', `/api/templates/${identifier}`)).json();

        expect(detail.publisher).toBe(carolBare);
        expect(detail.publisherName).toBe('Carol Studio');

        const found = (await call('GET', '/api/templates?query=carol%20stud')).json();

        expect(found.items.map((item: { identifier: string }) => item.identifier)).toEqual([identifier]);
        expect(found.items[0].publisherName).toBe('Carol Studio');
    });

    it('shows the reviewer name on public and admin review lists', async () => {
        const token = await login();
        const identifier = await firstId();
        const started = (await call('POST', `/api/templates/${identifier}/reviews/challenge`, { rating: 4, body: 'Solid template.' })).json();

        await call('POST', `/api/templates/${identifier}/reviews`, { nonce: started.nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(started.nonce, carol) } });

        expect((await call('GET', `/api/templates/${identifier}/reviews`)).json().items[0].reviewerName).toBeNull();

        await call('POST', '/api/admin/users', { name: 'Carol', addresses: [carolBare] }, token);

        const publicItem = (await call('GET', `/api/templates/${identifier}/reviews`)).json().items[0];

        expect(publicItem.reviewerName).toBe('Carol');
        expect(publicItem.reviewerAddress).toBe(carolAddress);

        const adminItem = (await call('GET', '/api/admin/user-reviews', undefined, token)).json().items[0];

        expect(adminItem.reviewerName).toBe('Carol');
        expect(adminItem.reviewerAddress).toBe(carolAddress);
    });

    it('resolveNames ignores identities without a name', async () => {
        expect((await resolveNames(db, ['anonymous', carolAddress])).size).toBe(0);
    });
});
