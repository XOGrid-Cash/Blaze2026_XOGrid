import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import {
    DRIP_MINE_BUILD,
    DRIP_MINE_TEMPLATE_IDENTIFIER,
    buildDripTransaction,
    buildDripTransactionIndependent,
    dripMineLockingBytecode,
    verifyDripTransaction,
} from '../src/run-drip-mine.js';

const TXID = 'deeebd145f9ebe63518fe926d9c7b0400a507d48d003cb29b7ddad03acb061ff';

describe('Drip Mine runs are built by the XO engine', () => {
    it('uses the registry template, whose identifier is the one published for Drip Mine', () => {
        expect(DRIP_MINE_TEMPLATE_IDENTIFIER).toBe('346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185');
        expect(DRIP_MINE_BUILD).toEqual({ engine: '@xo-cash/engine', templateIdentifier: DRIP_MINE_TEMPLATE_IDENTIFIER });
    });

    it.each([
        [741n, 'drip'],
        [50_000n, 'drip'],
        [99_971_459n, 'drip'],
        [99_971_669_342n, 'drip'],
        [740n, 'terminate'],
        [200n, 'terminate'],
    ] as const)('the engine and the independent builder agree byte for byte for a %s-satoshi coin (%s)', (satoshis, action) => {
        for (const network of ['chipnet', 'mainnet'] as const) {
            const coin = { txid: TXID, index: 3, satoshis };
            const viaEngine = buildDripTransaction(coin, network);
            const independent = buildDripTransactionIndependent(coin);

            expect(viaEngine.action).toBe(action);
            expect(viaEngine.transactionHex).toBe(independent.transactionHex);
            expect(viaEngine.transactionId).toBe(independent.transactionId);
            expect(verifyDripTransaction(viaEngine.transaction, satoshis)).toBe(true);
        }
    });

    it('spends the coin it was given, in wire order, with sequence number 1 and the Drip Mine lock on the remainder', () => {
        const plan = buildDripTransaction({ txid: TXID, index: 3, satoshis: 100_000n });
        const decoded = decodeTransaction(hexToBin(plan.transactionHex));

        if (typeof decoded === 'string') {
            throw new Error(decoded);
        }

        expect(decoded.inputs).toHaveLength(1);
        // libauth hands the hash back in the order of the txid text; on the wire it is that txid reversed.
        expect(binToHex(decoded.inputs[0]!.outpointTransactionHash)).toBe(TXID);
        expect(plan.transactionHex.slice(10, 74)).toBe(binToHex(hexToBin(TXID).reverse()));
        expect(decoded.inputs[0]!.outpointIndex).toBe(3);
        expect(decoded.inputs[0]!.sequenceNumber).toBe(1);
        expect(decoded.outputs).toHaveLength(1);
        expect(binToHex(decoded.outputs[0]!.lockingBytecode)).toBe(binToHex(dripMineLockingBytecode));
        expect(decoded.outputs[0]!.valueSatoshis).toBe(100_000n - plan.payoutSatoshis);
    });
});
