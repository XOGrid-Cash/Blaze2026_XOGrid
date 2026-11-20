import { createHash, randomBytes } from 'node:crypto';
import { encodeLockingBytecodeP2pkh, hash160, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { CHALLENGE_TTL_MS, type LoginProof } from './admin.js';
import { verifyChallengeTransaction } from './auth/challenge-transaction.js';
import { recoverSigner } from './auth/signed-message.js';
import type { Db } from './db.js';
import { RegistryError } from './registry.js';

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MIN_BODY = 3;
export const MAX_BODY = 1000;
const MAX_PENDING = 2000;

export interface ReviewDraft {
    rating: number;
    body: string;
}

/** Validates and normalises a review. Control characters are removed and whitespace is tidied; HTML is left as text. */
export function validateReview(rating: unknown, body: unknown): ReviewDraft {
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
        throw new RegistryError(`rating must be a whole number from ${MIN_RATING} to ${MAX_RATING}.`, 400);
    }

    if (typeof body !== 'string') {
        throw new RegistryError(`A review needs text of ${MIN_BODY} to ${MAX_BODY} characters.`, 400);
    }

    // eslint-disable-next-line no-control-regex
    const cleaned = body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (cleaned.length < MIN_BODY || cleaned.length > MAX_BODY) {
        throw new RegistryError(`A review needs text of ${MIN_BODY} to ${MAX_BODY} characters.`, 400);
    }

    return { rating, body: cleaned };
}

/** The text a wallet that signs messages is asked to sign. It binds the template, rating and exact review text. */
export function reviewMessage(identifier: string, draft: ReviewDraft, nonce: string, expiresAt: Date): string {
    const digest = createHash('sha256').update(draft.body, 'utf8').digest('hex');

    return `XOGrid review\ntemplate: ${identifier}\nrating: ${draft.rating}\ntext sha256: ${digest}\nnonce: ${nonce}\nexpires: ${expiresAt.toISOString()}`;
}

interface Pending {
    identifier: string;
    draft: ReviewDraft;
    expiresAt: number;
    message: string;
}

/**
 * Holds a review between "here is my review" and "here is my wallet proof". The server keeps the text, and the nonce
 * the wallet signs points at it, so the proof can only ever publish exactly the review that was submitted. A nonce
 * works once, whether or not the proof is good.
 */
export class ReviewAuth {
    private readonly pending = new Map<string, Pending>();

    constructor(private readonly now: () => number = Date.now) {}

    begin(identifier: string, draft: ReviewDraft): { nonce: string; expiresAt: string; message: string } {
        this.sweep();

        if (this.pending.size >= MAX_PENDING) {
            throw new RegistryError('Too many reviews are waiting for a signature. Try again in a few minutes.', 429);
        }

        const nonce = randomBytes(16).toString('hex');
        const expiresAt = this.now() + CHALLENGE_TTL_MS;
        const message = reviewMessage(identifier, draft, nonce, new Date(expiresAt));

        this.pending.set(nonce, { identifier, draft, expiresAt, message });

        return { nonce, expiresAt: new Date(expiresAt).toISOString(), message };
    }

    complete(identifier: string, nonce: string, proof: LoginProof): { publicKey: string; draft: ReviewDraft } | { failure: string } {
        this.sweep();

        const entry = this.pending.get(nonce);

        this.pending.delete(nonce);

        if (!entry || entry.expiresAt <= this.now()) {
            return { failure: 'unknown or expired review challenge' };
        }

        if (entry.identifier !== identifier) {
            return { failure: 'challenge was issued for another template' };
        }

        if (proof.type === 'transaction') {
            const result = verifyChallengeTransaction(nonce, proof.signedTransaction);

            return result.valid && result.publicKey ? { publicKey: result.publicKey, draft: entry.draft } : { failure: `transaction proof rejected: ${result.reason}` };
        }

        const result = recoverSigner(entry.message, proof.signature);

        return result.valid && result.recoveredPublicKey ? { publicKey: result.recoveredPublicKey, draft: entry.draft } : { failure: `message proof rejected: ${result.reason}` };
    }

    private sweep(): void {
        const now = this.now();

        for (const [nonce, entry] of this.pending) {
            if (entry.expiresAt <= now) {
                this.pending.delete(nonce);
            }
        }
    }
}

/** The mainnet cash address for a compressed public key, used only to show who wrote a review. */
export function addressOfPublicKey(publicKeyHex: string): string {
    const result = lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(hash160(hexToBin(publicKeyHex))), prefix: 'bitcoincash' });

    if (typeof result === 'string') {
        throw new Error(result);
    }

    return result.address;
}

function receiptOf(row: { receipt_txid?: string | null; receipt_network?: string | null; receipt_confirmed?: number }): UserReview['receipt'] {
    if (!row.receipt_txid || (row.receipt_network !== 'mainnet' && row.receipt_network !== 'chipnet')) {
        return null;
    }

    return { txid: row.receipt_txid, network: row.receipt_network, status: row.receipt_confirmed === 1 ? 'confirmed' : 'pending' };
}

const shorten = (address: string): string => `${address.slice(0, 16)}...${address.slice(-6)}`;

export interface UserReview {
    id: number;
    reviewerAddress: string;
    reviewer: string;
    rating: number;
    body: string;
    createdAt: string;
    /** The on-chain receipt, when the reviewer recorded one. "pending" has been broadcast but is not confirmed yet. */
    receipt: { txid: string; network: 'mainnet' | 'chipnet'; status: 'confirmed' | 'pending' } | null;
}

export interface RatingStats {
    count: number;
    average: number | null;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

const iso = (): string => new Date().toISOString();

export async function saveUserReview(db: Db, identifier: string, publicKey: string, draft: ReviewDraft): Promise<{ id: number; reviewerAddress: string }> {
    const template = await db.selectFrom('templates').select(['removed']).where('identifier', '=', identifier).executeTakeFirst();

    if (!template) {
        throw new RegistryError('Template not found.', 404);
    }

    if (template.removed === 1) {
        throw new RegistryError('A removed template cannot be reviewed.', 409);
    }

    const existing = await db.selectFrom('user_reviews').select('id').where('identifier', '=', identifier).where('reviewer', '=', publicKey).executeTakeFirst();

    if (existing) {
        throw new RegistryError('This wallet has already reviewed this template.', 409);
    }

    try {
        const inserted = await db
            .insertInto('user_reviews')
            .values({ identifier, reviewer: publicKey, rating: draft.rating, body: draft.body, created_at: iso(), hidden: 0, hidden_reason: null })
            .returning('id')
            .executeTakeFirstOrThrow();

        return { id: inserted.id, reviewerAddress: addressOfPublicKey(publicKey) };
    } catch (error) {
        // Two submissions racing past the check above hit the unique constraint (PostgreSQL code 23505, or SQLite's message).
        if ((error as { code?: string }).code === '23505' || /UNIQUE constraint failed/i.test(String((error as Error).message))) {
            throw new RegistryError('This wallet has already reviewed this template.', 409);
        }

        throw error;
    }
}

export async function ratingStats(db: Db, identifier: string): Promise<RatingStats> {
    const rows = await db.selectFrom('user_reviews').select('rating').where('identifier', '=', identifier).where('hidden', '=', 0).execute();

    return statsFromRatings(rows.map((row) => row.rating));
}

export function statsFromRatings(ratings: number[]): RatingStats {
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

    for (const rating of ratings) {
        distribution[String(rating) as keyof typeof distribution] += 1;
    }

    const count = ratings.length;

    return { count, average: count === 0 ? null : Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / count) * 10) / 10, distribution };
}

export async function listUserReviews(db: Db, identifier: string, page = 1, pageSize = 10): Promise<{ items: UserReview[]; total: number; page: number; pageSize: number; stats: RatingStats }> {
    const size = Math.min(Math.max(pageSize, 1), 50);
    const current = Math.max(page, 1);
    const rows = await db.selectFrom('user_reviews').selectAll().where('identifier', '=', identifier).where('hidden', '=', 0).orderBy('id', 'desc').execute();

    return {
        items: rows.slice((current - 1) * size, current * size).map((row) => {
            const address = addressOfPublicKey(row.reviewer);

            return { id: row.id, reviewerAddress: address, reviewer: shorten(address), rating: row.rating, body: row.body, createdAt: row.created_at, receipt: receiptOf(row) };
        }),
        total: rows.length,
        page: current,
        pageSize: size,
        stats: statsFromRatings(rows.map((row) => row.rating)),
    };
}

/** Per-template rating totals for list and detail pages, in one query. Hidden reviews never count. */
export async function loadRatings(db: Db): Promise<Map<string, RatingStats>> {
    const byTemplate = new Map<string, number[]>();

    for (const row of await db.selectFrom('user_reviews').select(['identifier', 'rating']).where('hidden', '=', 0).execute()) {
        byTemplate.set(row.identifier, [...(byTemplate.get(row.identifier) ?? []), row.rating]);
    }

    return new Map([...byTemplate].map(([identifier, ratings]) => [identifier, statsFromRatings(ratings)]));
}

export async function setReviewHidden(db: Db, id: number, hidden: boolean, reason: string | null): Promise<{ identifier: string } | undefined> {
    const row = await db.selectFrom('user_reviews').select(['identifier']).where('id', '=', id).executeTakeFirst();

    if (!row) {
        return undefined;
    }

    await db.updateTable('user_reviews').set({ hidden: hidden ? 1 : 0, hidden_reason: hidden ? reason : null }).where('id', '=', id).execute();

    return { identifier: row.identifier };
}
