/**
 * TokenVault_Release.cash (unchanged from upstream) in Libauth's BCH 2026 VM, with real token data and signed vault,
 * owner and fee coins. The contract is compiled into an independent Libauth wallet template (test/vault.ts), not the XO
 * template, so these tests pin down what the contract itself accepts.
 */
import { hexToBin, type Output } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { ownerLock, releaseOf, stateCommitment, vaultLock, verifyRelease, type Coin, type Owner } from './vault.js';

const OWNER: Owner = { privateKey: new Uint8Array(32).fill(7), halvingLength: 100n };
const STRANGER: Owner = { privateKey: new Uint8Array(32).fill(8), halvingLength: 100n };
const TOKEN = hexToBin('11'.repeat(32));
const VAULT_TRANSACTION = hexToBin('22'.repeat(32));
const FEE_TRANSACTION = hexToBin('33'.repeat(32));
const OTHER_TRANSACTION = hexToBin('44'.repeat(32));
const STATE_CATEGORY = hexToBin('55'.repeat(32));

const STATE = { releaseHeight: 1000n, halvingHeight: 1000n, reward: 1000n };
const VAULT_TOKENS = 1_000_000n;
const FEE_COIN = 5000n;
const MINER_FEE = 2000n;

const vaultCoins = (blockHeight: bigint, options: { tokens?: bigint; signer?: Owner; stateTransaction?: Uint8Array } = {}): Coin[] => [
    {
        transactionHash: VAULT_TRANSACTION,
        outputIndex: 1,
        valueSatoshis: 1000n,
        token: { category: TOKEN, amount: options.tokens ?? VAULT_TOKENS },
        unlock: { vault: OWNER, blockHeight, ...(options.signer ? { signer: options.signer } : {}) },
    },
    {
        transactionHash: options.stateTransaction ?? VAULT_TRANSACTION,
        outputIndex: 2,
        valueSatoshis: 1000n,
        token: { category: STATE_CATEGORY, amount: 0n, nft: { capability: 'none', commitment: stateCommitment(STATE.releaseHeight, STATE.halvingHeight, STATE.reward) } },
        unlock: { vault: OWNER, blockHeight, ...(options.signer ? { signer: options.signer } : {}) },
    },
];
const feeCoin = (token?: Output['token']): Coin => ({
    transactionHash: FEE_TRANSACTION,
    outputIndex: 0,
    valueSatoshis: FEE_COIN,
    ...(token ? { token } : {}),
    unlock: { owner: OWNER },
});

/** The outputs a release must make: tokens to the owner, the rest back to the vault, the new state NFT. */
function releaseOutputs(blockHeight: bigint, tokens = VAULT_TOKENS): Output[] {
    const next = releaseOf(STATE, blockHeight, OWNER.halvingLength);

    return [
        { lockingBytecode: ownerLock(OWNER), valueSatoshis: FEE_COIN - MINER_FEE, token: { category: TOKEN, amount: next.amount } },
        { lockingBytecode: vaultLock(OWNER), valueSatoshis: 1000n, token: { category: TOKEN, amount: tokens - next.amount } },
        {
            lockingBytecode: vaultLock(OWNER),
            valueSatoshis: 1000n,
            token: { category: FEE_TRANSACTION, amount: 0n, nft: { capability: 'none', commitment: stateCommitment(next.nextReleaseHeight, next.nextHalvingHeight, next.nextReward) } },
        },
    ];
}

/** A rejection must come from the VM evaluating the spend, never from a mistake in building it. */
function expectRejected(result: true | string): void {
    expect(result).not.toBe(true);
    expect(result).not.toMatch(/^Transaction generation failed/);
}

const release = (blockHeight: bigint, outputs = releaseOutputs(blockHeight), coins = [...vaultCoins(blockHeight), feeCoin()], locktime = Number(blockHeight)) =>
    verifyRelease(coins, outputs, locktime);

describe('TokenVault_Release.release', () => {
    it('releases one reward per block mined since the last release, to the owner', () => {
        expect(releaseOf(STATE, 1049n, OWNER.halvingLength).amount).toBe(50_000n);
        expect(release(1049n)).toBe(true);
    });

    it('stops a release at the halving, and halves the reward', () => {
        const next = releaseOf(STATE, 1150n, OWNER.halvingLength);

        expect(next).toEqual({ amount: 100_000n, nextReleaseHeight: 1100n, nextHalvingHeight: 1100n, nextReward: 500n });
        expect(release(1150n)).toBe(true);
    });

    it('rejects releasing past a halving at the old reward', () => {
        const outputs = releaseOutputs(1150n);
        const fullAmount = (1150n - STATE.releaseHeight + 1n) * STATE.reward;

        outputs[0] = { ...outputs[0]!, token: { category: TOKEN, amount: fullAmount } };
        outputs[1] = { ...outputs[1]!, token: { category: TOKEN, amount: VAULT_TOKENS - fullAmount } };
        expectRejected(release(1150n, outputs));
    });

    it('pays out everything in one output when the release would empty the vault', () => {
        const tokens = 30_000n;
        const outputs: Output[] = [{ lockingBytecode: ownerLock(OWNER), valueSatoshis: 2000n + FEE_COIN - MINER_FEE, token: { category: TOKEN, amount: tokens } }];

        expect(release(1049n, outputs, [...vaultCoins(1049n, { tokens }), feeCoin()])).toBe(true);
    });

    it('rejects a final release that leaves an extra output', () => {
        const tokens = 30_000n;
        const outputs: Output[] = [
            { lockingBytecode: ownerLock(OWNER), valueSatoshis: 3000n, token: { category: TOKEN, amount: tokens } },
            { lockingBytecode: ownerLock(OWNER), valueSatoshis: 2000n },
        ];

        expectRejected(release(1049n, outputs, [...vaultCoins(1049n, { tokens }), feeCoin()]));
    });

    it('rejects a signature from any key but the owner’s', () => {
        expectRejected(release(1049n, releaseOutputs(1049n), [...vaultCoins(1049n, { signer: STRANGER }), feeCoin()]));
    });

    it('rejects releasing one token more than allowed', () => {
        const outputs = releaseOutputs(1049n);
        const amount = (outputs[0]!.token!.amount ?? 0n) + 1n;

        outputs[0] = { ...outputs[0]!, token: { category: TOKEN, amount } };
        outputs[1] = { ...outputs[1]!, token: { category: TOKEN, amount: VAULT_TOKENS - amount } };
        expectRejected(release(1049n, outputs));
    });

    it('rejects releasing to anyone but the owner', () => {
        const outputs = releaseOutputs(1049n);

        outputs[0] = { ...outputs[0]!, lockingBytecode: ownerLock(STRANGER) };
        expectRejected(release(1049n, outputs));
    });

    it('rejects a release height above the transaction’s locktime', () => {
        expectRejected(release(1049n, releaseOutputs(1049n), undefined, 1048));
    });

    it('rejects a wrong next state', () => {
        const outputs = releaseOutputs(1049n);

        outputs[2] = { ...outputs[2]!, token: { category: FEE_TRANSACTION, amount: 0n, nft: { capability: 'none', commitment: stateCommitment(1049n, 1000n, 2000n) } } };
        expectRejected(release(1049n, outputs));
    });

    it('rejects a fee coin that carries tokens', () => {
        expectRejected(release(1049n, releaseOutputs(1049n), [...vaultCoins(1049n), feeCoin({ category: OTHER_TRANSACTION, amount: 1n })]));
    });

    it('rejects a state NFT from another transaction than the tokens', () => {
        expectRejected(release(1049n, releaseOutputs(1049n), [...vaultCoins(1049n, { stateTransaction: OTHER_TRANSACTION }), feeCoin()]));
    });

    it('rejects an extra output', () => {
        expectRejected(release(1049n, [...releaseOutputs(1049n), { lockingBytecode: ownerLock(OWNER), valueSatoshis: 1000n }]));
    });
});
