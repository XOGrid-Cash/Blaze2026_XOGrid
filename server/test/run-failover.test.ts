import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { transactionHashOf } from '../src/review-receipt.js';
import { FailoverChain, parseEndpoints, type ChainSource, type Unspent } from '../src/electrum.js';
import { dripMineAddress, runDripMine, SPENT_COIN_ERROR, type RunConfig } from '../src/run-drip-mine.js';

const coinAt = (id: string, satoshis: bigint): Unspent => ({ txid: id.repeat(32), index: 0, satoshis, height: 100, hasToken: false });

function chain(options: { coins?: () => Unspent[]; broadcast?: (hex: string) => string; known?: boolean; failList?: boolean }): ChainSource & { sent: string[] } {
    const sent: string[] = [];

    return {
        sent,
        async listUnspent() {
            if (options.failList) {
                throw new Error('server down');
            }

            return options.coins ? options.coins() : [];
        },
        async getTransaction() {
            return options.known === false ? undefined : { hex: '00', confirmations: 3 };
        },
        async broadcast(hex) {
            sent.push(hex);

            if (options.broadcast) {
                return options.broadcast(hex);
            }

            throw new Error('unexpected broadcast');
        },
    };
}

const config = (source: ChainSource): RunConfig => ({ chains: { chipnet: source, mainnet: source } });

describe('several servers', () => {
    it('reads a comma-separated list and refuses a malformed entry', () => {
        expect(parseEndpoints('a.example:50002, b.example:50002')?.map((item) => item.host)).toEqual(['a.example', 'b.example']);
        expect(parseEndpoints('tcp://127.0.0.1:1')?.[0]?.ssl).toBe(false);
        expect(parseEndpoints('a.example:50002,nonsense')).toBeUndefined();
        expect(parseEndpoints('')).toBeUndefined();
    });

    it('lists from the first server that answers and broadcasts on the next one when the first refuses', async () => {
        const down = chain({ failList: true, broadcast: () => { throw new Error('Missing inputs'); } });
        const up = chain({ coins: () => [coinAt('aa', 5000n)], broadcast: () => 'f'.repeat(64) });
        const both = new FailoverChain([down, up]);

        expect(await both.listUnspent(new Uint8Array([1]))).toHaveLength(1);
        expect(await both.broadcast('00')).toBe('f'.repeat(64));
        expect(down.sent).toHaveLength(1);
        expect(up.sent).toHaveLength(1);
    });

    it('reports the first error when every server refuses, and finds a transaction on a later server', async () => {
        const one = chain({ broadcast: () => { throw new Error('first'); }, known: false });
        const two = chain({ broadcast: () => { throw new Error('second'); } });

        await expect(new FailoverChain([one, two]).broadcast('00')).rejects.toThrow('first');
        expect((await new FailoverChain([one, two]).getTransaction('aa'))?.confirmations).toBe(3);
        expect(() => new FailoverChain([])).toThrow();
    });
});

describe('a coin that is taken', () => {
    it('recognises the usual node wording', () => {
        for (const text of ['Missing inputs', 'bad-txns-inputs-missingorspent', 'txn-mempool-conflict', 'inputs already spent']) {
            expect(SPENT_COIN_ERROR.test(text)).toBe(true);
        }

        expect(SPENT_COIN_ERROR.test('min relay fee not met')).toBe(false);
    });

    it('says the coin was taken when the list no longer shows it, and sends nothing else', async () => {
        let calls = 0;
        const source = chain({
            coins: () => (calls++ === 0 ? [coinAt('aa', 100_000n)] : []),
            broadcast: () => { throw new Error('the transaction was rejected by network rules. Missing inputs'); },
        });

        await expect(runDripMine(config(source), 'chipnet', 'aa'.repeat(32), 0, false)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Someone else spent') });
        expect(source.sent).toHaveLength(1);
    });

    it('says the index is out of step when the list still shows the coin, and keeps the node text', async () => {
        const source = chain({ coins: () => [coinAt('aa', 100_000n)], known: false, broadcast: () => { throw new Error('Missing inputs'); } });

        await expect(runDripMine(config(source), 'chipnet', 'aa'.repeat(32), 0, false)).rejects.toMatchObject({
            status: 502,
            message: expect.stringMatching(/out of step.*Missing inputs/s),
        });
    });

    it('with anyCoin, moves on to the next spendable coin and reports how many were taken', async () => {
        const coins = [coinAt('aa', 300_000n), coinAt('bb', 200_000n), coinAt('cc', 100_000n)];
        const source = chain({
            coins: () => coins,
            broadcast: (hex) => {
                if (hex.includes('aa'.repeat(32)) || hex.includes('bb'.repeat(32))) {
                    throw new Error('Missing inputs');
                }

                const decoded = decodeTransaction(hexToBin(hex));

                if (typeof decoded === 'string') {
                    throw new Error(decoded);
                }

                return transactionHashOf(decoded);
            },
        });
        const done = await runDripMine(config(source), 'chipnet', 'aa'.repeat(32), 0, false, true);

        expect(done.coin.txid).toBe('cc'.repeat(32));
        expect(done.coinsSkipped).toBe(2);
        expect(source.sent).toHaveLength(3);
    });

    it('gives up after the chosen coin and three more, and says every coin was refused', async () => {
        const coins = ['aa', 'bb', 'cc', 'dd', 'ee'].map((id, n) => coinAt(id, BigInt(500_000 - n * 1000)));
        const source = chain({ coins: () => coins, broadcast: () => { throw new Error('Missing inputs'); } });

        await expect(runDripMine(config(source), 'chipnet', 'aa'.repeat(32), 0, false, true)).rejects.toMatchObject({ message: expect.stringContaining('4 coins were tried') });
        expect(source.sent).toHaveLength(4);
    });

    it('without anyCoin, tries only the coin asked for', async () => {
        const source = chain({ coins: () => [coinAt('aa', 300_000n), coinAt('bb', 200_000n)], broadcast: () => { throw new Error('Missing inputs'); } });

        await expect(runDripMine(config(source), 'chipnet', 'aa'.repeat(32), 0, false)).rejects.toBeDefined();
        expect(source.sent).toHaveLength(1);
        expect(dripMineAddress('chipnet')).toMatch(/^bchtest:/);
    });
});
