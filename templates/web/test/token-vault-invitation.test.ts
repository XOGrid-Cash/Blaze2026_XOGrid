/**
 * Token Vault release invitations from the web tool. The invitation is unsigned (the owner's wallet signs it), so these
 * tests sign the exact transaction XO builds from it with a test owner key and run it in the VM.
 */
import { binToHex, hexToBin, type Output } from '@bitauth/libauth';
import { deserializeInvitation } from '@xo-cash/utils';
import { describe, expect, it } from 'vitest';
import type { UnspentCoin } from '../src/lib/electrum';
import type { Network } from '../src/lib/invitation';
import { encodeVaultState, planRelease, readVaultRecord, readVaultState, tokenVault, type VaultRecord } from '../src/lib/token-vault';
import { publicKeyOf, verifyRelease, type Coin, type Owner } from '../../token-vault/test/vault';

const OWNER: Owner = { privateKey: new Uint8Array(32).fill(9), halvingLength: 100n };
const RECORD: VaultRecord = { ownerPublicKey: binToHex(publicKeyOf(OWNER)), halvingLength: OWNER.halvingLength };
const TOKEN = 'ab'.repeat(32);
const STATE_CATEGORY = 'cd'.repeat(32);
const VAULT_TRANSACTION = 'ef'.repeat(32);
const FEE_TRANSACTION = '12'.repeat(32);
const NETWORKS: Network[] = ['chipnet', 'mainnet'];

const state = { releaseHeight: 1000n, halvingHeight: 1000n, reward: 1000n };
const vaultCoins = (tokens: bigint): UnspentCoin[] => [
    { transactionHash: VAULT_TRANSACTION, outputIndex: 1, valueSatoshis: 1000n, height: 990, hasTokens: true, token: { category: TOKEN, amount: tokens } },
    {
        transactionHash: VAULT_TRANSACTION,
        outputIndex: 2,
        valueSatoshis: 1000n,
        height: 990,
        hasTokens: true,
        token: { category: STATE_CATEGORY, amount: 0n, nft: { capability: 'none', commitment: binToHex(encodeVaultState(state)) } },
    },
];
const feeCoin: UnspentCoin = { transactionHash: FEE_TRANSACTION, outputIndex: 0, valueSatoshis: 5000n, height: 995, hasTokens: false };

/** Signs the transaction XO built, as the owner's wallet would, and runs it in the VM. */
function signAndVerify(transaction: { locktime: number; outputs: Output[] }, tokens: bigint, blockHeight: bigint): true | string {
    const [tokenCoin, stateCoin] = vaultCoins(tokens);
    const coins: Coin[] = [
        { transactionHash: hexToBin(tokenCoin!.transactionHash), outputIndex: 1, valueSatoshis: 1000n, token: { category: hexToBin(TOKEN), amount: tokens }, unlock: { vault: OWNER, blockHeight } },
        {
            transactionHash: hexToBin(stateCoin!.transactionHash),
            outputIndex: 2,
            valueSatoshis: 1000n,
            token: { category: hexToBin(STATE_CATEGORY), amount: 0n, nft: { capability: 'none', commitment: encodeVaultState(state) } },
            unlock: { vault: OWNER, blockHeight },
        },
        { transactionHash: hexToBin(FEE_TRANSACTION), outputIndex: 0, valueSatoshis: 5000n, unlock: { owner: OWNER } },
    ];

    return verifyRelease(coins, transaction.outputs, transaction.locktime);
}

describe('Token Vault invitations (web tool)', () => {
    it('reads the vault record and the state commitment', () => {
        const { vaultLockingBytecode, ownerLockingBytecode } = tokenVault.vaultScripts(RECORD);
        const record = hexToBin(`6a0454564c5421${RECORD.ownerPublicKey}0164`);

        expect(readVaultRecord(record)).toEqual(RECORD);
        expect(readVaultRecord(hexToBin(`6a0454564c5421${RECORD.ownerPublicKey}53`))).toEqual({ ...RECORD, halvingLength: 3n });
        expect(readVaultRecord(hexToBin('6a0454564c54'))).toBeUndefined();
        expect(readVaultState(binToHex(encodeVaultState({ releaseHeight: 857_132n, halvingHeight: 857_000n, reward: 250_000_000_000n })))).toEqual({
            releaseHeight: 857_132n,
            halvingHeight: 857_000n,
            reward: 250_000_000_000n,
        });
        expect(binToHex(vaultLockingBytecode)).toMatch(/^aa20[0-9a-f]{64}87$/);
        expect(binToHex(ownerLockingBytecode)).toMatch(/^76a914[0-9a-f]{40}88ac$/);
        expect(tokenVault.readVaultCoins(vaultCoins(5000n))?.state).toEqual(state);
    });

    it('lists only plain BCH coins at output 0 as fee coins', () => {
        const coins: UnspentCoin[] = [feeCoin, { ...feeCoin, outputIndex: 1 }, { ...feeCoin, hasTokens: true, token: { category: TOKEN, amount: 1n } }, { ...feeCoin, valueSatoshis: 100n }];

        expect(tokenVault.listFeeCoins(coins)).toEqual([feeCoin]);
    });

    for (const network of NETWORKS) {
        it.each([
            ['a release', 1_000_000n, 1049n, 'release'],
            ['a release up to a halving', 1_000_000n, 1150n, 'release'],
            ['the final release', 30_000n, 1049n, 'releaseFinal'],
        ])(`builds %s on ${network} that the owner can sign and the VM accepts`, (_label, tokens, blockHeight, action) => {
            const vault = tokenVault.readVaultCoins(vaultCoins(tokens))!;
            const result = tokenVault.buildReleaseInvitation({ network, record: RECORD, vault, feeCoin, blockHeight, tipHeight: 2000 });
            const plan = planRelease({ tokens, state, halvingLength: RECORD.halvingLength }, blockHeight);
            const invitation = deserializeInvitation(result.serializedInvitation);

            expect(result.actionIdentifier).toBe(action);
            expect(invitation.actionIdentifier).toBe(action);
            expect(result.transaction.locktime).toBe(Number(blockHeight));
            expect(result.transaction.outputs[0]!.token?.amount).toBe(plan.amount);
            expect(signAndVerify(result.transaction, tokens, blockHeight)).toBe(true);
        });
    }

    it('refuses a release height not after the last release or not yet mined, and a bad fee coin', () => {
        const vault = tokenVault.readVaultCoins(vaultCoins(1_000_000n))!;
        const build = (blockHeight: bigint, coin = feeCoin) => () => tokenVault.buildReleaseInvitation({ network: 'chipnet', record: RECORD, vault, feeCoin: coin, blockHeight, tipHeight: 1100 });

        expect(build(1000n)).toThrow(/after the last release/);
        expect(build(1101n)).toThrow(/has been mined/);
        expect(build(1049n, { ...feeCoin, outputIndex: 1 })).toThrow(/output 0/);
    });

    it('builds a fee coin invitation paying the owner’s address at output 0', () => {
        const result = tokenVault.buildAddFeeCoinInvitation({ network: 'chipnet', record: RECORD });
        const invitation = deserializeInvitation(result.serializedInvitation);
        const output = invitation.commits.flatMap((commit) => commit.data.outputs ?? [])[0]!;

        expect(invitation.actionIdentifier).toBe('addFeeCoin');
        expect(output.transactionIndex).toBe(0);
        expect(binToHex(output.lockingBytecode!)).toBe(binToHex(tokenVault.vaultScripts(RECORD).ownerLockingBytecode));
    });
});
