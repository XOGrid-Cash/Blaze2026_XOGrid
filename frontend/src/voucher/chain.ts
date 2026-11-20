import { ElectrumClient } from '@electrum-cash/network';
import { NETWORKS, electrumScriptHash, type Network, type VoucherCoin } from './core';

type Param = string | number | boolean | object | null;
interface Unspent { tx_hash: string; tx_pos: number; value: number; token_data?: unknown }

/** A small Electrum connection for one network: finds coins and broadcasts transactions. */
export class Chain {
    private client: ElectrumClient<never> | undefined;

    constructor(readonly network: Network, private readonly log: (line: string) => void = () => undefined) {}

    private connecting: Promise<ElectrumClient<never>> | undefined;

    /** Lookups can start together; they all wait for the same connection instead of opening one each. */
    private connection(): Promise<ElectrumClient<never>> {
        this.connecting ??= this.open().catch((error: unknown) => {
            this.connecting = undefined;

            throw error;
        });

        return this.connecting;
    }

    private async open(): Promise<ElectrumClient<never>> {
        if (this.client) {
            return this.client;
        }

        for (const host of NETWORKS[this.network].hosts) {
            try {
                const candidate = new ElectrumClient<never>('XOGrid', '1.4.1', host, { port: 50004, encrypted: true, timeoutInMilliSeconds: 10000 } as never);

                await candidate.connect();
                this.client = candidate;
                this.log(`Connected to ${this.network} server ${host}`);

                return candidate;
            } catch (error) {
                this.log(`Server ${host} unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        throw new Error(`No ${this.network} Electrum server reachable from this browser.`);
    }

    private async request(method: string, ...parameters: Param[]): Promise<unknown> {
        const result = await (await this.connection()).request(method, ...parameters);

        if (result instanceof Error) {
            throw result;
        }

        return result;
    }

    /** Spendable coins at a locking bytecode. Coins carrying CashTokens are always left out: a plain spend would burn them. */
    async plainCoins(lockingBytecode: Uint8Array): Promise<{ transactionHash: string; outputIndex: number; valueSatoshis: bigint }[]> {
        const scriptHash = electrumScriptHash(lockingBytecode);
        let response: unknown;

        try {
            response = await this.request('blockchain.scripthash.listunspent', scriptHash, 'exclude_tokens');
        } catch {
            response = await this.request('blockchain.scripthash.listunspent', scriptHash);
        }

        return (response as Unspent[]).filter((coin) => coin.token_data === undefined).map((coin) => ({ transactionHash: coin.tx_hash, outputIndex: coin.tx_pos, valueSatoshis: BigInt(coin.value) }));
    }

    async findVoucher(lockingBytecode: Uint8Array): Promise<VoucherCoin | undefined> {
        const coins = await this.plainCoins(lockingBytecode);

        return coins.sort((a, b) => Number(b.valueSatoshis - a.valueSatoshis))[0];
    }

    /** Broadcasts and returns the transaction id the server reports. */
    async broadcast(transactionHex: string): Promise<string> {
        return String(await this.request('blockchain.transaction.broadcast', transactionHex));
    }

    async close(): Promise<void> {
        await this.client?.disconnect().catch(() => undefined);
        this.client = undefined;
        this.connecting = undefined;
    }
}
