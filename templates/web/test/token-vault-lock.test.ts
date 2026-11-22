/**
 * Token Vault lock invitations from the web tool. The page picks the coins and sets the vault's settings; the owner's
 * wallet adds the vault key, the outputs and the change. These tests complete the page's invitation the way the wallet
 * does (with test keys) and run the lock in the VM.
 */
import { binToHex, encodeDataPush, bigIntToVmNumber, hexToBin, type Output } from '@bitauth/libauth';
import { deserializeInvitation } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';
import type { UnspentCoin } from '../src/lib/electrum';
import { encodeVaultState, readVaultRecord, scheduleOf, tokenVault } from '../src/lib/token-vault';
import { ownerLock, publicKeyOf, vaultLock, verifyRelease, type Coin, type Owner } from '../../token-vault/test/vault';

// The wallet's address the user pastes (its key signs the coins), and the vault key the wallet generates.
const WALLET: Owner = { privateKey: new Uint8Array(32).fill(21), halvingLength: 0n };
const VAULT_KEY: Owner = { privateKey: new Uint8Array(32).fill(22), halvingLength: 210n };
const TOKEN = 'ab'.repeat(32);
const OTHER_TOKEN = 'cd'.repeat(32);

const coin = (transactionHash: string, outputIndex: number, valueSatoshis: bigint, tokens?: bigint, category = TOKEN): UnspentCoin => ({
    transactionHash,
    outputIndex,
    valueSatoshis,
    height: 100,
    hasTokens: tokens !== undefined,
    ...(tokens !== undefined ? { token: { category, amount: tokens } } : {}),
});

const ADDRESS_COINS: UnspentCoin[] = [
    coin('11'.repeat(32), 1, 800n, 600_000n),
    coin('12'.repeat(32), 2, 800n, 50_000n),
    coin('13'.repeat(32), 0, 9000n),
    coin('14'.repeat(32), 1, 2000n),
    coin('15'.repeat(32), 0, 1000n, 7n, OTHER_TOKEN),
];

describe('Token Vault schedule', () => {
    it('lists each era until the locked amount is used up', () => {
        const eras = scheduleOf({ lockAmount: 1_000_000n, reward: 1000n, halvingLength: 210n, startHeight: 900_000n });

        expect(eras[0]).toEqual({ era: 1, fromHeight: 900_000n, toHeight: 900_209n, reward: 1000n, tokens: 210_000n, released: 210_000n });
        expect(eras[1]).toMatchObject({ era: 2, fromHeight: 900_210n, reward: 500n, tokens: 105_000n });
        expect(eras.at(-1)!.released).toBe(1_000_000n);
        // The reward never drops below 1.
        expect(eras.at(-1)!.reward).toBe(1n);
    });

    it('ends the last era at the block that empties the vault', () => {
        const eras = scheduleOf({ lockAmount: 2500n, reward: 1000n, halvingLength: 10n, startHeight: 0n });

        expect(eras).toEqual([{ era: 1, fromHeight: 0n, toHeight: 2n, reward: 1000n, tokens: 2500n, released: 2500n }]);
    });
});

describe('Token Vault lock invitations (web tool)', () => {
    it('picks the token coins, a coin at output 0 for the state NFT, and enough BCH', () => {
        const plan = tokenVault.planLock({ coins: ADDRESS_COINS, tokenCategory: TOKEN, lockAmount: 500_000n, feeCoinSatoshis: 5000n });

        expect(plan.tokenCoins.map((spent) => spent.transactionHash)).toEqual(['11'.repeat(32)]);
        expect(plan.genesisCoin.transactionHash).toBe('13'.repeat(32));
        expect(plan.inputs[0]).toBe(plan.genesisCoin);
        expect(plan.tokenChange).toBe(100_000n);
        expect(plan.inputSatoshis).toBeGreaterThanOrEqual(plan.paidSatoshis + 2000n);
        // Coins of another token are never spent.
        expect(plan.inputs.some((spent) => spent.token?.category === OTHER_TOKEN)).toBe(false);
    });

    it('explains what is missing: tokens, a coin at output 0, or BCH', () => {
        expect(() => tokenVault.planLock({ coins: ADDRESS_COINS, tokenCategory: TOKEN, lockAmount: 700_000n, feeCoinSatoshis: 5000n })).toThrow(/holds 650,000/);
        expect(() =>
            tokenVault.planLock({ coins: ADDRESS_COINS.filter((spent) => spent.outputIndex !== 0), tokenCategory: TOKEN, lockAmount: 1000n, feeCoinSatoshis: 5000n }),
        ).toThrow(/output 0/);
        expect(() => tokenVault.planLock({ coins: ADDRESS_COINS.slice(0, 2).concat(coin('16'.repeat(32), 0, 1000n)), tokenCategory: TOKEN, lockAmount: 1000n, feeCoinSatoshis: 5000n })).toThrow(
            /Send more BCH/,
        );
    });

    it('refuses settings the contract or the template would refuse', () => {
        const build = (overrides: Partial<Parameters<typeof tokenVault.buildLockInvitation>[0]>) => () =>
            tokenVault.buildLockInvitation({ network: 'chipnet', coins: ADDRESS_COINS, tokenCategory: TOKEN, lockAmount: 1000n, reward: 10n, halvingLength: 210n, startHeight: 100n, ...overrides });

        expect(build({ reward: 0n })).toThrow(/reward/);
        expect(build({ reward: 1001n })).toThrow(/reward/);
        expect(build({ halvingLength: 0n })).toThrow(/halving length/);
        expect(build({ startHeight: -1n })).toThrow(/start block/);
        expect(build({ tokenCategory: '' })).toThrow(/Pick the token/);
        expect(build({ feeCoinSatoshis: 100n })).toThrow(/fee coin/);
    });

    it('builds a lock the owner’s wallet completes into a transaction the VM accepts', () => {
        const result = tokenVault.buildLockInvitation({
            network: 'chipnet',
            coins: ADDRESS_COINS,
            tokenCategory: TOKEN,
            lockAmount: 500_000n,
            reward: 1000n,
            halvingLength: VAULT_KEY.halvingLength,
            startHeight: 900_000n,
        });
        const invitation = deserializeInvitation(result.serializedInvitation);
        const variables = Object.fromEntries(invitation.commits.flatMap((commit) => commit.data.variables ?? []).map((variable) => [variable.variableIdentifier, variable.value]));
        const inputs = invitation.commits.flatMap((commit) => commit.data.inputs ?? []);

        expect(invitation.actionIdentifier).toBe('lock');
        expect(variables).toMatchObject({ lockTokenCategory: TOKEN, lockAmount: 500_000n, reward: 1000n, halvingLength: 210n, startHeight: 900_000n, stateCategory: '13'.repeat(32) });
        expect(inputs.map((input) => `${binToHex(input.outpointTransactionHash!)}:${input.outpointIndex}`)).toEqual(result.plan.inputs.map((spent) => `${spent.transactionHash}:${spent.outputIndex}`));
        expect(result.schedule[0]?.tokens).toBe(210_000n);


        // The page adds no outputs: they all need the vault key, which only the wallet has.
        expect(invitation.commits.flatMap((commit) => commit.data.outputs ?? [])).toEqual([]);
        const stateCommitment = encodeVaultState({ releaseHeight: 900_000n, halvingHeight: 900_000n, reward: 1000n });

        // The wallet's part: the vault outputs for its new key, then change, then signatures on every coin.
        const feeCoin = variables.feeCoinSatoshis as bigint;
        const record = hexToBin(`6a0454564c5421${binToHex(publicKeyOf(VAULT_KEY))}${binToHex(encodeDataPush(bigIntToVmNumber(VAULT_KEY.halvingLength)))}`);
        const outputs: Output[] = [
            { lockingBytecode: ownerLock(VAULT_KEY), valueSatoshis: feeCoin },
            { lockingBytecode: vaultLock(VAULT_KEY), valueSatoshis: tokenVault.VAULT_COIN, token: { category: hexToBin(TOKEN), amount: 500_000n } },
            {
                lockingBytecode: vaultLock(VAULT_KEY),
                valueSatoshis: tokenVault.VAULT_COIN,
                token: { category: hexToBin('13'.repeat(32)), amount: 0n, nft: { capability: 'none', commitment: stateCommitment } },
            },
            { lockingBytecode: record, valueSatoshis: 0n },
            { lockingBytecode: ownerLock(WALLET), valueSatoshis: 800n, token: { category: hexToBin(TOKEN), amount: result.plan.tokenChange } },
        ];
        const change = result.plan.inputSatoshis - outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n) - 1000n;

        outputs.push({ lockingBytecode: ownerLock(WALLET), valueSatoshis: change });

        const coins: Coin[] = result.plan.inputs.map((spent) => ({
            transactionHash: hexToBin(spent.transactionHash),
            outputIndex: spent.outputIndex,
            valueSatoshis: spent.valueSatoshis,
            ...(spent.token ? { token: { category: hexToBin(spent.token.category), amount: spent.token.amount } } : {}),
            unlock: { owner: WALLET },
            sequenceNumber: 0xffffffff,
        }));

        expect(change).toBeGreaterThanOrEqual(546n);
        expect(readVaultRecord(record)).toEqual({ ownerPublicKey: binToHex(publicKeyOf(VAULT_KEY)), halvingLength: 210n });
        expect(verifyRelease(coins, outputs, 0)).toBe(true);
    });

    it('recognises a vault whose state NFT has no state, so the page can say it can’t be released', () => {
        const lock = '21'.repeat(32);
        const vaultCoins: UnspentCoin[] = [
            coin(lock, 1, 1000n, 100n),
            { ...coin(lock, 2, 1000n, 0n, '22'.repeat(32)), token: { category: '22'.repeat(32), amount: 0n, nft: { capability: 'none', commitment: '' } } },
        ];

        expect(tokenVault.readVaultCoins(vaultCoins)).toBeUndefined();
        expect(tokenVault.readUnreadableVault(vaultCoins)).toMatchObject({ commitmentHex: '', tokenCoin: { outputIndex: 1, token: { amount: 100n } } });

        const healthy = vaultCoins.map((spent) =>
            spent.token?.nft ? { ...spent, token: { ...spent.token, nft: { capability: 'none' as const, commitment: binToHex(encodeVaultState({ releaseHeight: 1n, halvingHeight: 1n, reward: 1n })) } } } : spent,
        );

        expect(tokenVault.readVaultCoins(healthy)).toBeDefined();
        expect(tokenVault.readUnreadableVault(healthy)).toBeUndefined();
    });
});
