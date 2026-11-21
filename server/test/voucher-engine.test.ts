import { binToHex, encodeTransaction, hexToBin, secp256k1 } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import {
    CLAIM_FEE_SATOSHIS,
    VOUCHER_TEMPLATE_IDENTIFIER,
    buildClaim as independentBuildClaim,
    buildIssue as independentBuildIssue,
    codeHash,
    prepareClaim as independentPrepareClaim,
    voucherLockingBytecode as independentLock,
    voucherUnlockingBytecode as independentUnlock,
    walletLockingBytecode,
    type Coin,
} from '../../frontend/src/voucher/core.js';
import { VOUCHER_BUILD, buildClaim, buildIssue, buildIssueSignRequest, prepareClaim, voucherLockingBytecode, voucherUnlockingBytecode } from '../../frontend/src/voucher/xo.js';

// A real voucher created and claimed on chipnet by scripts/chipnet-voucher.ts.
const REAL_CODE = hexToBin('8524747c3baa65f7ef86fa28ecdf18d3');
const REAL_LOCK = 'aa200eb8f3314211e967d00a6e8ef7b614732ff118a5385dfb4ce4c626cc2473566387';

const publicKey = secp256k1.derivePublicKeyCompressed(hexToBin('11'.repeat(32))) as Uint8Array;
const coin: Coin = { transactionHash: 'cd'.repeat(32), outputIndex: 1, valueSatoshis: 20_000n, pathName: 'receive', addressIndex: 0, publicKey };
const hash = codeHash(REAL_CODE);

describe('the Claim-Code Voucher is built by the XO engine', () => {
    it('uses the registry template, and reports it', () => {
        expect(VOUCHER_BUILD).toEqual({ engine: '@xo-cash/engine', templateIdentifier: VOUCHER_TEMPLATE_IDENTIFIER });
        expect(VOUCHER_TEMPLATE_IDENTIFIER).toBe('317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911');
    });

    it('the engine compiles the exact on-chain lock, and the same unlocking script as the independent code', () => {
        expect(binToHex(voucherLockingBytecode(hash))).toBe(REAL_LOCK);
        expect(binToHex(voucherLockingBytecode(hash))).toBe(binToHex(independentLock(hash)));
        expect(binToHex(voucherUnlockingBytecode(REAL_CODE))).toBe(binToHex(independentUnlock(REAL_CODE)));
    });

    it.each([1_000n, 5_000n, 12_345n])('the engine-built issue transaction for %s sats equals the independent one byte for byte', (amount) => {
        const viaEngine = buildIssue(coin, amount, hash);
        const independent = independentBuildIssue(coin, amount, hash);

        expect(binToHex(encodeTransaction(viaEngine.transaction))).toBe(binToHex(encodeTransaction(independent.transaction)));
        expect(viaEngine.changeSatoshis).toBe(independent.changeSatoshis);
        expect(buildIssueSignRequest(coin, amount, hash).transaction).toBe(binToHex(encodeTransaction(independent.transaction)));
    });

    it('the engine-built claim equals the independent one byte for byte, and the BCH virtual machine accepts it', () => {
        const voucher = { transactionHash: 'ef'.repeat(32), outputIndex: 0, valueSatoshis: 5_000n };
        const destination = walletLockingBytecode(publicKey);
        const viaEngine = buildClaim(voucher, REAL_CODE, destination);
        const independent = independentBuildClaim(voucher, REAL_CODE, destination);

        expect(binToHex(encodeTransaction(viaEngine.transaction))).toBe(binToHex(encodeTransaction(independent.transaction)));
        expect(viaEngine.transaction.outputs[0]!.valueSatoshis).toBe(voucher.valueSatoshis - CLAIM_FEE_SATOSHIS);

        const verdict = prepareClaim(voucher, REAL_CODE, destination);

        expect(verdict.valid).toBe(true);
        expect(verdict).toEqual(independentPrepareClaim(voucher, REAL_CODE, destination));
    });

    it('a wrong code does not unlock the real voucher', () => {
        const wrong = buildClaim({ transactionHash: 'ef'.repeat(32), outputIndex: 0, valueSatoshis: 5_000n }, hexToBin('00'.repeat(16)), walletLockingBytecode(publicKey));

        expect(binToHex(wrong.sourceOutput.lockingBytecode)).not.toBe(REAL_LOCK);
    });

    it('refuses a voucher too small to claim', () => {
        expect(() => prepareClaim({ transactionHash: 'ef'.repeat(32), outputIndex: 0, valueSatoshis: CLAIM_FEE_SATOSHIS + 100n }, REAL_CODE, walletLockingBytecode(publicKey))).toThrow();
    });
});
