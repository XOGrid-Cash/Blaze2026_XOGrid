import {
    CashAddressType,
    binToHex,
    decodeCashAddress,
    decodeHdPublicKey,
    deriveHdPublicNodeChild,
    encodeLockingBytecodeP2pkh,
    hash160,
    hexToBin,
    lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import type { Db } from './db.js';

/** The two networks receipts can be recorded on. Chipnet uses the test address prefix. */
export type ReceiptNetwork = 'mainnet' | 'chipnet';

export const RECEIPT_NETWORKS: readonly ReceiptNetwork[] = ['mainnet', 'chipnet'];

export const isReceiptNetwork = (value: unknown): value is ReceiptNetwork => value === 'mainnet' || value === 'chipnet';

export interface ReviewAddress {
    address: string;
    lockingBytecode: Uint8Array;
}

/**
 * The review address comes from the admin identity the team already controls, so the key that signs moderator logins
 * also controls the money that arrives with receipts. An identity is a compressed public key, a P2PKH cash address, or
 * an extended public key (its first child key is used). The same key gives a mainnet and a chipnet address.
 * Returns undefined when the identity is none of these.
 */
export function reviewAddressFor(identity: string, network: ReceiptNetwork): ReviewAddress | undefined {
    const entry = identity.trim();
    let hash: Uint8Array | undefined;

    if (/^(02|03)[0-9a-fA-F]{64}$/.test(entry)) {
        hash = hash160(hexToBin(entry.toLowerCase()));
    } else if (/^[xt]pub/.test(entry)) {
        const decoded = decodeHdPublicKey(entry);

        if (typeof decoded === 'string') {
            return undefined;
        }

        const child = deriveHdPublicNodeChild(decoded.node, 0);

        if (typeof child === 'string') {
            return undefined;
        }

        hash = hash160(child.publicKey);
    } else {
        const decoded = [entry, `bitcoincash:${entry}`, `bchtest:${entry}`].map((candidate) => decodeCashAddress(candidate)).find((result) => typeof result !== 'string');

        if (!decoded || typeof decoded === 'string' || (decoded.type !== CashAddressType.p2pkh && decoded.type !== CashAddressType.p2pkhWithTokens)) {
            return undefined;
        }

        hash = decoded.payload;
    }

    const lockingBytecode = encodeLockingBytecodeP2pkh(hash);
    const encoded = lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest' });

    return typeof encoded === 'string' ? undefined : { address: encoded.address, lockingBytecode };
}

/**
 * Picks the admin identity that owns the review address: the one with the given label (REVIEW_IDENTITY_LABEL), or the
 * first usable one on the allowlist. Returns undefined when there is none.
 */
export async function resolveReviewIdentity(db: Db, label?: string): Promise<string | undefined> {
    const rows = await db.selectFrom('admins').selectAll().orderBy('added_at', 'asc').execute();
    const wanted = label?.trim();
    const candidates = wanted ? rows.filter((row) => row.label === wanted) : rows;

    return candidates.map((row) => row.address_or_pubkey).find((identity) => reviewAddressFor(identity, 'mainnet') !== undefined);
}

export const publicKeyHexOrUndefined = (value: unknown): string | undefined => (typeof value === 'string' && /^0[23][0-9a-f]{64}$/.test(value) ? value : undefined);

export { binToHex };
