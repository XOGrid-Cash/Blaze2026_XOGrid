import { binToHex, decodeTransaction, encodeDataPush, encodeLockingBytecodeP2pkh, encodeTransaction, hash160, hexToBin, secp256k1, type Output, type TransactionCommon } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import {
    RECEIPT_DATA_LENGTH,
    RECEIPT_SCRIPT_LENGTH,
    REVIEW_PAYMENT_SATOSHIS,
    buildReceiptOutputs,
    buildReceiptScript,
    firstReceiptPerReviewer,
    lockingBytecodeOfAddress,
    parseReceiptTransaction,
    reviewTextDigest,
    transactionHashOf,
    type PlacedReceipt,
    type ReceiptContext,
} from '../src/review-receipt.js';
import { reviewMessage } from '../src/user-reviews.js';

const IDENTIFIER = '346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185';
const OTHER_IDENTIFIER = 'b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e';
const BODY = 'Clear scripts, and the sources are credited.';
const TEXT_HASH = reviewTextDigest(BODY);

const privateKey = (seed: number): Uint8Array => Uint8Array.from({ length: 32 }, (_, index) => ((seed + index) % 250) + 1);
const publicKeyOf = (seed: number): Uint8Array => {
    const key = secp256k1.derivePublicKeyCompressed(privateKey(seed));

    if (typeof key === 'string') {
        throw new Error(key);
    }

    return key;
};

const REVIEWER = publicKeyOf(1);
const OTHER_REVIEWER = publicKeyOf(2);
const reviewerLock = encodeLockingBytecodeP2pkh(hash160(REVIEWER));
const REVIEW_ADDRESS = lockingBytecodeOfAddress('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a');
const TOKEN_CATEGORY = hexToBin('11'.repeat(32));

/** <65-byte stand-in signature> <compressed key>: the parser reads structure and key, the chain checks signatures. */
const unlockingFor = (publicKey: Uint8Array): Uint8Array => Uint8Array.from([...encodeDataPush(new Uint8Array(65).fill(7)), ...encodeDataPush(publicKey)]);

function transactionWith(overrides: { outputs?: Output[]; unlocking?: Uint8Array } = {}): TransactionCommon {
    return {
        version: 2,
        locktime: 0,
        inputs: [{ outpointTransactionHash: hexToBin('ab'.repeat(32)), outpointIndex: 0, sequenceNumber: 0xfffffffe, unlockingBytecode: overrides.unlocking ?? unlockingFor(REVIEWER) }],
        outputs: overrides.outputs ?? [...buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS), { lockingBytecode: reviewerLock, valueSatoshis: 90_000n }],
    };
}

const context: ReceiptContext = { reviewAddressLockingBytecode: REVIEW_ADDRESS, firstInputSpentLockingBytecode: reviewerLock };
const parse = (transaction: TransactionCommon, overrides: Partial<ReceiptContext> = {}) => parseReceiptTransaction(transaction, { ...context, ...overrides });
const rejected = (result: ReturnType<typeof parse>): string => (result.valid ? 'VALID' : result.reason);

describe('review receipts', () => {
    describe('building', () => {
        it('makes a 72-byte OP_RETURN: prefix, version, identifier, rating, text hash', () => {
            const script = buildReceiptScript(IDENTIFIER, 4, TEXT_HASH);

            expect(script.length).toBe(RECEIPT_SCRIPT_LENGTH);
            expect(RECEIPT_DATA_LENGTH).toBe(70);
            expect(RECEIPT_SCRIPT_LENGTH).toBeLessThan(223);
            expect(binToHex(script.subarray(0, 7))).toBe('6a465847524401'); // OP_RETURN, push 70, "XGRD", version 1
            expect(binToHex(script.subarray(7, 39))).toBe(IDENTIFIER);
            expect(script[39]).toBe(4);
            expect(binToHex(script.subarray(40))).toBe(TEXT_HASH);
        });

        it('puts the payment first and the data second, with no value on the data', () => {
            const outputs = buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS);

            expect(outputs).toHaveLength(2);
            expect(outputs[0]!.valueSatoshis).toBe(REVIEW_PAYMENT_SATOSHIS);
            expect(binToHex(outputs[0]!.lockingBytecode)).toBe(binToHex(REVIEW_ADDRESS));
            expect(outputs[1]!.valueSatoshis).toBe(0n);
        });

        it('refuses bad fields instead of building something the reader would ignore', () => {
            expect(() => buildReceiptScript('abc', 5, TEXT_HASH)).toThrow(/identifier/);
            expect(() => buildReceiptScript(IDENTIFIER.toUpperCase(), 5, TEXT_HASH)).toThrow(/identifier/);
            expect(() => buildReceiptScript(IDENTIFIER, 0, TEXT_HASH)).toThrow(/rating/);
            expect(() => buildReceiptScript(IDENTIFIER, 6, TEXT_HASH)).toThrow(/rating/);
            expect(() => buildReceiptScript(IDENTIFIER, 2.5, TEXT_HASH)).toThrow(/rating/);
            expect(() => buildReceiptScript(IDENTIFIER, 5, 'zz')).toThrow(/text hash/);
        });

        it('uses the same text digest as the signed review message', () => {
            const draft = { rating: 5, body: BODY };
            const message = reviewMessage(IDENTIFIER, draft, 'nonce', new Date(0));

            expect(message).toContain(`text sha256: ${reviewTextDigest(BODY)}`);
        });

        it('rejects an address that is not a cash address', () => {
            expect(() => lockingBytecodeOfAddress('not an address')).toThrow(/cash address/);
        });
    });

    describe('reading', () => {
        it('reads a valid receipt: reviewer key, template, rating, text hash and transaction hash', () => {
            const transaction = transactionWith();
            const result = parse(transaction);

            expect(result.valid).toBe(true);

            if (!result.valid) {
                return;
            }

            expect(result.receipt.reviewerPublicKey).toBe(binToHex(REVIEWER));
            expect(result.receipt.identifier).toBe(IDENTIFIER);
            expect(result.receipt.rating).toBe(5);
            expect(result.receipt.textHash).toBe(TEXT_HASH);
            expect(result.receipt.transactionHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('computes the transaction id the way explorers show it (Bitcoin genesis coinbase as the known vector)', () => {
            const genesis =
                '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
            const decoded = decodeTransaction(hexToBin(genesis));

            expect(typeof decoded).not.toBe('string');
            expect(transactionHashOf(decoded as TransactionCommon)).toBe('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
        });

        it('reads the same receipt from hex and from bytes', () => {
            const transaction = transactionWith();
            const bytes = encodeTransaction(transaction);
            const fromObject = parse(transaction);
            const fromHex = parseReceiptTransaction(binToHex(bytes), context);
            const fromBytes = parseReceiptTransaction(bytes, context);

            expect(fromHex).toEqual(fromObject);
            expect(fromBytes).toEqual(fromObject);
        });

        it('accepts a payment above the minimum, and a payment split over two outputs', () => {
            const data = buildReceiptOutputs(IDENTIFIER, 3, TEXT_HASH, REVIEW_ADDRESS)[1]!;

            expect(parse(transactionWith({ outputs: [{ lockingBytecode: REVIEW_ADDRESS, valueSatoshis: 5000n }, data] })).valid).toBe(true);
            expect(
                parse(transactionWith({ outputs: [{ lockingBytecode: REVIEW_ADDRESS, valueSatoshis: 300n }, { lockingBytecode: REVIEW_ADDRESS, valueSatoshis: 300n }, data] })).valid,
            ).toBe(true);
        });

        it('ignores a transaction that is not a receipt', () => {
            expect(rejected(parseReceiptTransaction('zz', context))).toMatch(/reasonable size/);
            expect(rejected(parseReceiptTransaction('00', context))).toMatch(/decoded/);
            expect(rejected(parse(transactionWith({ outputs: [{ lockingBytecode: REVIEW_ADDRESS, valueSatoshis: 1000n }] })))).toMatch(/exactly one OP_RETURN output, found 0/);
        });

        it('rejects two OP_RETURN outputs, even if one is a valid receipt', () => {
            const [payment, data] = buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS);
            const extra: Output = { lockingBytecode: Uint8Array.from([0x6a, ...encodeDataPush(new Uint8Array([1, 2, 3]))]), valueSatoshis: 0n };

            expect(rejected(parse(transactionWith({ outputs: [payment!, data!, extra] })))).toMatch(/found 2/);
        });

        it('rejects a wrong prefix, an unknown version, and data of the wrong shape', () => {
            const good = buildReceiptScript(IDENTIFIER, 5, TEXT_HASH);
            const payment = buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS)[0]!;
            const withScript = (script: Uint8Array) => parse(transactionWith({ outputs: [payment, { lockingBytecode: script, valueSatoshis: 0n }] }));
            const changed = (index: number, value: number): Uint8Array => {
                const copy = Uint8Array.from(good);

                copy[index] = value;

                return copy;
            };

            expect(rejected(withScript(changed(2, 0x59)))).toMatch(/XGRD/);
            expect(rejected(withScript(changed(6, 2)))).toMatch(/version 2/);
            expect(rejected(withScript(good.subarray(0, 71)))).toMatch(/70-byte push/);
            expect(rejected(withScript(Uint8Array.from([...good, 0])))).toMatch(/70-byte push/);
            // The same 70 bytes behind PUSHDATA1 is a different script and is not accepted.
            expect(rejected(withScript(Uint8Array.from([0x6a, 0x4c, 70, ...good.subarray(2)])))).toMatch(/70-byte push/);
        });

        it.each([0, 6, 255])('rejects rating %i', (rating) => {
            const script = buildReceiptScript(IDENTIFIER, 5, TEXT_HASH);

            script[39] = rating;

            const payment = buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS)[0]!;

            expect(rejected(parse(transactionWith({ outputs: [payment, { lockingBytecode: script, valueSatoshis: 0n }] })))).toMatch(/out of range/);
        });

        it('rejects a data output that carries value or a token', () => {
            const [payment, data] = buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS);

            expect(rejected(parse(transactionWith({ outputs: [payment!, { ...data!, valueSatoshis: 1n }] })))).toMatch(/no value/);
            expect(rejected(parse(transactionWith({ outputs: [payment!, { ...data!, token: { category: TOKEN_CATEGORY, amount: 1n } }] })))).toMatch(/no value/);
        });

        it('rejects a receipt that does not pay the review address enough', () => {
            const data = buildReceiptOutputs(IDENTIFIER, 5, TEXT_HASH, REVIEW_ADDRESS)[1]!;

            expect(rejected(parse(transactionWith({ outputs: [{ lockingBytecode: REVIEW_ADDRESS, valueSatoshis: 545n }, data] })))).toMatch(/546/);
            expect(rejected(parse(transactionWith({ outputs: [{ lockingBytecode: reviewerLock, valueSatoshis: 5000n }, data] })))).toMatch(/review address/);
            // A token-carrying output at the address is not the review payment.
            expect(
                rejected(parse(transactionWith({ outputs: [{ lockingBytecode: REVIEW_ADDRESS, valueSatoshis: 5000n, token: { category: TOKEN_CATEGORY, amount: 1n } }, data] }))),
            ).toMatch(/review address/);
        });

        it('names the reviewer only when the key matches the output input 0 spends', () => {
            expect(rejected(parse(transactionWith(), { firstInputSpentLockingBytecode: encodeLockingBytecodeP2pkh(hash160(OTHER_REVIEWER)) }))).toMatch(/does not match/);
            // Someone else's key in the unlocking script, while spending the reviewer's output: refused.
            expect(rejected(parse(transactionWith({ unlocking: unlockingFor(OTHER_REVIEWER) })))).toMatch(/does not match/);
            // A non-P2PKH output that was spent by a script shaped like <signature> <key> cannot claim the key.
            expect(rejected(parse(transactionWith(), { firstInputSpentLockingBytecode: Uint8Array.from([0xaa, 0x20, ...new Uint8Array(32), 0x87]) }))).toMatch(/does not match/);
        });

        it('rejects an input that is not a plain P2PKH unlock', () => {
            const oneItem = encodeDataPush(new Uint8Array(65).fill(7));
            const uncompressedKey = Uint8Array.from([0x04, ...new Uint8Array(64)]);
            const threeItems = Uint8Array.from([...unlockingFor(REVIEWER), ...encodeDataPush(new Uint8Array([1]))]);

            expect(rejected(parse(transactionWith({ unlocking: oneItem })))).toMatch(/P2PKH signature/);
            expect(rejected(parse(transactionWith({ unlocking: unlockingFor(uncompressedKey) })))).toMatch(/P2PKH signature/);
            expect(rejected(parse(transactionWith({ unlocking: threeItems })))).toMatch(/P2PKH signature/);
            expect(rejected(parse(transactionWith({ unlocking: new Uint8Array(0) })))).toMatch(/P2PKH signature/);
        });
    });

    describe('choosing which receipts count', () => {
        const base = (overrides: Partial<PlacedReceipt>): PlacedReceipt => ({
            reviewerPublicKey: binToHex(REVIEWER),
            identifier: IDENTIFIER,
            rating: 5,
            textHash: TEXT_HASH,
            transactionHash: '00'.repeat(32),
            height: 100,
            position: 0,
            ...overrides,
        });

        it('keeps the earliest receipt per reviewer and template, by height then position', () => {
            const kept = firstReceiptPerReviewer([
                base({ rating: 1, height: 120, transactionHash: 'c1'.repeat(32) }),
                base({ rating: 2, height: 100, position: 7, transactionHash: 'a2'.repeat(32) }),
                base({ rating: 3, height: 100, position: 2, transactionHash: 'b3'.repeat(32) }),
            ]);

            expect(kept).toHaveLength(1);
            expect(kept[0]!.transactionHash).toBe('b3'.repeat(32));
            expect(kept[0]!.rating).toBe(3);
        });

        it('counts the same reviewer on a different template, and a different reviewer on the same one', () => {
            const kept = firstReceiptPerReviewer([
                base({}),
                base({ identifier: OTHER_IDENTIFIER, height: 101 }),
                base({ reviewerPublicKey: binToHex(OTHER_REVIEWER), height: 102 }),
                base({ height: 103 }),
            ]);

            expect(kept).toHaveLength(3);
        });

        it('does not change the list it is given', () => {
            const input = [base({ height: 5 }), base({ height: 1 })];

            firstReceiptPerReviewer(input);

            expect(input.map((receipt) => receipt.height)).toEqual([5, 1]);
        });
    });
});
