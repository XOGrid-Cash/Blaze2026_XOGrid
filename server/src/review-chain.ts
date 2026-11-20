import { binToHex, createVirtualMachineBch2026, decodeTransaction, encodeLockingBytecodeP2pkh, encodeTransaction, hash160, hexToBin, type Output, type TransactionCommon } from '@bitauth/libauth';
import type { Db } from './db.js';
import type { ChainSource, Unspent } from './electrum.js';
import { buildReceiptOutputs, parseReceiptTransaction, REVIEW_PAYMENT_SATOSHIS, reviewTextDigest, transactionHashOf } from './review-receipt.js';
import { reviewAddressFor, type ReceiptNetwork } from './review-address.js';
import { RegistryError } from './registry.js';

/** Where receipts are configured: the admin identity that owns the review address, and a chain source per network. */
export interface ReceiptConfig {
    identity: string;
    chains: Partial<Record<ReceiptNetwork, ChainSource>>;
}

/** Fee rate and size estimate for a one-input receipt: overhead 10, input 148, payment 34, data output 81, change 34. */
const FEE_RATE = 1.5;
const BASE_BYTES = 10 + 148 + 34 + 81;
const CHANGE_BYTES = 34;
const fee = (bytes: number): bigint => BigInt(Math.ceil(bytes * FEE_RATE));

export interface PreparedReceipt {
    /** The request body for the wallet's signTransaction. It is broadcast by the wallet, so it moves real coins. */
    walletSignRequest: Record<string, unknown>;
    network: ReceiptNetwork;
    reviewAddress: string;
    paymentSatoshis: string;
    feeSatoshis: string;
    totalSatoshis: string;
}

export interface ReviewRow {
    id: number;
    identifier: string;
    reviewer: string;
    rating: number;
    body: string;
    receipt_confirmed?: number | null;
}

function configuredChain(config: ReceiptConfig | undefined, network: ReceiptNetwork): { chain: ChainSource; reviewAddress: NonNullable<ReturnType<typeof reviewAddressFor>> } {
    const chain = config?.chains[network];
    const reviewAddress = config ? reviewAddressFor(config.identity, network) : undefined;

    if (!config || !chain || !reviewAddress) {
        throw new RegistryError(`On-chain receipts are not available on ${network} right now.`, 503);
    }

    return { chain, reviewAddress };
}

/** Public settings the page needs: whether receipts work, and where they are paid. */
export function receiptSettings(config: ReceiptConfig | undefined): { enabled: boolean; paymentSatoshis: string; networks: Partial<Record<ReceiptNetwork, { address: string }>> } {
    const networks: Partial<Record<ReceiptNetwork, { address: string }>> = {};

    for (const network of ['mainnet', 'chipnet'] as const) {
        const address = config?.chains[network] && config ? reviewAddressFor(config.identity, network) : undefined;

        if (address) {
            networks[network] = { address: address.address };
        }
    }

    return { enabled: Object.keys(networks).length > 0, paymentSatoshis: REVIEW_PAYMENT_SATOSHIS.toString(), networks };
}

/** A chain server that is down or slow is the server's problem to report as 502, not an internal error. */
async function reach<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        if (error instanceof RegistryError) {
            throw error;
        }

        throw new RegistryError('The chain server could not be reached. Try again in a moment.', 502);
    }
}

// libauth reverses the outpoint hash when it encodes, so it is held in the same order as the txid text.
const hashInWireOrder = (txid: string): Uint8Array => hexToBin(txid);

/**
 * Builds the unsigned receipt transaction for a stored review: pays the review address, carries the OP_RETURN, spends
 * ONE plain coin of the reviewer's key and returns the change to the same key. Only one input is used because the
 * wallet is asked to sign one path (its first receive key); the coin must be at that address.
 */
export async function prepareReceipt(config: ReceiptConfig | undefined, network: ReceiptNetwork, review: ReviewRow, publicKeyHex: string): Promise<PreparedReceipt> {
    const { chain, reviewAddress } = configuredChain(config, network);

    if (publicKeyHex !== review.reviewer) {
        throw new RegistryError('Only the wallet that wrote this review can record it on-chain.', 403);
    }

    const publicKey = hexToBin(publicKeyHex);
    const ownLock = encodeLockingBytecodeP2pkh(hash160(publicKey));
    if (review.receipt_confirmed === 1) {
        throw new RegistryError('This review is already recorded on-chain.', 409);
    }

    const coins = (await reach(() => chain.listUnspent(ownLock))).filter((coin) => !coin.hasToken);
    const payment = REVIEW_PAYMENT_SATOSHIS;
    const withChange = payment + fee(BASE_BYTES + CHANGE_BYTES);
    const noChange = payment + fee(BASE_BYTES);
    const fits = (coin: Unspent) => coin.satoshis >= noChange;
    // Smallest confirmed coin that covers it, so large coins are left alone. Unconfirmed coins are a last resort.
    const pick = (list: Unspent[]) => list.filter(fits).sort((a, b) => (a.satoshis < b.satoshis ? -1 : a.satoshis > b.satoshis ? 1 : 0))[0];
    const coin = pick(coins.filter((candidate) => candidate.height > 0)) ?? pick(coins);

    if (!coin) {
        throw new RegistryError(`No single coin of at least ${noChange} satoshis was found on this wallet's first address (${network}). Fund it and try again.`, 409);
    }

    const outputs: Output[] = buildReceiptOutputs(review.identifier, review.rating, reviewTextDigest(review.body), reviewAddress.lockingBytecode);
    const change = coin.satoshis - withChange;
    let paidFee = coin.satoshis - payment;

    if (change >= 546n) {
        outputs.push({ lockingBytecode: ownLock, valueSatoshis: change });
        paidFee = withChange - payment;
    }

    const input = { outpointTransactionHash: hashInWireOrder(coin.txid), outpointIndex: coin.index, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() };
    const transaction: TransactionCommon = { version: 2, locktime: 0, inputs: [input], outputs };

    return {
        walletSignRequest: {
            transaction: binToHex(encodeTransaction(transaction)),
            sourceOutputs: [
                {
                    outpointTransactionHash: binToHex(input.outpointTransactionHash),
                    outpointIndex: input.outpointIndex,
                    unlockingBytecode: '',
                    sequenceNumber: input.sequenceNumber,
                    valueSatoshis: `<bigint: ${coin.satoshis}n>`,
                    lockingBytecode: binToHex(ownLock),
                },
            ],
            // The wallet only signs. XOGrid checks the signed transaction and then sends it (broadcastReceipt).
            broadcast: false,
            userPrompt: `Record your ${review.rating}-star XOGrid review on-chain. This pays ${payment} satoshis to the XOGrid review address plus a network fee of ${paidFee} satoshis, and the rest returns to your own address.`,
        },
        network,
        reviewAddress: reviewAddress.address,
        paymentSatoshis: payment.toString(),
        feeSatoshis: paidFee.toString(),
        totalSatoshis: (payment + paidFee).toString(),
    };
}

export interface ReceiptStatus {
    status: 'confirmed' | 'pending';
    txid: string;
    network: ReceiptNetwork;
}

function decodeChecked(hex: string, expectedTxid: string, what: string): TransactionCommon {
    if (!/^([0-9a-f]{2})+$/.test(hex) || hex.length > 200_000) {
        throw new RegistryError(`The ${what} transaction from the chain server is not usable.`, 502);
    }

    const decoded = decodeTransaction(hexToBin(hex));

    if (typeof decoded === 'string' || transactionHashOf(decoded) !== expectedTxid) {
        throw new RegistryError(`The chain server returned the wrong ${what} transaction.`, 502);
    }

    return decoded;
}

/** The output an input spends, read from the previous transaction (whose id is recomputed from its bytes). */
async function spentOutputOf(chain: ChainSource, input: { outpointTransactionHash: Uint8Array; outpointIndex: number }): Promise<Output> {
    const previousTxid = binToHex(input.outpointTransactionHash);
    const previousFetched = await reach(() => chain.getTransaction(previousTxid));

    if (!previousFetched) {
        throw new RegistryError('The coin that transaction spends could not be found.', 502);
    }

    const spent = decodeChecked(previousFetched.hex, previousTxid, 'previous').outputs[input.outpointIndex];

    if (!spent) {
        throw new RegistryError('The coin that transaction spends could not be found.', 502);
    }

    return spent;
}

/**
 * Checks that a transaction is the on-chain receipt of this stored review, and records it. The transaction must be
 * the one the chain server holds (its id is recomputed from the bytes), must parse as a receipt, and must match the
 * review's template, rating, text hash and key. "Confirmed" needs at least one confirmation; before that it is
 * "pending" and does not show as recorded. A confirmed receipt is never replaced.
 */
export async function attachReceipt(db: Db, config: ReceiptConfig | undefined, network: ReceiptNetwork, review: ReviewRow, txid: string): Promise<ReceiptStatus> {
    const { chain, reviewAddress } = configuredChain(config, network);

    if (!/^[0-9a-f]{64}$/.test(txid)) {
        throw new RegistryError('A transaction id is 64 lowercase hex characters.', 400);
    }

    const stored = await db.selectFrom('user_reviews').select(['receipt_txid', 'receipt_network', 'receipt_confirmed']).where('id', '=', review.id).executeTakeFirst();

    if (stored?.receipt_confirmed === 1 && stored.receipt_txid && (stored.receipt_network === 'mainnet' || stored.receipt_network === 'chipnet')) {
        return { status: 'confirmed', txid: stored.receipt_txid, network: stored.receipt_network };
    }

    const fetched = await reach(() => chain.getTransaction(txid));

    if (!fetched) {
        throw new RegistryError('That transaction was not found yet. Wait a moment and try again.', 404);
    }

    const transaction = decodeChecked(fetched.hex, txid, 'receipt');
    const first = transaction.inputs[0];

    if (!first) {
        throw new RegistryError('That transaction has no inputs.', 422);
    }

    const spent = await spentOutputOf(chain, first);

    const parsed = parseReceiptTransaction(transaction, { reviewAddressLockingBytecode: reviewAddress.lockingBytecode, firstInputSpentLockingBytecode: spent.lockingBytecode });

    if (!parsed.valid) {
        throw new RegistryError(`That transaction is not a valid XOGrid receipt: ${parsed.reason}.`, 422);
    }

    const receipt = parsed.receipt;

    if (receipt.identifier !== review.identifier || receipt.reviewerPublicKey !== review.reviewer || receipt.rating !== review.rating || receipt.textHash !== reviewTextDigest(review.body)) {
        throw new RegistryError('That receipt does not match this review (template, rating, text or wallet).', 422);
    }

    const confirmed = (fetched.confirmations ?? 0) >= 1;

    await db
        .updateTable('user_reviews')
        .set({ receipt_txid: txid, receipt_network: network, receipt_confirmed: confirmed ? 1 : 0 })
        .where('id', '=', review.id)
        .execute();

    return { status: confirmed ? 'confirmed' : 'pending', txid, network };
}

const lastChecked = new Map<number, number>();
const RECHECK_MS = 60_000;

/**
 * Re-checks this template's pending receipts, so a receipt turns "confirmed" even when the reviewer has left the page.
 * Each review is looked at most once a minute, and a chain server that is down just leaves it pending.
 */
export async function refreshPendingReceipts(db: Db, config: ReceiptConfig | undefined, identifier: string, now: number = Date.now()): Promise<void> {
    if (!config) {
        return;
    }

    const rows = await db.selectFrom('user_reviews').selectAll().where('identifier', '=', identifier).where('receipt_confirmed', '=', 0).where('receipt_txid', 'is not', null).execute();

    for (const row of rows) {
        if (now - (lastChecked.get(row.id) ?? 0) < RECHECK_MS || (row.receipt_network !== 'mainnet' && row.receipt_network !== 'chipnet') || !row.receipt_txid) {
            continue;
        }

        lastChecked.set(row.id, now);

        try {
            await attachReceipt(db, config, row.receipt_network, row, row.receipt_txid);
        } catch {
            // Still pending: the next look tries again.
        }
    }
}

/** The most a receipt may pay in network fees. Anything above this is refused before it is sent. */
export const MAX_RECEIPT_FEE_SATOSHIS = 10_000n;

/**
 * Takes the transaction the wallet signed, proves it is exactly this review's receipt with a valid signature, and only
 * then sends it. Nothing is sent unless every check passes: one input, the receipt matches the review, the signature
 * is valid in the BCH virtual machine, and the fee is sane. The result is "pending" until it confirms.
 */
export async function broadcastReceipt(db: Db, config: ReceiptConfig | undefined, network: ReceiptNetwork, review: ReviewRow, signedHex: string): Promise<ReceiptStatus> {
    const { chain, reviewAddress } = configuredChain(config, network);

    if (review.receipt_confirmed === 1) {
        throw new RegistryError('This review is already recorded on-chain.', 409);
    }

    if (!/^([0-9a-fA-F]{2}){1,100000}$/.test(signedHex)) {
        throw new RegistryError('The signed transaction is not usable.', 400);
    }

    const decoded = decodeTransaction(hexToBin(signedHex.toLowerCase()));

    if (typeof decoded === 'string' || decoded.inputs.length !== 1) {
        throw new RegistryError('The signed transaction must have exactly one input.', 422);
    }

    const spent = await spentOutputOf(chain, decoded.inputs[0]!);
    const parsed = parseReceiptTransaction(decoded, { reviewAddressLockingBytecode: reviewAddress.lockingBytecode, firstInputSpentLockingBytecode: spent.lockingBytecode });

    if (!parsed.valid) {
        throw new RegistryError(`That transaction is not a valid XOGrid receipt: ${parsed.reason}.`, 422);
    }

    const receipt = parsed.receipt;

    if (receipt.identifier !== review.identifier || receipt.reviewerPublicKey !== review.reviewer || receipt.rating !== review.rating || receipt.textHash !== reviewTextDigest(review.body)) {
        throw new RegistryError('That receipt does not match this review (template, rating, text or wallet).', 422);
    }

    if (spent.token) {
        throw new RegistryError('That transaction spends a coin that carries tokens.', 422);
    }

    const feePaid = spent.valueSatoshis - decoded.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);

    if (feePaid < 0n || feePaid > MAX_RECEIPT_FEE_SATOSHIS) {
        throw new RegistryError(`The network fee (${feePaid} satoshis) is outside what a receipt may pay.`, 422);
    }

    const verdict = createVirtualMachineBch2026().verify({ sourceOutputs: [spent], transaction: decoded });

    if (typeof verdict === 'string') {
        throw new RegistryError(`The wallet's signature is not valid for this transaction: ${verdict}`, 422);
    }

    const txid = receipt.transactionHash;

    try {
        const reported = await chain.broadcast(binToHex(encodeTransaction(decoded)));

        if (reported !== txid) {
            throw new RegistryError('The chain server reported a different transaction id.', 502);
        }
    } catch (error) {
        // Sending the same transaction twice is fine: if the server already has it, carry on.
        if (error instanceof RegistryError || !(await reach(() => chain.getTransaction(txid)))) {
            throw error instanceof RegistryError ? error : new RegistryError(`The network refused the transaction: ${String((error as Error).message).slice(0, 160)}`, 502);
        }
    }

    await db.updateTable('user_reviews').set({ receipt_txid: txid, receipt_network: network, receipt_confirmed: 0 }).where('id', '=', review.id).execute();

    return { status: 'pending', txid, network };
}

export { reviewTextDigest };
