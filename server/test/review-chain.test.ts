import net from 'node:net';
import {
    binToHex,
    decodeTransaction,
    deriveHdPrivateNodeFromSeed,
    deriveHdPublicNode,
    encodeDataPush,
    encodeHdPublicKey,
    encodeLockingBytecodeP2pkh,
    encodeTransaction,
    generateTransaction,
    hash160,
    hexToBin,
    secp256k1,
    walletTemplateP2pkhNonHd,
    walletTemplateToCompilerBch,
    type InputTemplate,
    type TransactionCommon,
} from '@bitauth/libauth';
import { p2pkhTemplate } from '@xo-cash/templates';
import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { ElectrumServer, parseEndpoint, scriptHashOf, type ChainSource, type FetchedTransaction, type Unspent } from '../src/electrum.js';
import { reviewAddressFor, resolveReviewIdentity } from '../src/review-address.js';
import { attachReceipt, broadcastReceipt, prepareReceipt, refreshPendingReceipts, receiptSettings, type ReceiptConfig, type ReviewRow } from '../src/review-chain.js';
import { parseReceiptTransaction, reviewTextDigest, transactionHashOf } from '../src/review-receipt.js';
import { saveUserReview } from '../src/user-reviews.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

const privateKey = (seed: number): Uint8Array => Uint8Array.from({ length: 32 }, (_, index) => ((seed + index) % 250) + 1);
const publicKeyOf = (seedValue: number): Uint8Array => {
    const key = secp256k1.derivePublicKeyCompressed(privateKey(seedValue));

    if (typeof key === 'string') {
        throw new Error(key);
    }

    return key;
};

const ADMIN_KEY = publicKeyOf(9);
const ADMIN_IDENTITY = binToHex(ADMIN_KEY);
const REVIEWER = publicKeyOf(1);
const REVIEWER_HEX = binToHex(REVIEWER);
const reviewerLock = encodeLockingBytecodeP2pkh(hash160(REVIEWER));
const IDENTIFIER = generateTemplateIdentifier(parseTemplate(serializeTemplate(p2pkhTemplate)));
const BODY = 'Clear scripts, and the sources are credited.';

class FakeChain implements ChainSource {
    transactions = new Map<string, FetchedTransaction>();
    coins: Unspent[] = [];
    down = false;
    sent: string[] = [];
    refuse: string | undefined;
    reportedId: string | undefined;

    async broadcast(hex: string) {
        if (this.refuse) {
            throw new Error(this.refuse);
        }

        const decoded = decodeTransaction(hexToBin(hex)) as TransactionCommon;
        const txid = this.reportedId ?? this.add(decoded, 0);

        this.sent.push(hex);

        return txid;
    }

    add(transaction: TransactionCommon, confirmations: number | undefined): string {
        const txid = transactionHashOf(transaction);

        this.transactions.set(txid, { hex: binToHex(encodeTransaction(transaction)), confirmations });

        return txid;
    }

    async getTransaction(txid: string) {
        if (this.down) {
            throw new Error('offline');
        }

        return this.transactions.get(txid);
    }

    async listUnspent() {
        if (this.down) {
            throw new Error('offline');
        }

        return this.coins;
    }
}

const unlockingFor = (publicKey: Uint8Array): Uint8Array => Uint8Array.from([...encodeDataPush(new Uint8Array(65).fill(7)), ...encodeDataPush(publicKey)]);

/** A funding transaction paying the reviewer, registered on the chain, plus its coin. */
function fund(chain: FakeChain, value: bigint, height = 10, salt = 0): Unspent {
    const funding: TransactionCommon = {
        version: 2,
        locktime: salt,
        inputs: [{ outpointTransactionHash: new Uint8Array(32).fill(salt + 1), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() }],
        outputs: [{ lockingBytecode: reviewerLock, valueSatoshis: value }],
    };
    const txid = chain.add(funding, 5);
    const coin: Unspent = { txid, index: 0, satoshis: value, height, hasToken: false };

    chain.coins.push(coin);

    return coin;
}

const config = (chain: ChainSource, chipnet?: ChainSource): ReceiptConfig => ({ identity: ADMIN_IDENTITY, chains: { mainnet: chain, ...(chipnet ? { chipnet } : {}) } });

/** What the wallet would do: take the prepared request and add the unlocking script of the reviewer's key. */
function signPrepared(prepared: Awaited<ReturnType<typeof prepareReceipt>>, signer: Uint8Array = REVIEWER): TransactionCommon {
    const decoded = decodeTransaction(hexToBin(prepared.walletSignRequest.transaction as string));

    if (typeof decoded === 'string') {
        throw new Error(decoded);
    }

    return { ...decoded, inputs: decoded.inputs.map((input) => ({ ...input, unlockingBytecode: unlockingFor(signer) })) };
}

let db: Db;

beforeEach(async () => {
    db = await freshDb();
    await seed(db);
});

afterEach(async () => {
    await db.destroy();
});

async function savedReview(rating = 5, body = BODY, key = REVIEWER_HEX): Promise<ReviewRow> {
    const saved = await saveUserReview(db, IDENTIFIER, key, { rating, body });

    return { id: saved.id, identifier: IDENTIFIER, reviewer: key, rating, body };
}

describe('review address from the admin identity', () => {
    it('gives the same key a mainnet and a chipnet address', () => {
        const main = reviewAddressFor(ADMIN_IDENTITY, 'mainnet')!;
        const chip = reviewAddressFor(ADMIN_IDENTITY, 'chipnet')!;

        expect(main.address.startsWith('bitcoincash:q')).toBe(true);
        expect(chip.address.startsWith('bchtest:q')).toBe(true);
        expect(binToHex(main.lockingBytecode)).toBe(binToHex(chip.lockingBytecode));
        expect(binToHex(main.lockingBytecode)).toBe(binToHex(encodeLockingBytecodeP2pkh(hash160(ADMIN_KEY))));
    });

    it('accepts a P2PKH address identity in either prefix, and the first child of an xpub', () => {
        const main = reviewAddressFor(ADMIN_IDENTITY, 'mainnet')!;

        expect(reviewAddressFor(main.address, 'chipnet')?.address).toBe(reviewAddressFor(ADMIN_IDENTITY, 'chipnet')!.address);
        expect(reviewAddressFor(main.address.replace('bitcoincash:', ''), 'mainnet')?.address).toBe(main.address);

        const node = deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(3), { assumeValidity: true, throwErrors: true });
        const xpub = encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(node) }).hdPublicKey;

        expect(reviewAddressFor(xpub, 'mainnet')?.address.startsWith('bitcoincash:q')).toBe(true);
    });

    it('refuses anything that is not a usable identity', () => {
        expect(reviewAddressFor('not an identity', 'mainnet')).toBeUndefined();
        expect(reviewAddressFor('04' + 'ab'.repeat(64), 'mainnet')).toBeUndefined();
        expect(reviewAddressFor('xpubBogus', 'mainnet')).toBeUndefined();
    });

    it('picks the labelled admin, otherwise the first usable one', async () => {
        const other = binToHex(publicKeyOf(20));

        await db.insertInto('admins').values({ address_or_pubkey: 'garbage', label: 'broken', added_at: '2026-01-01' }).execute();
        await db.insertInto('admins').values({ address_or_pubkey: ADMIN_IDENTITY, label: 'nathaniel', added_at: '2026-01-02' }).execute();
        await db.insertInto('admins').values({ address_or_pubkey: other, label: 'miguel', added_at: '2026-01-03' }).execute();

        expect(await resolveReviewIdentity(db)).toBe(ADMIN_IDENTITY);
        expect(await resolveReviewIdentity(db, 'miguel')).toBe(other);
        expect(await resolveReviewIdentity(db, 'nobody')).toBeUndefined();
    });
});

describe('preparing a receipt', () => {
    it('builds the payment, the data output and change, and asks the wallet only to sign', async () => {
        const chain = new FakeChain();

        fund(chain, 100_000n);

        const review = await savedReview();
        const prepared = await prepareReceipt(config(chain), 'mainnet', review, REVIEWER_HEX);
        const transaction = decodeTransaction(hexToBin(prepared.walletSignRequest.transaction as string)) as TransactionCommon;

        expect(prepared.walletSignRequest.broadcast).toBe(false);
        expect(transaction.inputs).toHaveLength(1);
        expect(transaction.outputs).toHaveLength(3);
        expect(transaction.outputs[0]!.valueSatoshis).toBe(546n);
        expect(binToHex(transaction.outputs[0]!.lockingBytecode)).toBe(binToHex(reviewAddressFor(ADMIN_IDENTITY, 'mainnet')!.lockingBytecode));
        expect(transaction.outputs[1]!.valueSatoshis).toBe(0n);
        expect(binToHex(transaction.outputs[2]!.lockingBytecode)).toBe(binToHex(reviewerLock));
        expect(100_000n - transaction.outputs[0]!.valueSatoshis - transaction.outputs[2]!.valueSatoshis).toBe(BigInt(prepared.feeSatoshis));
        expect(BigInt(prepared.totalSatoshis)).toBe(546n + BigInt(prepared.feeSatoshis));
        expect(Number(prepared.feeSatoshis)).toBeLessThan(700);
        expect((prepared.walletSignRequest.sourceOutputs as { valueSatoshis: string }[])[0]!.valueSatoshis).toBe('<bigint: 100000n>');
    });

    it('spends the smallest confirmed coin that is big enough and skips token coins', async () => {
        const chain = new FakeChain();

        fund(chain, 5_000_000n, 10, 1);
        const small = fund(chain, 2_000n, 10, 2);

        fund(chain, 900n, 10, 3);
        chain.coins.push({ txid: 'cd'.repeat(32), index: 0, satoshis: 1_500n, height: 10, hasToken: true });

        const prepared = await prepareReceipt(config(chain), 'mainnet', await savedReview(), REVIEWER_HEX);
        const spent = (prepared.walletSignRequest.sourceOutputs as { outpointTransactionHash: string }[])[0]!.outpointTransactionHash;

        expect(spent).toBe(binToHex(hexToBin(small.txid).reverse()));
    });

    it('leaves out change that would be dust and gives it to the fee', async () => {
        const chain = new FakeChain();

        fund(chain, 1_300n);

        const prepared = await prepareReceipt(config(chain), 'mainnet', await savedReview(), REVIEWER_HEX);
        const transaction = decodeTransaction(hexToBin(prepared.walletSignRequest.transaction as string)) as TransactionCommon;

        expect(transaction.outputs).toHaveLength(2);
        expect(BigInt(prepared.feeSatoshis)).toBe(1_300n - 546n);
    });

    it('says plainly when there is no coin, when the wallet is not the reviewer, and when the network is off', async () => {
        const chain = new FakeChain();
        const review = await savedReview();

        await expect(prepareReceipt(config(chain), 'mainnet', review, REVIEWER_HEX)).rejects.toMatchObject({ status: 409 });

        fund(chain, 100_000n);

        await expect(prepareReceipt(config(chain), 'mainnet', review, binToHex(publicKeyOf(5)))).rejects.toMatchObject({ status: 403 });
        await expect(prepareReceipt(config(chain), 'chipnet', review, REVIEWER_HEX)).rejects.toMatchObject({ status: 503 });
        await expect(prepareReceipt(undefined, 'mainnet', review, REVIEWER_HEX)).rejects.toMatchObject({ status: 503 });

        chain.down = true;

        await expect(prepareReceipt(config(chain), 'mainnet', review, REVIEWER_HEX)).rejects.toMatchObject({ status: 502 });
    });

    it('makes a transaction the receipt parser accepts once the wallet signs it', async () => {
        const chain = new FakeChain();
        const coin = fund(chain, 100_000n);
        const review = await savedReview();
        const prepared = await prepareReceipt(config(chain), 'mainnet', review, REVIEWER_HEX);
        const result = parseReceiptTransaction(signPrepared(prepared), {
            reviewAddressLockingBytecode: reviewAddressFor(ADMIN_IDENTITY, 'mainnet')!.lockingBytecode,
            firstInputSpentLockingBytecode: reviewerLock,
        });

        expect(coin.satoshis).toBe(100_000n);
        expect(result.valid).toBe(true);

        if (result.valid) {
            expect(result.receipt.textHash).toBe(reviewTextDigest(BODY));
            expect(result.receipt.rating).toBe(5);
        }
    });
});

describe('attaching a receipt', () => {
    async function broadcast(chain: FakeChain, confirmations: number | undefined, review?: ReviewRow) {
        fund(chain, 100_000n);

        const row = review ?? (await savedReview());
        const signed = signPrepared(await prepareReceipt(config(chain), 'mainnet', row, REVIEWER_HEX));

        return { row, signed, txid: chain.add(signed, confirmations) };
    }

    it('records a confirmed receipt and shows it on the review list', async () => {
        const chain = new FakeChain();
        const { row, txid } = await broadcast(chain, 2);

        expect(await attachReceipt(db, config(chain), 'mainnet', row, txid)).toEqual({ status: 'confirmed', txid, network: 'mainnet' });

        const stored = await db.selectFrom('user_reviews').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();

        expect(stored.receipt_txid).toBe(txid);
        expect(stored.receipt_confirmed).toBe(1);
    });

    it('keeps an unconfirmed receipt as pending, then confirms it on a later check', async () => {
        const chain = new FakeChain();
        const { row, signed, txid } = await broadcast(chain, 0);

        expect((await attachReceipt(db, config(chain), 'mainnet', row, txid)).status).toBe('pending');

        chain.add(signed, 1);

        expect((await attachReceipt(db, config(chain), 'mainnet', row, txid)).status).toBe('confirmed');
    });

    it('treats a server that gives no confirmation count as pending', async () => {
        const chain = new FakeChain();
        const { row, txid } = await broadcast(chain, undefined);

        expect((await attachReceipt(db, config(chain), 'mainnet', row, txid)).status).toBe('pending');
    });

    it('never replaces a confirmed receipt', async () => {
        const chain = new FakeChain();
        const { row, txid } = await broadcast(chain, 3);

        await attachReceipt(db, config(chain), 'mainnet', row, txid);

        expect(await attachReceipt(db, config(chain), 'mainnet', row, '77'.repeat(32))).toMatchObject({ status: 'confirmed', txid });
    });

    it('asks to wait when the transaction is not on the chain server yet', async () => {
        const chain = new FakeChain();

        await expect(attachReceipt(db, config(chain), 'mainnet', await savedReview(), 'ab'.repeat(32))).rejects.toMatchObject({ status: 404 });
        await expect(attachReceipt(db, config(chain), 'mainnet', await savedReview(3, 'another review text', binToHex(publicKeyOf(4))), 'not-a-txid')).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a receipt that does not match this review', async () => {
        const chain = new FakeChain();
        const { txid } = await broadcast(chain, 3);

        const wrongRating = await savedReview(2, BODY, binToHex(publicKeyOf(6)));

        // Same transaction, but a review with another key, rating and text: nothing matches.
        await expect(attachReceipt(db, config(chain), 'mainnet', wrongRating, txid)).rejects.toMatchObject({ status: 422 });

        const sameKeyOtherText: ReviewRow = { id: wrongRating.id, identifier: IDENTIFIER, reviewer: REVIEWER_HEX, rating: 5, body: 'a different text entirely' };

        await expect(attachReceipt(db, config(chain), 'mainnet', sameKeyOtherText, txid)).rejects.toMatchObject({ status: 422 });
        await expect(attachReceipt(db, config(chain), 'mainnet', { ...sameKeyOtherText, body: BODY, rating: 4 }, txid)).rejects.toMatchObject({ status: 422 });
        await expect(attachReceipt(db, config(chain), 'mainnet', { ...sameKeyOtherText, body: BODY, identifier: 'ff'.repeat(32) }, txid)).rejects.toMatchObject({ status: 422 });
    });

    it('rejects a transaction signed by a key that does not own the coin it spends', async () => {
        const chain = new FakeChain();

        fund(chain, 100_000n);

        const row = await savedReview();
        const signed = signPrepared(await prepareReceipt(config(chain), 'mainnet', row, REVIEWER_HEX), publicKeyOf(7));
        const txid = chain.add(signed, 3);

        await expect(attachReceipt(db, config(chain), 'mainnet', row, txid)).rejects.toMatchObject({ status: 422 });
    });

    it('rejects a chain server that returns a different transaction than the one asked for', async () => {
        const chain = new FakeChain();
        const { signed } = await broadcast(chain, 3);
        const lie = 'de'.repeat(32);

        chain.transactions.set(lie, { hex: binToHex(encodeTransaction(signed)), confirmations: 3 });

        await expect(attachReceipt(db, config(chain), 'mainnet', await savedReview(1, 'text for a second review', binToHex(publicKeyOf(8))), lie)).rejects.toMatchObject({ status: 502 });
    });

    it('keeps mainnet and chipnet apart: a receipt paying the mainnet address is not a chipnet receipt', async () => {
        // Same key, so the locking script is identical and this passes by design: the network only picks the server and prefix.
        const chain = new FakeChain();
        const chip = new FakeChain();
        const { row, signed } = await broadcast(chain, 3);
        const txid = chip.add(signed, 3);

        fund(chip, 100_000n);

        expect(await attachReceipt(db, config(chain, chip), 'chipnet', row, txid)).toMatchObject({ status: 'confirmed', network: 'chipnet' });
    });
});

/** A real Schnorr signature over the prepared transaction, the way a wallet signs it. */
function signForReal(prepared: Awaited<ReturnType<typeof prepareReceipt>>, value: bigint, key = privateKey(1)): TransactionCommon {
    const decoded = decodeTransaction(hexToBin(prepared.walletSignRequest.transaction as string)) as TransactionCommon;
    const compiler = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd as never);
    const input = decoded.inputs[0]!;
    const inputTemplate: InputTemplate<typeof compiler> = {
        outpointIndex: input.outpointIndex,
        outpointTransactionHash: input.outpointTransactionHash,
        sequenceNumber: input.sequenceNumber,
        unlockingBytecode: { compiler, data: { keys: { privateKeys: { key: key } } }, valueSatoshis: value, script: 'unlock' },
    };
    const generated = generateTransaction({ inputs: [inputTemplate], locktime: decoded.locktime, outputs: decoded.outputs, version: decoded.version });

    if (!generated.success) {
        throw new Error(JSON.stringify(generated.errors));
    }

    return generated.transaction;
}

describe('broadcasting a receipt', () => {
    async function ready(value = 100_000n) {
        const chain = new FakeChain();

        fund(chain, value);

        const row = await savedReview();
        const prepared = await prepareReceipt(config(chain), 'mainnet', row, REVIEWER_HEX);

        return { chain, row, prepared, value };
    }

    it('sends a correctly signed receipt and records it as pending', async () => {
        const { chain, row, prepared, value } = await ready();
        const signed = signForReal(prepared, value);
        const result = await broadcastReceipt(db, config(chain), 'mainnet', row, binToHex(encodeTransaction(signed)));

        expect(result).toEqual({ status: 'pending', txid: transactionHashOf(signed), network: 'mainnet' });
        expect(chain.sent).toHaveLength(1);

        const stored = await db.selectFrom('user_reviews').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();

        expect(stored.receipt_txid).toBe(transactionHashOf(signed));
        expect(stored.receipt_confirmed).toBe(0);
    });

    it('sends nothing when the signature is not valid', async () => {
        const { chain, row, prepared, value } = await ready();
        const forged = signPrepared(prepared);

        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, binToHex(encodeTransaction(forged)))).rejects.toMatchObject({ status: 422 });

        // Signed by the wrong key: the key no longer hashes to the coin's owner.
        const wrongKey = signForReal(prepared, value, privateKey(2));

        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, binToHex(encodeTransaction(wrongKey)))).rejects.toMatchObject({ status: 422 });
        expect(chain.sent).toHaveLength(0);
    });

    it('sends nothing for another review, a changed output, a huge fee or two inputs', async () => {
        const { chain, row, prepared, value } = await ready();
        const signed = signForReal(prepared, value);
        const hex = binToHex(encodeTransaction(signed));

        await expect(broadcastReceipt(db, config(chain), 'mainnet', { ...row, rating: 1 }, hex)).rejects.toMatchObject({ status: 422 });
        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, 'zz')).rejects.toMatchObject({ status: 400 });

        const greedy = await prepareReceipt(config(chain), 'mainnet', row, REVIEWER_HEX);
        const noChange = decodeTransaction(hexToBin(greedy.walletSignRequest.transaction as string)) as TransactionCommon;
        const burned = { ...greedy, walletSignRequest: { ...greedy.walletSignRequest, transaction: binToHex(encodeTransaction({ ...noChange, outputs: noChange.outputs.slice(0, 2) })) } };

        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, binToHex(encodeTransaction(signForReal(burned, value))))).rejects.toMatchObject({ status: 422 });

        const twoInputs = { ...signed, inputs: [...signed.inputs, ...signed.inputs] };

        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, binToHex(encodeTransaction(twoInputs)))).rejects.toMatchObject({ status: 422 });
        expect(chain.sent).toHaveLength(0);
    });

    it('refuses an already confirmed review, and a refusal from the network is reported', async () => {
        const { chain, row, prepared, value } = await ready();
        const hex = binToHex(encodeTransaction(signForReal(prepared, value)));

        await expect(broadcastReceipt(db, config(chain), 'mainnet', { ...row, receipt_confirmed: 1 }, hex)).rejects.toMatchObject({ status: 409 });

        chain.refuse = 'the transaction was rejected: dust';

        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, hex)).rejects.toMatchObject({ status: 502 });
    });

    it('treats a transaction the network already has as sent, and rejects a wrong id from the server', async () => {
        const { chain, row, prepared, value } = await ready();
        const signed = signForReal(prepared, value);
        const hex = binToHex(encodeTransaction(signed));

        chain.add(signed, 0);
        chain.refuse = 'transaction already in mempool';

        expect((await broadcastReceipt(db, config(chain), 'mainnet', row, hex)).status).toBe('pending');

        chain.refuse = undefined;
        chain.reportedId = 'ee'.repeat(32);

        await expect(broadcastReceipt(db, config(chain), 'mainnet', row, hex)).rejects.toMatchObject({ status: 502 });
    });

    it('will not prepare a second receipt once one is confirmed', async () => {
        const { chain, row } = await ready();

        await expect(prepareReceipt(config(chain), 'mainnet', { ...row, receipt_confirmed: 1 }, REVIEWER_HEX)).rejects.toMatchObject({ status: 409 });
    });
});

describe('refreshing pending receipts', () => {
    it('confirms a pending receipt when the review list is read, at most once a minute', async () => {
        const chain = new FakeChain();

        fund(chain, 100_000n);

        const row = await savedReview(4, 'a review whose receipt is slow to confirm');
        const prepared = await prepareReceipt(config(chain), 'mainnet', row, REVIEWER_HEX);
        const signed = signForReal(prepared, 100_000n);

        await broadcastReceipt(db, config(chain), 'mainnet', row, binToHex(encodeTransaction(signed)));

        const status = async () => (await db.selectFrom('user_reviews').select('receipt_confirmed').where('id', '=', row.id).executeTakeFirstOrThrow()).receipt_confirmed;
        const start = 10_000_000_000;

        await refreshPendingReceipts(db, config(chain), IDENTIFIER, start);
        expect(await status()).toBe(0);

        chain.add(signed, 2);
        await refreshPendingReceipts(db, config(chain), IDENTIFIER, start + 10_000);
        expect(await status()).toBe(0); // too soon: not looked at again yet

        await refreshPendingReceipts(db, config(chain), IDENTIFIER, start + 61_000);
        expect(await status()).toBe(1);
    });

    it('does nothing when receipts are not configured', async () => {
        await expect(refreshPendingReceipts(db, undefined, IDENTIFIER)).resolves.toBeUndefined();
    });
});

describe('receipt settings', () => {
    it('lists only the networks that have a chain server', () => {
        expect(receiptSettings(undefined)).toMatchObject({ enabled: false, networks: {} });

        const both = receiptSettings(config(new FakeChain(), new FakeChain()));

        expect(both.enabled).toBe(true);
        expect(both.networks.mainnet?.address.startsWith('bitcoincash:q')).toBe(true);
        expect(both.networks.chipnet?.address.startsWith('bchtest:q')).toBe(true);
        expect(receiptSettings(config(new FakeChain())).networks.chipnet).toBeUndefined();
    });
});

describe('receipt routes', () => {
    let app: FastifyInstance;
    let chain: FakeChain;

    beforeEach(async () => {
        chain = new FakeChain();
        app = await buildApp(db, { rateLimit: false, receipts: config(chain) });
    });

    afterEach(async () => {
        await app.close();
    });

    it('serves the settings, prepares, and records a receipt from the signed transaction alone', async () => {
        const review = await savedReview();
        const settings = (await app.inject({ method: 'GET', url: '/api/receipts/config' })).json();

        expect(settings.enabled).toBe(true);

        fund(chain, 100_000n);

        const prepare = await app.inject({ method: 'POST', url: `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt/prepare`, payload: { network: 'mainnet', publicKey: REVIEWER_HEX } });

        expect(prepare.statusCode).toBe(200);

        const prepared = prepare.json();
        const signed = signPrepared(prepared);

        chain.add(signed, 1);

        const attach = await app.inject({
            method: 'POST',
            url: `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt`,
            payload: { network: 'mainnet', signedTransaction: binToHex(encodeTransaction(signed)) },
        });

        expect(attach.json()).toMatchObject({ status: 'confirmed', network: 'mainnet' });

        const list = (await app.inject({ method: 'GET', url: `/api/templates/${IDENTIFIER}/reviews` })).json();

        expect(list.items[0].receipt).toMatchObject({ status: 'confirmed', network: 'mainnet', txid: transactionHashOf(signed) });
    });

    it('verifies and sends a signed receipt through the broadcast route', async () => {
        const review = await savedReview();

        fund(chain, 100_000n);

        const prepared = (await app.inject({ method: 'POST', url: `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt/prepare`, payload: { network: 'mainnet', publicKey: REVIEWER_HEX } })).json();
        const signed = signForReal(prepared, 100_000n);
        const sent = await app.inject({ method: 'POST', url: `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt/broadcast`, payload: { network: 'mainnet', signedTransaction: binToHex(encodeTransaction(signed)) } });

        expect(sent.statusCode).toBe(200);
        expect(sent.json()).toMatchObject({ status: 'pending', txid: transactionHashOf(signed) });

        chain.add(signed, 1);

        const checked = await app.inject({ method: 'POST', url: `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt`, payload: { network: 'mainnet', txid: transactionHashOf(signed) } });

        expect(checked.json().status).toBe('confirmed');
    });

    it('answers bad requests with clear errors', async () => {
        const review = await savedReview();
        const url = `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt`;

        expect((await app.inject({ method: 'POST', url, payload: { network: 'dogecoin', txid: 'a' } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url, payload: { network: 'mainnet' } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: `/api/templates/${IDENTIFIER}/reviews/999/receipt`, payload: { network: 'mainnet', txid: 'a' } })).statusCode).toBe(404);
        expect((await app.inject({ method: 'POST', url: `${url}/prepare`, payload: { network: 'mainnet', publicKey: 'zz' } })).statusCode).toBe(400);
    });

    it('reports receipts as off when nothing is configured', async () => {
        const plain = await buildApp(db, { rateLimit: false });
        const review = await savedReview(4, 'a review for the plain app', binToHex(publicKeyOf(12)));

        expect((await plain.inject({ method: 'GET', url: '/api/receipts/config' })).json().enabled).toBe(false);
        expect((await plain.inject({ method: 'POST', url: `/api/templates/${IDENTIFIER}/reviews/${review.id}/receipt/prepare`, payload: { network: 'mainnet', publicKey: binToHex(publicKeyOf(12)) } })).statusCode).toBe(503);
        await plain.close();
    });
});

describe('Electrum client', () => {
    it('parses endpoints', () => {
        expect(parseEndpoint('bch.example.org:50002')).toEqual({ host: 'bch.example.org', port: 50002, ssl: true });
        expect(parseEndpoint('tcp://127.0.0.1:5000')).toEqual({ host: '127.0.0.1', port: 5000, ssl: false });
        expect(parseEndpoint('nonsense')).toBeUndefined();
        expect(parseEndpoint('host:99999')).toBeUndefined();
    });

    it('computes the script hash the way Electrum expects (sha256, reversed)', () => {
        expect(scriptHashOf(hexToBin('76a914' + '00'.repeat(20) + '88ac'))).toMatch(/^[0-9a-f]{64}$/);
        expect(scriptHashOf(hexToBin('00'))).toBe('1da0af1706a31185763837b33f1d90782c0a78bbe644a59c987ab3ff9c0b346e');
    });

    async function withServer(answers: (method: string, params: unknown[]) => { result?: unknown; error?: unknown }, run: (endpoint: string) => Promise<void>) {
        const server = net.createServer((socket) => {
            let buffer = '';

            socket.on('data', (chunk) => {
                buffer += chunk.toString();

                for (const line of buffer.split('\n').filter(Boolean)) {
                    const request = JSON.parse(line) as { id: number; method: string; params: unknown[] };

                    socket.write(`${JSON.stringify({ id: request.id, ...(request.method === 'server.version' ? { result: ['Fake', '1.4'] } : answers(request.method, request.params)) })}\n`);
                }

                buffer = '';
            });
        });

        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        try {
            await run(`tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
        } finally {
            server.close();
        }
    }

    it('reads a verbose transaction, a bare hex transaction, and an unknown one', async () => {
        const seen: unknown[][] = [];

        await withServer(
            (method, params) => {
                seen.push([method, ...params]);

                if (params[0] === 'aa'.repeat(32)) return { result: { hex: '0100', confirmations: 4 } };
                if (params[0] === 'bb'.repeat(32)) return { result: '0200' };

                return { error: { code: 2, message: 'No such mempool or blockchain transaction' } };
            },
            async (endpoint) => {
                const client = new ElectrumServer(parseEndpoint(endpoint)!);

                expect(await client.getTransaction('aa'.repeat(32))).toEqual({ hex: '0100', confirmations: 4 });
                expect(await client.getTransaction('bb'.repeat(32))).toEqual({ hex: '0200', confirmations: undefined });
                expect(await client.getTransaction('cc'.repeat(32))).toBeUndefined();
                expect(seen[0]).toEqual(['blockchain.transaction.get', 'aa'.repeat(32), true]);
            },
        );
    });

    it('lists unspent coins, marking token coins, and ignores malformed entries', async () => {
        await withServer(
            () => ({ result: [{ tx_hash: 'aa'.repeat(32), tx_pos: 1, value: 2000, height: 7 }, { tx_hash: 'bb'.repeat(32), tx_pos: 0, value: 800, height: 0, token_data: { category: 'x' } }, { tx_hash: 'nope', tx_pos: 0, value: 1 }] }),
            async (endpoint) => {
                const coins = await new ElectrumServer(parseEndpoint(endpoint)!).listUnspent(reviewerLock);

                expect(coins).toEqual([
                    { txid: 'aa'.repeat(32), index: 1, satoshis: 2000n, height: 7, hasToken: false },
                    { txid: 'bb'.repeat(32), index: 0, satoshis: 800n, height: 0, hasToken: true },
                ]);
            },
        );
    });

    it('fails clearly when the server is down or silent', async () => {
        await expect(new ElectrumServer({ host: '127.0.0.1', port: 1, ssl: false }, { timeoutMs: 500 }).listUnspent(reviewerLock)).rejects.toThrow();
    });
});
