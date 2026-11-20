import { createHash } from 'node:crypto';
import {
    binToHex,
    cashAddressToLockingBytecode,
    decodeAuthenticationInstructions,
    decodeTransaction,
    encodeLockingBytecodeP2pkh,
    encodeTransaction,
    hash160,
    hash256,
    hexToBin,
    type Output,
    type TransactionCommon,
} from '@bitauth/libauth';

/**
 * On-chain review receipts. See docs/REVIEW_TRACKING.md for the decision and the reasons.
 *
 * A receipt is a transaction that
 *   - pays at least REVIEW_PAYMENT_SATOSHIS to the XOGrid review address (this is how receipts are FOUND), and
 *   - has exactly one OP_RETURN of the layout below (this is how a payment is RECOGNISED as a review).
 * The reviewer is the key that signs input 0. Only the text's hash goes on chain; the text stays on the server.
 *
 * OP_RETURN data, 70 bytes (the standard limit is 223 bytes per transaction):
 *   "XGRD" (4) | version (1) | template identifier (32) | rating (1) | SHA-256 of the review text (32)
 */

export const RECEIPT_PREFIX = Uint8Array.of(0x58, 0x47, 0x52, 0x44); // "XGRD"
export const RECEIPT_VERSION = 1;
export const RECEIPT_DATA_LENGTH = 70;
/** OP_RETURN, a direct push of 70 bytes, then the data. Anything else (PUSHDATA1, extra pushes) is not a receipt. */
export const RECEIPT_SCRIPT_LENGTH = 2 + RECEIPT_DATA_LENGTH;
/** The BCH dust limit for a P2PKH output. A receipt must pay at least this to the review address. */
export const REVIEW_PAYMENT_SATOSHIS = 546n;

const MAX_TRANSACTION_BYTES = 100_000;
const OP_RETURN = 0x6a;
const DIRECT_PUSH_70 = 0x46;

export interface ReviewReceipt {
    /** Compressed public key (hex) that signed input 0. */
    reviewerPublicKey: string;
    /** The reviewed template's identifier (64 hex characters). */
    identifier: string;
    rating: number;
    /** SHA-256 (hex) of the review text. The same digest the signed review message contains. */
    textHash: string;
    transactionHash: string;
}

export type ReceiptResult = { valid: true; receipt: ReviewReceipt } | { valid: false; reason: string };

/** SHA-256 of the review text exactly as the server stores it. Matches the digest in the signed review message. */
export function reviewTextDigest(body: string): string {
    return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Locking bytecode of a cash address, for the review address setting. Throws on anything unusable. */
export function lockingBytecodeOfAddress(address: string): Uint8Array {
    const result = cashAddressToLockingBytecode(address);

    if (typeof result === 'string') {
        throw new Error(`Not a usable cash address: ${result}`);
    }

    return result.bytecode;
}

function checkFields(identifier: string, rating: number, textHash: string): void {
    if (!/^[0-9a-f]{64}$/.test(identifier)) {
        throw new Error('The template identifier must be 64 lowercase hex characters.');
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error('The rating must be a whole number from 1 to 5.');
    }

    if (!/^[0-9a-f]{64}$/.test(textHash)) {
        throw new Error('The text hash must be 64 lowercase hex characters.');
    }
}

/** The OP_RETURN locking bytecode for a review: OP_RETURN <70 bytes>. */
export function buildReceiptScript(identifier: string, rating: number, textHash: string): Uint8Array {
    checkFields(identifier, rating, textHash);

    const script = new Uint8Array(RECEIPT_SCRIPT_LENGTH);

    script[0] = OP_RETURN;
    script[1] = DIRECT_PUSH_70;
    script.set(RECEIPT_PREFIX, 2);
    script[6] = RECEIPT_VERSION;
    script.set(hexToBin(identifier), 7);
    script[39] = rating;
    script.set(hexToBin(textHash), 40);

    return script;
}

/**
 * The two outputs a review transaction must contain. A wallet adds the reviewer's own input, signs, and adds change.
 * Order is fixed (payment first) so a wallet shows the payment before the data.
 */
export function buildReceiptOutputs(identifier: string, rating: number, textHash: string, reviewAddressLockingBytecode: Uint8Array): Output[] {
    return [
        { lockingBytecode: reviewAddressLockingBytecode, valueSatoshis: REVIEW_PAYMENT_SATOSHIS },
        { lockingBytecode: buildReceiptScript(identifier, rating, textHash), valueSatoshis: 0n },
    ];
}

/** The transaction id as explorers show it: the double SHA-256 of the transaction, bytes reversed. */
export function transactionHashOf(transaction: TransactionCommon): string {
    return binToHex(hash256(encodeTransaction(transaction)).reverse());
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

/** Reads <signature> <compressed public key> from a standard P2PKH unlocking script, or returns undefined. */
function publicKeyOfUnlockingScript(unlockingBytecode: Uint8Array): Uint8Array | undefined {
    const instructions = decodeAuthenticationInstructions(unlockingBytecode) as unknown as { data?: Uint8Array; malformed?: boolean }[];

    if (instructions.length !== 2 || instructions.some((instruction) => instruction.malformed || !instruction.data)) {
        return undefined;
    }

    const publicKey = instructions[1]!.data!;

    return publicKey.length === 33 && (publicKey[0] === 2 || publicKey[0] === 3) ? publicKey : undefined;
}

export interface ReceiptContext {
    /** Locking bytecode of the XOGrid review address. */
    reviewAddressLockingBytecode: Uint8Array;
    /** Locking bytecode of the output that input 0 spends (from the transaction it came from). */
    firstInputSpentLockingBytecode: Uint8Array;
}

/**
 * Reads a transaction as a review receipt, or says why it is not one. It checks structure and the signer's key, not
 * the signature itself: call it only for transactions the chain has CONFIRMED, where consensus has already checked
 * every signature. The signer's key is accepted only when it hashes to the P2PKH output that input 0 spends, so a
 * script that merely looks like <signature> <key> cannot name someone else as the reviewer.
 */
export function parseReceiptTransaction(transaction: string | Uint8Array | TransactionCommon, context: ReceiptContext): ReceiptResult {
    let decoded: TransactionCommon;

    if (typeof transaction === 'string' || transaction instanceof Uint8Array) {
        const raw = typeof transaction === 'string' ? (/^([0-9a-fA-F]{2})+$/.test(transaction) ? hexToBin(transaction) : undefined) : transaction;

        if (!raw || raw.length > MAX_TRANSACTION_BYTES) {
            return { valid: false, reason: 'not a transaction of a reasonable size' };
        }

        const result = decodeTransaction(raw);

        if (typeof result === 'string') {
            return { valid: false, reason: `transaction could not be decoded: ${result}` };
        }

        decoded = result;
    } else {
        decoded = transaction;
    }

    const dataOutputs = decoded.outputs.filter((output) => output.lockingBytecode[0] === OP_RETURN);

    if (dataOutputs.length !== 1) {
        return { valid: false, reason: `needs exactly one OP_RETURN output, found ${dataOutputs.length}` };
    }

    const script = dataOutputs[0]!.lockingBytecode;

    if (script.length !== RECEIPT_SCRIPT_LENGTH || script[1] !== DIRECT_PUSH_70) {
        return { valid: false, reason: 'OP_RETURN is not a single 70-byte push' };
    }

    if (!bytesEqual(script.subarray(2, 6), RECEIPT_PREFIX)) {
        return { valid: false, reason: 'OP_RETURN does not start with XGRD' };
    }

    if (script[6] !== RECEIPT_VERSION) {
        return { valid: false, reason: `unknown receipt version ${script[6]}` };
    }

    const rating = script[39]!;

    if (rating < 1 || rating > 5) {
        return { valid: false, reason: `rating ${rating} is out of range` };
    }

    if (dataOutputs[0]!.valueSatoshis !== 0n || dataOutputs[0]!.token) {
        return { valid: false, reason: 'the OP_RETURN output must carry no value and no token' };
    }

    // Count only plain payments: a token-carrying output at the address does not count as the review payment.
    const paid = decoded.outputs
        .filter((output) => !output.token && bytesEqual(output.lockingBytecode, context.reviewAddressLockingBytecode))
        .reduce((sum, output) => sum + output.valueSatoshis, 0n);

    if (paid < REVIEW_PAYMENT_SATOSHIS) {
        return { valid: false, reason: `does not pay at least ${REVIEW_PAYMENT_SATOSHIS} satoshis to the review address` };
    }

    const input = decoded.inputs[0];

    if (!input) {
        return { valid: false, reason: 'transaction has no inputs' };
    }

    const publicKey = publicKeyOfUnlockingScript(input.unlockingBytecode);

    if (!publicKey) {
        return { valid: false, reason: 'input 0 is not a P2PKH signature and compressed public key' };
    }

    if (!bytesEqual(encodeLockingBytecodeP2pkh(hash160(publicKey)), context.firstInputSpentLockingBytecode)) {
        return { valid: false, reason: 'the key in input 0 does not match the P2PKH output it spends' };
    }

    return {
        valid: true,
        receipt: {
            reviewerPublicKey: binToHex(publicKey),
            identifier: binToHex(script.subarray(7, 39)),
            rating,
            textHash: binToHex(script.subarray(40, 72)),
            transactionHash: transactionHashOf(decoded),
        },
    };
}

export interface PlacedReceipt extends ReviewReceipt {
    /** Block height of the confirmation. Receipts that are not confirmed must not be passed in. */
    height: number;
    /** Position of the transaction in its block. */
    position: number;
}

/**
 * One receipt per reviewer key and template: the EARLIEST confirmed one counts, the same rule the database already
 * uses ("This wallet has already reviewed this template"). Order is by height, then position in the block.
 */
export function firstReceiptPerReviewer(receipts: PlacedReceipt[]): PlacedReceipt[] {
    const ordered = [...receipts].sort((a, b) => a.height - b.height || a.position - b.position);
    const seen = new Set<string>();
    const kept: PlacedReceipt[] = [];

    for (const receipt of ordered) {
        const key = `${receipt.reviewerPublicKey}:${receipt.identifier}`;

        if (!seen.has(key)) {
            seen.add(key);
            kept.push(receipt);
        }
    }

    return kept;
}
