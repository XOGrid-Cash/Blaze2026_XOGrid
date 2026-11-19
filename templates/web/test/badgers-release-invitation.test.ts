import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bigIntToVmNumber, binToHex, hexToBin } from '@bitauth/libauth';
import { deserializeInvitation as parseInvitation } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';
import {
    BADGER_CATEGORY,
    RELEASE_FEE_SATOSHIS,
    badgerAddress,
    badgerLockingBytecode,
    badgersStakeTemplateIdentifier,
    blocksUntilRelease,
    buildBadgerReleaseInvitation,
    p2pkhAddress,
    readStakeLock,
    type StakeLock,
} from '../src/lib/badgers-stake';
import type { UnspentCoin } from '../src/lib/electrum';
import { InvitationCheckError } from '../src/lib/invitation';

const LOCK_HASH = '3d19dafe49cb88a5ee4a9f4a2b62a1c63d05f7e6b2b0c3d2f1a0b9c8d7e6f5a4';
const STAKER_HASH = '00112233445566778899aabbccddeeff00112233';
const LE = (blocks: number): string => `${(blocks & 0xff).toString(16).padStart(2, '0')}${(blocks >> 8).toString(16).padStart(2, '0')}`;
const commitmentFor = (blocks: number, hash = STAKER_HASH): string => `${hash}${'00'.repeat(18)}${LE(blocks)}`;

const coinFor = (overrides: Partial<UnspentCoin> = {}, commitment = commitmentFor(144), capability: 'none' | 'mutable' | 'minting' = 'mutable'): UnspentCoin => ({
    transactionHash: LOCK_HASH,
    outputIndex: 1,
    valueSatoshis: 100_000_000n,
    height: 900_000,
    hasTokens: true,
    token: { category: BADGER_CATEGORY, amount: 144n, nft: { capability, commitment } },
    ...overrides,
});

const lockOf = (overrides: Partial<UnspentCoin> = {}): StakeLock => {
    const lock = readStakeLock(coinFor(overrides), 'mainnet');

    if (!lock) {
        throw new Error('test lock was not recognised');
    }

    return lock;
};

describe('Badgers Stake release invitations (web tool)', () => {
    it('uses the committed template and the live contract address', () => {
        const readme = readFileSync(join(import.meta.dirname, '..', '..', 'badgers-stake', 'README.md'), 'utf8');

        expect(readme).toContain(badgersStakeTemplateIdentifier);
        expect(readme).toContain(badgerAddress('mainnet'));
        expect(readme).toContain(BADGER_CATEGORY);
        expect(binToHex(badgerLockingBytecode)).toMatch(/^aa20[0-9a-f]{64}87$/);
        expect(RELEASE_FEE_SATOSHIS).toBe(1000n);
    });

    describe('reading coins at the contract address', () => {
        it('reads a lock: staker key hash, stake length (2 bytes, little endian), reward and amount', () => {
            const lock = lockOf();

            expect(lock.stakerPublicKeyHash).toBe(STAKER_HASH);
            expect(lock.stakeBlocks).toBe(144);
            expect(lock.rewardTokens).toBe(144n);
            expect(lock.lockSatoshis).toBe(100_000_000n);
            expect(lock.stakerAddress).toBe(p2pkhAddress(STAKER_HASH, 'mainnet'));
            expect(lock.stakerAddress.startsWith('bitcoincash:q')).toBe(true);
            expect(readStakeLock(coinFor({}, commitmentFor(1000)), 'mainnet')?.stakeBlocks).toBe(1000);
            expect(readStakeLock(coinFor({}, commitmentFor(32767)), 'mainnet')?.stakeBlocks).toBe(32767);
        });

        it('ignores the masterBadger, other categories, bad commitments and plain coins', () => {
            expect(readStakeLock(coinFor({}, commitmentFor(144), 'minting'), 'mainnet')).toBeUndefined();
            expect(readStakeLock(coinFor({}, commitmentFor(144), 'none'), 'mainnet')).toBeUndefined();
            expect(readStakeLock(coinFor({ token: { category: 'ab'.repeat(32), amount: 1n, nft: { capability: 'mutable', commitment: commitmentFor(144) } } }), 'mainnet')).toBeUndefined();
            expect(readStakeLock(coinFor({}, commitmentFor(144).slice(2)), 'mainnet')).toBeUndefined();
            expect(readStakeLock(coinFor({}, `${STAKER_HASH}${'01'.repeat(18)}9000`), 'mainnet')).toBeUndefined();
            expect(readStakeLock(coinFor({ token: undefined, hasTokens: false }), 'mainnet')).toBeUndefined();
        });

        it('counts the blocks left before a release', () => {
            const lock = lockOf({ height: 1000 });

            // Confirmations are tip - height + 1, and a lock of 144 blocks needs 144 of them.
            expect(blocksUntilRelease(lock, 1000 + 141)).toBe(2);
            expect(blocksUntilRelease(lock, 1000 + 142)).toBe(1);
            expect(blocksUntilRelease(lock, 1000 + 143)).toBe(0);
            expect(blocksUntilRelease(lock, 1000 + 500)).toBe(0);
            expect(blocksUntilRelease(lockOf({ height: 0 }), 1_000_000)).toBe(144);
        });
    });

    it('builds a release that XO validates and the VM accepts, with every output going to the staker', () => {
        const lock = lockOf();
        const result = buildBadgerReleaseInvitation('mainnet', lock, 900_000 + 1000);
        const { inputs, outputs } = result.transaction;

        expect(inputs).toHaveLength(1);
        expect(outputs).toHaveLength(3);
        expect(binToHex(inputs[0]!.outpointTransactionHash)).toBe(LOCK_HASH);
        expect(inputs[0]!.outpointIndex).toBe(1);
        expect(inputs[0]!.sequenceNumber).toBe(144);
        expect(inputs[0]!.unlockingBytecode[0]).toBe(0x51);
        // The function selector, then the 461-byte contract as a data push.
        expect(inputs[0]!.unlockingBytecode.length).toBeGreaterThan(461);
        expect(inputs[0]!.unlockingBytecode.length).toBeLessThan(480);

        const stakerScript = `76a914${STAKER_HASH}88ac`;

        expect(outputs.map((output) => binToHex(output.lockingBytecode))).toEqual([stakerScript, stakerScript, stakerScript]);
        expect(outputs.map((output) => output.valueSatoshis)).toEqual([1000n, 1000n, 100_000_000n - 3000n]);
        expect(outputs[0]!.token?.amount).toBe(144n);
        expect(binToHex(outputs[0]!.token!.category)).toBe(BADGER_CATEGORY);
        expect(outputs[0]!.token?.nft).toBeUndefined();
        expect(outputs[1]!.token?.amount).toBe(0n);
        expect(outputs[1]!.token?.nft?.capability).toBe('none');
        expect(binToHex(outputs[1]!.token!.nft!.commitment)).toBe(`0000${binToHex(bigIntToVmNumber(144n))}`);
        expect(outputs[2]!.token).toBeUndefined();

        const spent = outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);

        expect(100_000_000n - spent).toBe(RELEASE_FEE_SATOSHIS);
        expect(result.feeSatoshis).toBe(RELEASE_FEE_SATOSHIS);
        expect(result.releasedSatoshis).toBe(100_000_000n - 3000n);
        expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('records the reward on the Honey NFT for different rewards and stake lengths', () => {
        for (const [blocks, reward] of [
            [1, 1n],
            [255, 300n],
            [256, 1000n],
            [32767, 5_000_000n],
        ] as const) {
            const lock = readStakeLock(coinFor({ token: { category: BADGER_CATEGORY, amount: reward, nft: { capability: 'mutable', commitment: commitmentFor(blocks) } } }), 'mainnet')!;
            const result = buildBadgerReleaseInvitation('mainnet', lock);

            expect(result.transaction.inputs[0]!.sequenceNumber).toBe(blocks);
            expect(binToHex(result.transaction.outputs[1]!.token!.nft!.commitment)).toBe(`0000${binToHex(bigIntToVmNumber(reward))}`);
        }
    });

    it('copies an invitation that parses back with the lock, its unlocking bytecode and a fresh signer each time', () => {
        const lock = lockOf();
        const first = buildBadgerReleaseInvitation('mainnet', lock);
        const second = buildBadgerReleaseInvitation('mainnet', lock);
        const parsed = parseInvitation(first.serializedInvitation);

        expect(parsed.invitationIdentifier).toBe(first.invitationIdentifier);
        expect(first.serializedInvitation).not.toBe(second.serializedInvitation);
        expect(first.transactionHash).toBe(second.transactionHash);
        expect(first.serializedInvitation).toContain(STAKER_HASH);
    });

    it('lets the VM refuse a release that does not meet the lock (the check is real)', () => {
        // The commitment says 144 blocks, but this lock object claims 100: the input would carry sequence 100, and the
        // contract requires at least 144.
        const lie: StakeLock = { ...lockOf(), stakeBlocks: 100 };

        expect(() => buildBadgerReleaseInvitation('mainnet', lie)).toThrow(InvitationCheckError);
    });

    it('refuses a lock that is not ready yet, bad coin ids and locks too small to release', () => {
        const lock = lockOf({ height: 1000 });

        expect(() => buildBadgerReleaseInvitation('mainnet', lock, 1010)).toThrow(/not ready/);
        expect(() => buildBadgerReleaseInvitation('mainnet', { ...lock, transactionHash: 'abc' })).toThrow(/transaction id/);
        expect(() => buildBadgerReleaseInvitation('mainnet', { ...lock, lockSatoshis: 3000n })).toThrow(/too little/);
        expect(() => buildBadgerReleaseInvitation('mainnet', { ...lock, stakeBlocks: 0 })).toThrow(/stake length/);
    });

    it('builds the same on chipnet, which only changes the address prefix', () => {
        const result = buildBadgerReleaseInvitation('chipnet', readStakeLock(coinFor(), 'chipnet')!);

        expect(result.transaction.outputs).toHaveLength(3);
        expect(result.stakerAddress.startsWith('bchtest:q')).toBe(true);
        expect(hexToBin(STAKER_HASH).length).toBe(20);
    });
});
