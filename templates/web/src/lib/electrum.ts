/**
 * Read-only Electrum lookups from the browser (WebSocket). Host lists match frontend/src/voucher/core.ts.
 * This tool never broadcasts: the XO wallet that imports an invitation does.
 */
import { binToHex, sha256 } from '@bitauth/libauth';
import { ElectrumClient } from '@electrum-cash/network';
import type { Network } from './invitation.js';

const HOSTS: Record<Network, string[]> = {
    chipnet: ['chipnet.imaginary.cash', 'chipnet.bch.ninja'],
    mainnet: ['bch.imaginary.cash', 'electrum.imaginary.cash', 'cashnode.bch.ninja', 'fulcrum.greyh.at'],
};

export type NftCapability = 'none' | 'mutable' | 'minting';

/** CashTokens on a coin, as Electrum reports them: category in display (big-endian) hex, commitment in hex. */
export interface CoinToken {
    category: string;
    amount: bigint;
    nft?: { capability: NftCapability; commitment: string };
}

export interface UnspentCoin {
    transactionHash: string;
    outputIndex: number;
    valueSatoshis: bigint;
    /** Block height, or 0 while unconfirmed. */
    height: number;
    hasTokens: boolean;
    token?: CoinToken;
}

export interface ElectrumUnspent {
    tx_hash: string;
    tx_pos: number;
    value: number;
    height: number;
    token_data?: { category: string; amount?: string | number; nft?: { capability: NftCapability; commitment?: string } };
}

export const toCoinToken = (data: NonNullable<ElectrumUnspent['token_data']>): CoinToken => ({
    category: data.category,
    amount: BigInt(data.amount ?? 0),
    ...(data.nft ? { nft: { capability: data.nft.capability, commitment: data.nft.commitment ?? '' } } : {}),
});

export const toUnspentCoin = (coin: ElectrumUnspent): UnspentCoin => ({
    transactionHash: coin.tx_hash,
    outputIndex: coin.tx_pos,
    valueSatoshis: BigInt(coin.value),
    height: coin.height > 0 ? coin.height : 0,
    hasTokens: coin.token_data !== undefined,
    ...(coin.token_data ? { token: toCoinToken(coin.token_data) } : {}),
});

export interface UnspentCoinList {
    coins: UnspentCoin[];
    tipHeight: number;
    /** The server refused the token filter, so it may have left out coins that carry tokens. */
    tokensMayBeHidden: boolean;
}

/** Electrum's script hash: sha256 of the locking bytecode, byte-reversed. */
export const electrumScriptHash = (lockingBytecode: Uint8Array): string => binToHex(sha256.hash(lockingBytecode).reverse());

async function withClient<Result>(network: Network, use: (request: (method: string, ...parameters: string[]) => Promise<unknown>) => Promise<Result>): Promise<Result> {
    const failures: string[] = [];

    for (const host of HOSTS[network]) {
        const client = new ElectrumClient('XOGrid-template-tools', '1.4.1', host);

        try {
            await client.connect();
        } catch (error) {
            failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }

        try {
            return await use(async (method, ...parameters) => {
                const result = await client.request(method, ...parameters);

                if (result instanceof Error) {
                    throw result;
                }

                return result;
            });
        } finally {
            await client.disconnect(true).catch(() => undefined);
        }
    }

    throw new Error(`No ${network} Electrum server reachable. ${failures.join('; ')}`);
}

/**
 * Unspent coins at a locking bytecode, including unconfirmed ones, plus the current tip height. Uses listunspent, never
 * the address history.
 *
 * Fulcrum leaves out coins that carry CashTokens unless listunspent gets a token filter, so this asks for
 * `include_tokens`. A server that doesn't know the filter gets the plain request, and the result says tokens may be
 * hidden.
 */
export async function listUnspentCoins(network: Network, lockingBytecode: Uint8Array): Promise<UnspentCoinList> {
    const scriptHash = electrumScriptHash(lockingBytecode);

    return withClient(network, async (request) => {
        let unspent: ElectrumUnspent[];
        let tokensMayBeHidden = false;

        try {
            unspent = (await request('blockchain.scripthash.listunspent', scriptHash, 'include_tokens')) as ElectrumUnspent[];
        } catch {
            unspent = (await request('blockchain.scripthash.listunspent', scriptHash)) as ElectrumUnspent[];
            tokensMayBeHidden = true;
        }

        const tip = (await request('blockchain.headers.get_tip')) as { height: number };
        const coins = unspent.map(toUnspentCoin);

        return {
            coins: coins.sort((a, b) => (b.valueSatoshis > a.valueSatoshis ? 1 : b.valueSatoshis < a.valueSatoshis ? -1 : 0)),
            tipHeight: tip.height,
            tokensMayBeHidden,
        };
    });
}

/** A transaction's raw hex, by its display-order hash. */
export async function getTransactionHex(network: Network, transactionHash: string): Promise<string> {
    if (!/^[0-9a-f]{64}$/i.test(transactionHash)) {
        throw new Error('Enter a 64-character transaction id.');
    }

    return withClient(network, async (request) => String(await request('blockchain.transaction.get', transactionHash.toLowerCase())));
}
