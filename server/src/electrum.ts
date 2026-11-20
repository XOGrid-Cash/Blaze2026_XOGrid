import net from 'node:net';
import tls from 'node:tls';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';

/**
 * A very small Electrum (Fulcrum) client: one connection per request, newline-delimited JSON-RPC. It reads only what
 * receipts need. The server is not trusted for content: callers recompute transaction ids from the bytes they get.
 * "Confirmed" is the server's word (its confirmation count), which is the one thing here that is trusted.
 */

export interface Unspent {
    /** Transaction id in explorer order. */
    txid: string;
    index: number;
    satoshis: bigint;
    /** Block height, or 0 / negative while unconfirmed. */
    height: number;
    /** True when the output carries a CashToken. Such coins are never used to pay for a receipt. */
    hasToken: boolean;
}

export interface FetchedTransaction {
    hex: string;
    /** Undefined when the server did not say; treated as unconfirmed. */
    confirmations: number | undefined;
}

export interface ChainSource {
    getTransaction(txid: string): Promise<FetchedTransaction | undefined>;
    listUnspent(lockingBytecode: Uint8Array): Promise<Unspent[]>;
    /** Sends a signed transaction to the network and returns the id the server reports. */
    broadcast(transactionHex: string): Promise<string>;
}

/** Starting points only; not checked from the build sandbox. Override with ELECTRUM_MAINNET / ELECTRUM_CHIPNET. */
export const DEFAULT_ELECTRUM = { mainnet: 'bch.imaginary.cash:50002', chipnet: 'chipnet.imaginary.cash:50002' } as const;

export interface Endpoint {
    host: string;
    port: number;
    ssl: boolean;
}

/** "host:port" or "ssl://host:port" (TLS) or "tcp://host:port" (plain, for local testing). Plain host:port means TLS. */
export function parseEndpoint(spec: string): Endpoint | undefined {
    const match = /^(?:(ssl|tcp):\/\/)?([A-Za-z0-9.-]+):(\d{1,5})$/.exec(spec.trim());

    if (!match) {
        return undefined;
    }

    const port = Number(match[3]);

    return port >= 1 && port <= 65535 ? { host: match[2]!, port, ssl: match[1] !== 'tcp' } : undefined;
}

export const scriptHashOf = (lockingBytecode: Uint8Array): string => binToHex(sha256.hash(lockingBytecode).reverse());

const NOT_FOUND = /no such|not found|unknown|missing/i;

export class ElectrumServer implements ChainSource {
    constructor(
        private readonly endpoint: Endpoint,
        private readonly options: { timeoutMs?: number; insecureTls?: boolean } = {},
    ) {}

    private call(method: string, params: unknown[]): Promise<unknown> {
        const { host, port, ssl } = this.endpoint;
        const timeoutMs = this.options.timeoutMs ?? 10_000;

        return new Promise((resolve, reject) => {
            const socket = ssl ? tls.connect({ host, port, servername: host, rejectUnauthorized: !this.options.insecureTls }) : net.connect({ host, port });
            let buffer = '';
            let settled = false;
            const finish = (action: () => void) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    socket.destroy();
                    action();
                }
            };
            const timer = setTimeout(() => finish(() => reject(new Error(`Electrum server ${host} did not answer in time.`))), timeoutMs);

            socket.setEncoding('utf8');
            socket.on(ssl ? 'secureConnect' : 'connect', () => {
                socket.write(`${JSON.stringify({ id: 0, method: 'server.version', params: ['XOGrid', '1.4'] })}\n`);
                socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
            });
            socket.on('data', (chunk: string) => {
                buffer += chunk;

                if (buffer.length > 4_000_000) {
                    finish(() => reject(new Error('Electrum response is too large.')));

                    return;
                }

                let newline = buffer.indexOf('\n');

                while (newline >= 0) {
                    const line = buffer.slice(0, newline);

                    buffer = buffer.slice(newline + 1);
                    newline = buffer.indexOf('\n');

                    try {
                        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } | string };

                        if (message.id === 1) {
                            const error = message.error;

                            finish(() =>
                                error
                                    ? reject(new Error(typeof error === 'string' ? error : (error.message ?? 'Electrum error')))
                                    : resolve(message.result),
                            );
                        }
                    } catch {
                        finish(() => reject(new Error('Electrum server sent something that is not JSON.')));
                    }
                }
            });
            socket.on('error', (error) => finish(() => reject(error)));
            socket.on('close', () => finish(() => reject(new Error('Electrum server closed the connection.'))));
        });
    }

    async getTransaction(txid: string): Promise<FetchedTransaction | undefined> {
        try {
            const result = await this.call('blockchain.transaction.get', [txid, true]);

            if (typeof result === 'string') {
                return { hex: result, confirmations: undefined };
            }

            const object = result as { hex?: unknown; confirmations?: unknown };

            if (typeof object?.hex !== 'string') {
                return undefined;
            }

            return { hex: object.hex, confirmations: typeof object.confirmations === 'number' ? object.confirmations : undefined };
        } catch (error) {
            if (NOT_FOUND.test((error as Error).message)) {
                return undefined;
            }

            throw error;
        }
    }

    async broadcast(transactionHex: string): Promise<string> {
        return String(await this.call('blockchain.transaction.broadcast', [transactionHex]));
    }

    async listUnspent(lockingBytecode: Uint8Array): Promise<Unspent[]> {
        const result = await this.call('blockchain.scripthash.listunspent', [scriptHashOf(lockingBytecode)]);

        if (!Array.isArray(result)) {
            return [];
        }

        return result.flatMap((item: { tx_hash?: unknown; tx_pos?: unknown; value?: unknown; height?: unknown; token_data?: unknown }) =>
            typeof item.tx_hash === 'string' && /^[0-9a-f]{64}$/.test(item.tx_hash) && Number.isInteger(item.tx_pos) && typeof item.value === 'number'
                ? [{ txid: item.tx_hash, index: item.tx_pos as number, satoshis: BigInt(item.value), height: typeof item.height === 'number' ? item.height : 0, hasToken: item.token_data !== undefined && item.token_data !== null }]
                : [],
        );
    }
}

export const hexOk = (value: string): boolean => /^([0-9a-f]{2})+$/.test(value) && hexToBin(value).length > 0;

/** "host:port,host:port" gives several servers, tried in order (see FailoverChain). Undefined when any entry is malformed. */
export function parseEndpoints(spec: string): Endpoint[] | undefined {
    const items = spec.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
    const parsed = items.map(parseEndpoint);

    return items.length > 0 && parsed.every((item) => item !== undefined) ? (parsed as Endpoint[]) : undefined;
}

/**
 * Several chain servers behind one ChainSource. Every call goes to the first server that answers; a server that errors
 * is skipped and the next one is tried. Broadcasts are retried on the next server too, because a server whose index
 * is behind its node rejects a transaction another server accepts. The first error is the one reported.
 */
export class FailoverChain implements ChainSource {
    constructor(private readonly sources: ChainSource[]) {
        if (sources.length === 0) {
            throw new Error('FailoverChain needs at least one server.');
        }
    }

    private async firstAnswer<T>(ask: (source: ChainSource) => Promise<T>): Promise<T> {
        let firstError: unknown;

        for (const source of this.sources) {
            try {
                return await ask(source);
            } catch (error) {
                firstError ??= error;
            }
        }

        throw firstError;
    }

    async getTransaction(txid: string): Promise<FetchedTransaction | undefined> {
        let firstError: unknown;
        let answered = false;

        for (const source of this.sources) {
            try {
                const found = await source.getTransaction(txid);

                answered = true;

                if (found) {
                    return found;
                }
            } catch (error) {
                firstError ??= error;
            }
        }

        if (!answered) {
            throw firstError;
        }

        return undefined;
    }

    listUnspent(lockingBytecode: Uint8Array): Promise<Unspent[]> {
        return this.firstAnswer((source) => source.listUnspent(lockingBytecode));
    }

    broadcast(transactionHex: string): Promise<string> {
        return this.firstAnswer((source) => source.broadcast(transactionHex));
    }
}

