import { secp256k1, binToHex, encodeTransaction, encodeLockingBytecodeP2pkh, hash160 } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedAdmins, isValidAdminIdentity } from '../src/admin.js';
import { buildApp } from '../src/app.js';
import { buildChallengeTransaction, signChallengeTransaction } from '../src/auth/challenge-transaction.js';
import { signMessage } from '../src/auth/signed-message.js';
import type { Db } from '../src/db.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

const keyA = new Uint8Array(32).fill(11);
const keyB = new Uint8Array(32).fill(22);
const pub = (key: Uint8Array): string => binToHex(secp256k1.derivePublicKeyCompressed(key) as Uint8Array);

let db: Db;
let app: FastifyInstance;
let clock = 1_000_000;

beforeEach(async () => {
    clock = 1_000_000;
    db = await freshDb();
    await seed(db);
    await seedAdmins(db, `alice=${pub(keyA)}`);
    app = await buildApp(db, { rateLimit: false, clock: () => clock });
});

afterEach(async () => {
    await app.close();
    await db.destroy();
});

const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token?: string) =>
    app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

const challenge = async () => (await call('POST', '/api/admin/challenge')).json() as { nonce: string; message: string };

async function loginWithTransaction(key = keyA) {
    const { nonce } = await challenge();

    return call('POST', '/api/admin/login', { nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(nonce, key) } });
}

async function token(): Promise<string> {
    return (await loginWithTransaction()).json().token as string;
}

const firstId = async (): Promise<string> => (await call('GET', '/api/templates')).json().items[0].identifier;

describe('login', () => {
    it('accepts a transaction proof from an allowlisted key', async () => {
        const res = await loginWithTransaction();

        expect(res.statusCode).toBe(200);
        expect(res.json().admin).toBe('alice');
        expect(res.json().token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('accepts a message proof from an allowlisted key', async () => {
        const { nonce, message } = await challenge();
        const res = await call('POST', '/api/admin/login', { nonce, proof: { type: 'message', signature: signMessage(message, keyA) } });

        expect(res.statusCode).toBe(200);
    });

    it('rejects a valid proof from a key that is not on the allowlist', async () => {
        const res = await loginWithTransaction(keyB);

        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Login failed.' });
    });

    it('rejects a proof signed for a different nonce', async () => {
        const first = await challenge();
        const second = await challenge();
        const res = await call('POST', '/api/admin/login', {
            nonce: second.nonce,
            proof: { type: 'transaction', signedTransaction: signChallengeTransaction(first.nonce, keyA) },
        });

        expect(res.statusCode).toBe(401);
    });

    it('spends a nonce on the first attempt, even a failed one', async () => {
        const { nonce } = await challenge();
        const good = { nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(nonce, keyA) } };

        expect((await call('POST', '/api/admin/login', { nonce, proof: { type: 'transaction', signedTransaction: 'zz' } })).statusCode).toBe(401);
        expect((await call('POST', '/api/admin/login', good)).statusCode).toBe(401);
    });

    it('does not allow a successful login to be replayed', async () => {
        const { nonce } = await challenge();
        const body = { nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(nonce, keyA) } };

        expect((await call('POST', '/api/admin/login', body)).statusCode).toBe(200);
        expect((await call('POST', '/api/admin/login', body)).statusCode).toBe(401);
    });

    it('rejects an expired challenge', async () => {
        const { nonce } = await challenge();

        clock += 5 * 60 * 1000 + 1;

        const res = await call('POST', '/api/admin/login', { nonce, proof: { type: 'transaction', signedTransaction: signChallengeTransaction(nonce, keyA) } });

        expect(res.statusCode).toBe(401);
    });

    it('rejects an unknown nonce and malformed bodies', async () => {
        expect((await call('POST', '/api/admin/login', { nonce: 'nope', proof: { type: 'message', signature: 'x' } })).statusCode).toBe(401);
        expect((await call('POST', '/api/admin/login', { nonce: 'x' })).statusCode).toBe(400);
        expect((await call('POST', '/api/admin/login', { proof: { type: 'message', signature: 'x' } })).statusCode).toBe(400);
    });

    it('matches an allowlist entry given as a P2PKH address', async () => {
        const { encodeCashAddress, hash160, CashAddressType } = await import('@bitauth/libauth');
        const publicKey = secp256k1.derivePublicKeyCompressed(keyB) as Uint8Array;
        const address = (encodeCashAddress({ payload: hash160(publicKey), prefix: 'bitcoincash', type: CashAddressType.p2pkh }) as { address: string }).address;

        await seedAdmins(db, `bob=${address}`);

        expect((await loginWithTransaction(keyB)).json().admin).toBe('bob');
    });
});

describe('sessions', () => {
    it('requires a session for every admin route', async () => {
        const routes: ['GET' | 'POST' | 'PUT', string][] = [
            ['GET', '/api/admin/me'],
            ['GET', '/api/admin/summary'],
            ['GET', '/api/admin/flags'],
            ['POST', '/api/admin/logout'],
            ['POST', '/api/admin/flags/1/resolve'],
            ['POST', '/api/admin/templates/x/review'],
            ['POST', '/api/admin/templates/x/remove'],
            ['POST', '/api/admin/templates/x/restore'],
            ['PUT', '/api/admin/templates/x/categories'],
            ['PUT', '/api/admin/spotlight'],
            ['GET', '/api/admin/templates'],
            ['GET', '/api/admin/user-reviews'],
            ['POST', '/api/admin/user-reviews/1/hide'],
            ['POST', '/api/admin/user-reviews/1/unhide'],
        ];

        for (const [method, url] of routes) {
            expect((await call(method, url, {})).statusCode, `${method} ${url}`).toBe(401);
            expect((await call(method, url, {}, 'bogus')).statusCode, `${method} ${url} bogus`).toBe(401);
        }
    });

    it('expires after an hour', async () => {
        const t = await token();

        expect((await call('GET', '/api/admin/me', undefined, t)).statusCode).toBe(200);

        clock += 60 * 60 * 1000 + 1;

        expect((await call('GET', '/api/admin/me', undefined, t)).statusCode).toBe(401);
    });

    it('ends on logout', async () => {
        const t = await token();

        expect((await call('POST', '/api/admin/logout', {}, t)).statusCode).toBe(200);
        expect((await call('GET', '/api/admin/me', undefined, t)).statusCode).toBe(401);
    });
});

describe('moderation', () => {
    it('records a review, flips the badge to reviewed, and refuses a second review by the same moderator', async () => {
        const t = await token();
        const id = await firstId();
        const res = await call('POST', `/api/admin/templates/${id}/review`, { note: 'Read the scripts; looks fine.' }, t);

        expect(res.statusCode).toBe(201);

        const detail = (await call('GET', `/api/templates/${id}`)).json();

        expect(detail.badge).toBe('reviewed');
        expect((await call('POST', `/api/admin/templates/${id}/review`, { note: 'again please' }, t)).statusCode).toBe(409);
        expect((await call('POST', `/api/admin/templates/${id}/review`, { note: 'x' }, t)).statusCode).toBe(400);
        expect((await call('POST', '/api/admin/templates/nope/review', { note: 'a note' }, t)).statusCode).toBe(404);
    });

    it('removes a template, leaves a tombstone, drops it from spotlight, and can restore it', async () => {
        const t = await token();
        const spotlighted = (await call('GET', '/api/spotlight')).json().items[0].identifier as string;

        expect((await call('POST', `/api/admin/templates/${spotlighted}/remove`, { reason: 'x' }, t)).statusCode).toBe(400);
        expect((await call('POST', `/api/admin/templates/${spotlighted}/remove`, { reason: 'Misleading description' }, t)).statusCode).toBe(200);

        const detail = (await call('GET', `/api/templates/${spotlighted}`)).json();

        expect(detail.template).toBeNull();
        expect(detail.removed).toBe(true);
        expect((await call('GET', '/api/spotlight')).json().items.map((i: { identifier: string }) => i.identifier)).not.toContain(spotlighted);
        expect(await db.selectFrom('spotlight').select('identifier').where('identifier', '=', spotlighted).execute()).toHaveLength(0);
        expect((await call('POST', `/api/admin/templates/${spotlighted}/review`, { note: 'a note' }, t)).statusCode).toBe(409);
        expect((await call('POST', `/api/admin/templates/${spotlighted}/restore`, {}, t)).statusCode).toBe(200);
        expect((await call('GET', `/api/templates/${spotlighted}`)).json().removed).toBe(false);
    });

    it('lists open flags and resolves them', async () => {
        const t = await token();
        const id = await firstId();

        await call('POST', `/api/templates/${id}/flags`, { reason: 'Looks like a scam template' });

        expect((await call('GET', `/api/templates/${id}`)).json().openFlags).toBe(1);

        const open = (await call('GET', '/api/admin/flags', undefined, t)).json().items;

        expect(open).toHaveLength(1);
        expect(open[0].identifier).toBe(id);
        expect((await call('POST', `/api/admin/flags/${open[0].id}/resolve`, { status: 'maybe' }, t)).statusCode).toBe(400);
        expect((await call('POST', '/api/admin/flags/9999/resolve', { status: 'dismissed' }, t)).statusCode).toBe(404);
        expect((await call('POST', `/api/admin/flags/${open[0].id}/resolve`, { status: 'dismissed' }, t)).statusCode).toBe(200);
        expect((await call('GET', '/api/admin/flags', undefined, t)).json().items).toHaveLength(0);
        expect((await call('GET', `/api/templates/${id}`)).json().openFlags).toBe(0);
    });

    it('replaces the spotlight and validates it', async () => {
        const t = await token();
        const id = await firstId();

        expect((await call('PUT', '/api/admin/spotlight', { items: [{ identifier: id, blurb: 'Hand picked' }] }, t)).json().count).toBe(1);
        expect((await call('GET', '/api/spotlight')).json().items).toHaveLength(1);
        expect((await call('PUT', '/api/admin/spotlight', { items: [{ identifier: 'nope', blurb: 'Hand picked' }] }, t)).statusCode).toBe(400);
        expect((await call('PUT', '/api/admin/spotlight', { items: 'x' }, t)).statusCode).toBe(400);
        expect((await call('GET', '/api/spotlight')).json().items).toHaveLength(1);
    });

    it('summarises the registry and logs every action', async () => {
        const t = await token();
        const id = await firstId();

        await call('POST', `/api/admin/templates/${id}/review`, { note: 'checked it' }, t);

        const summary = (await call('GET', '/api/admin/summary', undefined, t)).json();

        expect(summary.templates.total).toBe(6);
        expect(summary.templates.byBadge.reviewed).toBe(1);
        expect(summary.reviews).toBe(1);
        expect(summary.recentActions.map((a: { action: string }) => a.action)).toEqual(['review', 'login']);
    });
});

describe('allowlist seeding', () => {
    it('validates identities and reports skipped entries', async () => {
        const result = await seedAdmins(db, `carol=${pub(keyB)}, broken=hello, =${pub(keyA)}, noequals`);

        expect(result.added).toEqual(['carol']);
        expect(result.skipped).toHaveLength(3);
        expect(isValidAdminIdentity('02' + 'aa'.repeat(32))).toBe(true);
        expect(isValidAdminIdentity('04' + 'aa'.repeat(32))).toBe(false);
    });

    it('is safe to run on every start', async () => {
        await seedAdmins(db, `alice=${pub(keyA)}`);
        await seedAdmins(db, `alice=${pub(keyA)}`);

        expect(await db.selectFrom('admins').selectAll().execute()).toHaveLength(1);
    });
});


describe('wallet sign request on the login challenge', () => {
    const publicKey = pub(keyA);

    it('adds a walletSignRequest only when a public key is sent', async () => {
        const plain = (await call('POST', '/api/admin/challenge', {})).json();
        const withKey = (await call('POST', '/api/admin/challenge', { publicKey })).json();

        expect(plain.walletSignRequest).toBeUndefined();
        expect(withKey.walletSignRequest).toBeDefined();
        expect(withKey.walletSignRequest.broadcast).toBe(false);
    });

    it('builds the request around this nonce and this key, so the wallet signs exactly what login verifies', async () => {
        const { nonce, walletSignRequest } = (await call('POST', '/api/admin/challenge', { publicKey })).json();
        const expected = buildChallengeTransaction(nonce, secp256k1.derivePublicKeyCompressed(keyA) as Uint8Array);

        expect(walletSignRequest.transaction).toBe(binToHex(encodeTransaction(expected.transaction)));
        expect(walletSignRequest.sourceOutputs).toHaveLength(1);
        expect(walletSignRequest.sourceOutputs[0].lockingBytecode).toBe(
            binToHex(encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(keyA) as Uint8Array))),
        );
    });

    it('ignores a malformed public key instead of failing', async () => {
        for (const bad of ['', 'zz', '04' + '11'.repeat(32), 42]) {
            const res = await call('POST', '/api/admin/challenge', { publicKey: bad });

            expect(res.statusCode).toBe(200);
            expect(res.json().walletSignRequest).toBeUndefined();
        }
    });
});

describe('admin template list', () => {
    it('includes removed templates, which the public list hides', async () => {
        const t = await token();
        const id = await firstId();
        const before = (await call('GET', '/api/admin/templates', undefined, t)).json();

        expect(before.items.every((item: { removed: boolean }) => !item.removed)).toBe(true);

        await call('POST', `/api/admin/templates/${id}/remove`, { reason: 'Misleading description' }, t);

        const adminList = (await call('GET', '/api/admin/templates?pageSize=50', undefined, t)).json();
        const publicList = (await call('GET', '/api/templates?pageSize=50')).json();
        const tombstone = adminList.items.find((item: { identifier: string }) => item.identifier === id);

        expect(tombstone.removed).toBe(true);
        expect(tombstone.removedReason).toBe('Misleading description');
        expect(adminList.total).toBe(publicList.total + 1);
        expect(publicList.items.map((item: { identifier: string }) => item.identifier)).not.toContain(id);
    });

    it('supports search and paging', async () => {
        const t = await token();
        const all = (await call('GET', '/api/admin/templates?pageSize=50', undefined, t)).json();
        const small = (await call('GET', '/api/admin/templates?pageSize=2&page=2', undefined, t)).json();
        const found = (await call('GET', '/api/admin/templates?query=voucher', undefined, t)).json();

        expect(small.items).toHaveLength(2);
        expect(small.total).toBe(all.total);
        expect(found.items.length).toBeGreaterThan(0);
        expect(found.items.every((item: { name: string; description: string }) => /voucher/i.test(item.name + item.description))).toBe(true);
    });
});

describe('re-filing categories', () => {
    const adminItem = async (t: string, id: string) =>
        ((await call('GET', '/api/admin/templates?pageSize=50', undefined, t)).json().items as { identifier: string; categories: string[] }[]).find((item) => item.identifier === id);

    it('replaces a template\'s categories, drops duplicates, keeps the canonical order and logs it', async () => {
        const t = await token();
        const id = await firstId();
        const res = await call('PUT', `/api/admin/templates/${id}/categories`, { categories: ['tokens', 'payment', 'tokens'] }, t);

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ identifier: id, categories: ['payment', 'tokens'] });
        expect((await call('GET', `/api/templates/${id}`)).json().categories).toEqual(['payment', 'tokens']);
        expect((await adminItem(t, id))?.categories).toEqual(['payment', 'tokens']);

        const recent = (await call('GET', '/api/admin/summary', undefined, t)).json().recentActions as { actor: string; action: string; identifier: string | null; note: string }[];

        expect(recent.find((entry) => entry.action === 'categories' && entry.identifier === id)).toMatchObject({ actor: 'alice', note: 'payment, tokens' });
    });

    it('can clear a template\'s categories', async () => {
        const t = await token();
        const id = await firstId();

        await call('PUT', `/api/admin/templates/${id}/categories`, { categories: ['payment'] }, t);

        expect((await call('PUT', `/api/admin/templates/${id}/categories`, { categories: [] }, t)).json().categories).toEqual([]);
        expect((await adminItem(t, id))?.categories).toEqual([]);
    });

    it('refuses an unknown category and an unknown template, and changes nothing', async () => {
        const t = await token();
        const id = await firstId();
        const before = (await adminItem(t, id))?.categories;

        expect((await call('PUT', `/api/admin/templates/${id}/categories`, { categories: ['banking'] }, t)).statusCode).toBe(400);
        expect((await call('PUT', `/api/admin/templates/${id}/categories`, { categories: 'payment' }, t)).statusCode).toBe(400);
        expect((await call('PUT', `/api/admin/templates/${'f'.repeat(64)}/categories`, { categories: ['payment'] }, t)).statusCode).toBe(404);
        expect((await adminItem(t, id))?.categories).toEqual(before);
    });
});
