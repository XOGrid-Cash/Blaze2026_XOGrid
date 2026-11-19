/**
 * Badgers Stake release invitations (see badgers-stake/README.md).
 *
 * When a stake's lock period is over, anyone can release it: the contract's `unlock()` takes no signature and sends
 * everything to the staker who made the lock. So the invitation carries everything — the lock coin as input, its
 * unlocking bytecode and the three outputs — and the importing XO wallet only broadcasts it.
 *   input 0   the lock NFT (mutable, commitment: staker key hash, 18 zero bytes, stake length in blocks)
 *   output 0  the BadgerCoins earned, 1000 sats, to the staker
 *   output 1  a "Honey" NFT receipt (commitment 0000 plus the reward), 1000 sats, to the staker
 *   output 2  the staked BCH less 3000 sats, to the staker (1000 of that difference is the miner fee)
 *
 * Staking itself needs the staker's own coin and signature, so it is made by an XO wallet from the template's `stake`
 * action, not here.
 */
import {
    bigIntToVmNumber,
    binToHex,
    cashAssemblyToBin,
    encodeDataPush,
    encodeLockingBytecodeP2pkh,
    encodeLockingBytecodeP2sh32,
    flattenBinArray,
    hash256,
    hexToBin,
    lockingBytecodeToCashAddress,
    type Output,
} from '@bitauth/libauth';
import type { InvitationInputWithSpentOutputFields } from '@xo-cash/engine';
import { generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import templateText from '../../../badgers-stake/template.json?raw';
import type { CoinToken, UnspentCoin } from './electrum';
import { finishInvitation, startInvitation, type FinishedInvitation, type Network } from './invitation';

export const badgersStakeTemplate = parseTemplate(templateText);
export const badgersStakeTemplateIdentifier = generateTemplateIdentifier(badgersStakeTemplate);

const constant = <Value>(identifier: string, type: 'bigint' | 'string'): Value => {
    const value = badgersStakeTemplate.constants?.[identifier]?.value;

    if (typeof value !== type) {
        throw new Error(`Badgers Stake template constant ${identifier} is missing.`);
    }

    return value as Value;
};

/** The masterBadger's token category (mainnet only), in the hex order Electrum and libauth use. */
export const BADGER_CATEGORY = constant<string>('badgerCategory', 'string');
const PAYOUT_DUST = constant<bigint>('payoutDustSatoshis', 'bigint');
const UNSTAKE_COST = constant<bigint>('unstakeCostSatoshis', 'bigint');

/** Satoshis the miner receives: the 3000 the contract holds back, less the two 1000-sat token outputs. */
export const RELEASE_FEE_SATOSHIS = UNSTAKE_COST - 2n * PAYOUT_DUST;

const redeemScript = (() => {
    const compiled = cashAssemblyToBin(badgersStakeTemplate.scripts.badgerBytecode as string);

    if (typeof compiled === 'string') {
        throw new Error(`BadgerStake redeem script does not compile: ${compiled}`);
    }

    return compiled;
})();

export const badgerLockingBytecode = encodeLockingBytecodeP2sh32(hash256(redeemScript));
/** P2SH32 unlocking for `unlock()`: the function selector `1`, then the redeem script push. */
export const badgerUnlockUnstakeBytecode = flattenBinArray([Uint8Array.of(0x51), encodeDataPush(redeemScript)]);

/** The token-aware address (r…) that badgers.cash shows. */
export const badgerAddress = (network: Network): string => {
    const encoded = lockingBytecodeToCashAddress({
        bytecode: badgerLockingBytecode,
        prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest',
        tokenSupport: true,
    });

    if (typeof encoded === 'string') {
        throw new Error(`BadgerStake address could not be encoded: ${encoded}`);
    }

    return encoded.address;
};

export interface StakeLock {
    transactionHash: string;
    outputIndex: number;
    lockSatoshis: bigint;
    /** The BadgerCoins the stake earned; they travel on the lock NFT and are paid out on release. */
    rewardTokens: bigint;
    stakeBlocks: number;
    stakerPublicKeyHash: string;
    stakerAddress: string;
    /** Block height of the lock, or 0 while unconfirmed. */
    height: number;
    commitment: string;
}

const COMMITMENT_HEX_LENGTH = 80;
const ZERO_PADDING = '00'.repeat(18);

/** The staker's own address for a lock, as it appears in wallets. */
export function p2pkhAddress(publicKeyHash: string, network: Network): string {
    const encoded = lockingBytecodeToCashAddress({
        bytecode: encodeLockingBytecodeP2pkh(hexToBin(publicKeyHash)),
        prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest',
    });

    if (typeof encoded === 'string') {
        throw new Error(`Staker address could not be encoded: ${encoded}`);
    }

    return encoded.address;
}

/**
 * Reads a coin at the BadgerStake address as a stake lock, or returns undefined for anything else (the masterBadger,
 * or a coin without the badger category). A lock is a mutable NFT of the badger category whose 40-byte commitment is
 * the staker's key hash, 18 zero bytes and the stake length as 2 little-endian bytes.
 */
export function readStakeLock(coin: UnspentCoin, network: Network): StakeLock | undefined {
    const token = coin.token;

    if (!token || token.category.toLowerCase() !== BADGER_CATEGORY || token.nft?.capability !== 'mutable') {
        return undefined;
    }

    const commitment = token.nft.commitment.toLowerCase();

    if (commitment.length !== COMMITMENT_HEX_LENGTH || commitment.slice(40, 76) !== ZERO_PADDING) {
        return undefined;
    }

    const stakeBlocks = Number.parseInt(commitment.slice(78, 80) + commitment.slice(76, 78), 16);
    const stakerPublicKeyHash = commitment.slice(0, 40);

    return {
        transactionHash: coin.transactionHash,
        outputIndex: coin.outputIndex,
        lockSatoshis: coin.valueSatoshis,
        rewardTokens: token.amount,
        stakeBlocks,
        stakerPublicKeyHash,
        stakerAddress: p2pkhAddress(stakerPublicKeyHash, network),
        height: coin.height,
        commitment,
    };
}

/** Blocks still to wait before the lock can be released (0 when it can be released in the next block). */
export const blocksUntilRelease = (lock: Pick<StakeLock, 'height' | 'stakeBlocks'>, tipHeight: number): number => {
    if (lock.height <= 0) {
        return lock.stakeBlocks;
    }

    const confirmations = tipHeight - lock.height + 1;

    return Math.max(0, lock.stakeBlocks - confirmations);
};

export interface ReleaseInvitation extends FinishedInvitation {
    stakerAddress: string;
    rewardTokens: bigint;
    releasedSatoshis: bigint;
    feeSatoshis: bigint;
}

const toLibauthToken = (token: CoinToken): NonNullable<Output['token']> => ({
    category: hexToBin(token.category),
    amount: token.amount,
    ...(token.nft ? { nft: { capability: token.nft.capability, commitment: hexToBin(token.nft.commitment) } } : {}),
});

/** Builds the invitation that releases one finished stake. `lock` must come from readStakeLock. */
export function buildBadgerReleaseInvitation(network: Network, lock: StakeLock, tipHeight?: number): ReleaseInvitation {
    if (!/^[0-9a-f]{64}$/i.test(lock.transactionHash) || !Number.isInteger(lock.outputIndex) || lock.outputIndex < 0) {
        throw new Error('The lock must be a 64-character transaction id and an output index.');
    }

    if (lock.lockSatoshis < UNSTAKE_COST + 1n) {
        throw new Error('This lock holds too little BCH to release.');
    }

    if (!Number.isInteger(lock.stakeBlocks) || lock.stakeBlocks < 1 || lock.stakeBlocks > 32767) {
        throw new Error('The lock has an invalid stake length.');
    }

    // The contract's `tx.age >= stakeBlocks` is checked by the network when the transaction is mined, not by the VM
    // check below, so refuse a lock that is not ready instead of handing out an invitation that cannot be broadcast.
    if (tipHeight !== undefined && blocksUntilRelease(lock, tipHeight) > 0) {
        throw new Error(`This lock is not ready: about ${blocksUntilRelease(lock, tipHeight)} more blocks must pass before it can be released.`);
    }

    const lockToken: CoinToken = {
        category: BADGER_CATEGORY,
        amount: lock.rewardTokens,
        nft: { capability: 'mutable', commitment: lock.commitment },
    };
    const staker = encodeLockingBytecodeP2pkh(hexToBin(lock.stakerPublicKeyHash));
    const releasedSatoshis = lock.lockSatoshis - UNSTAKE_COST;
    // The Honey NFT records the reward: commitment 0000 followed by the reward as a VM number (the template's `honeyCommitment`).
    const honeyCommitment = hexToBin(`0000${binToHex(bigIntToVmNumber(lock.rewardTokens))}`);
    const category = hexToBin(BADGER_CATEGORY);
    const draft = startInvitation({ templateIdentifier: badgersStakeTemplateIdentifier, actionIdentifier: 'unstake', network });
    const lockInput: InvitationInputWithSpentOutputFields = {
        outpointTransactionHash: hexToBin(lock.transactionHash),
        outpointIndex: lock.outputIndex,
        inputIdentifier: 'lockInput',
        transactionIndex: 0,
        // The contract's `tx.age >= stakeBlocks`: a relative time lock of stakeBlocks blocks on this input.
        sequenceNumber: lock.stakeBlocks,
        valueSatoshis: lock.lockSatoshis,
        token: toLibauthToken(lockToken),
    };

    draft.commit({ roleIdentifier: 'staker' });
    const inputCommit = draft.commit({ inputs: [lockInput] });
    // Bytes variables travel as HEX text: raw bytes would compile a different script.
    draft.commit({
        variables: [
            { variableIdentifier: 'lockSatoshis', value: lock.lockSatoshis, roleIdentifier: 'staker' },
            { variableIdentifier: 'lockTokenAmount', value: lock.rewardTokens, roleIdentifier: 'staker' },
            { variableIdentifier: 'stakeBlocks', value: BigInt(lock.stakeBlocks), roleIdentifier: 'staker' },
            { variableIdentifier: 'stakerPublicKeyHash', value: lock.stakerPublicKeyHash, roleIdentifier: 'staker' },
        ],
    });
    draft.commit({
        outputs: [
            { outputIdentifier: 'badgerCoinOutput', transactionIndex: 0, valueSatoshis: PAYOUT_DUST, lockingBytecode: staker, token: { category, amount: lock.rewardTokens } },
            {
                outputIdentifier: 'honeyOutput',
                transactionIndex: 1,
                valueSatoshis: PAYOUT_DUST,
                lockingBytecode: staker,
                token: { category, amount: 0n, nft: { capability: 'none', commitment: honeyCommitment } },
            },
            { outputIdentifier: 'unstakedOutput', transactionIndex: 2, valueSatoshis: releasedSatoshis, lockingBytecode: staker },
        ],
    });
    // The input's unlocking bytecode, filled into the input commit above (XO's mergesWith).
    draft.commit({ inputs: [{ mergesWith: { commitIdentifier: inputCommit, itemIndex: 0 }, unlockingBytecode: badgerUnlockUnstakeBytecode }] });

    const finished = finishInvitation({
        draft,
        template: badgersStakeTemplate,
        actionIdentifier: 'unstake',
        network,
        sourceOutputs: [{ lockingBytecode: badgerLockingBytecode, valueSatoshis: lock.lockSatoshis, token: toLibauthToken(lockToken) }],
    });

    return {
        ...finished,
        stakerAddress: lock.stakerAddress,
        rewardTokens: lock.rewardTokens,
        releasedSatoshis,
        feeSatoshis: lock.lockSatoshis - (2n * PAYOUT_DUST + releasedSatoshis),
    };
}
