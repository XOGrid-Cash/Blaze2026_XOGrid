/**
 * Token Vault invitations (see token-vault/README.md), independent of how the template file is loaded, so the browser
 * page (token-vault.ts) and the chipnet script share one builder.
 *
 * The vault is found from its lock transaction: the template's `lock` action writes an `OP_RETURN "TVLT" <owner public
 * key> <halving length>` record there, which is everything needed to rebuild the vault's and the owner's addresses.
 *
 * A release needs the owner's signature on every input, so the invitation built here is unsigned: it holds the three
 * coins, the variables, the locktime and the outputs, and the owner's XO wallet signs and broadcasts it. Each release
 * also needs a fresh plain BCH coin at output 0 of the owner's address (the new state NFT takes its transaction hash as
 * its category); an `addFeeCoin` invitation asks the wallet to make one.
 *
 * Locking starts from the owner's own address: the page picks the token coins, a coin at output 0 (the state NFT's
 * genesis) and BCH to cover the vault, and builds a `lock` invitation with the vault's settings and those coins. The
 * owner's XO wallet then generates the vault key, adds the vault's outputs and its change, signs and broadcasts.
 */
import {
    binToHex,
    cashAssemblyToBin,
    decodeAuthenticationInstructions,
    encodeLockingBytecodeP2pkh,
    encodeLockingBytecodeP2sh32,
    hash160,
    hash256,
    hexToBin,
    lockingBytecodeToCashAddress,
    vmNumberToBigInt,
    type AuthenticationInstructionPush,
    type Output,
} from '@bitauth/libauth';
import type { InvitationInputWithSpentOutputFields } from '@xo-cash/engine';
import type { parseTemplate } from '@xo-cash/utils';
import type { CoinToken, UnspentCoin } from './electrum.js';
import { checkIncompleteInvitation, checkUnsignedInvitation, startInvitation, type Network, type UnsignedInvitation } from './invitation.js';

type Template = ReturnType<typeof parseTemplate>;

const RECORD_PREFIX = '54564c54'; // "TVLT"
const STATE_HEX_LENGTH = 48;

/** The vault's parameters: its owner's public key and its halving length. */
export interface VaultRecord {
    ownerPublicKey: string;
    halvingLength: bigint;
}

/** The decoded state NFT commitment. */
export interface VaultState {
    releaseHeight: bigint;
    halvingHeight: bigint;
    reward: bigint;
}

/** A vault's two coins, read from the chain. */
export interface VaultCoins {
    tokenCoin: UnspentCoin & { token: CoinToken };
    stateCoin: UnspentCoin & { token: CoinToken };
    state: VaultState;
}

export interface ReleasePlan {
    blockHeight: bigint;
    amount: bigint;
    tokensLeft: bigint;
    /** True when this release empties the vault: everything goes to the owner and the vault closes. */
    final: boolean;
    halving: boolean;
    next: VaultState;
}

/** Parses the template's vault record (`OP_RETURN "TVLT" <public key> <halving length>`), or returns undefined. */
export function readVaultRecord(lockingBytecode: Uint8Array): VaultRecord | undefined {
    if (lockingBytecode[0] !== 0x6a) {
        return undefined;
    }

    const instructions = decodeAuthenticationInstructions(lockingBytecode.slice(1));

    if (instructions.length !== 3 || instructions.some((instruction) => 'malformed' in instruction)) {
        return undefined;
    }

    const [prefix, publicKey, halvingLength] = instructions as AuthenticationInstructionPush[];
    // <halvingLength> is a minimal push: OP_1 to OP_16 for small numbers, data otherwise.
    const halvingBytes = halvingLength!.opcode >= 0x51 && halvingLength!.opcode <= 0x60 ? Uint8Array.of(halvingLength!.opcode - 0x50) : halvingLength!.data;
    const halving = halvingBytes ? vmNumberToBigInt(halvingBytes) : undefined;

    if (binToHex(prefix?.data ?? new Uint8Array()) !== RECORD_PREFIX || publicKey?.data?.length !== 33 || typeof halving !== 'bigint' || halving < 1n) {
        return undefined;
    }

    return { ownerPublicKey: binToHex(publicKey.data), halvingLength: halving };
}

/** Reads a little-endian, sign-and-magnitude number of 8 bytes (the contract's bytes8). */
function readBytes8(hex: string): bigint {
    const value = vmNumberToBigInt(hexToBin(hex), { requireMinimalEncoding: false, maximumVmNumberByteLength: 8 });

    if (typeof value === 'string') {
        throw new Error(`Bad state number ${hex}: ${value}`);
    }

    return value;
}

/** Decodes a state NFT commitment, or returns undefined when it is not three 8-byte numbers. */
export function readVaultState(commitmentHex: string): VaultState | undefined {
    if (commitmentHex.length !== STATE_HEX_LENGTH || !/^[0-9a-f]*$/i.test(commitmentHex)) {
        return undefined;
    }

    return { releaseHeight: readBytes8(commitmentHex.slice(0, 16)), halvingHeight: readBytes8(commitmentHex.slice(16, 32)), reward: readBytes8(commitmentHex.slice(32, 48)) };
}

/** Encodes a state as the contract's commitment: three 8-byte little-endian numbers. */
export function encodeVaultState(state: VaultState): Uint8Array {
    const bytes8 = (value: bigint): Uint8Array => {
        const bytes = new Uint8Array(8);
        let rest = value;

        for (let index = 0; index < 7; index += 1) {
            bytes[index] = Number(rest & 0xffn);
            rest >>= 8n;
        }

        if (rest > 0x7fn || value < 0n) {
            throw new Error(`State value ${value} does not fit in 8 bytes.`);
        }

        bytes[7] = Number(rest);
        return bytes;
    };

    return new Uint8Array([...bytes8(state.releaseHeight), ...bytes8(state.halvingHeight), ...bytes8(state.reward)]);
}

/** The contract's release maths: what a release up to `blockHeight` pays and the state it leaves. */
export function planRelease(vault: { tokens: bigint; state: VaultState; halvingLength: bigint }, blockHeight: bigint): ReleasePlan {
    const { state, halvingLength } = vault;
    const halving = blockHeight - state.halvingHeight + 1n >= halvingLength;
    const halvingAt = state.halvingHeight + halvingLength;
    const amount = halving ? (halvingAt - state.releaseHeight) * state.reward : (blockHeight - state.releaseHeight + 1n) * state.reward;
    const tokensLeft = vault.tokens - amount;

    return {
        blockHeight,
        amount: tokensLeft <= 0n ? vault.tokens : amount,
        tokensLeft: tokensLeft <= 0n ? 0n : tokensLeft,
        final: tokensLeft <= 0n,
        halving,
        next: halving
            ? { releaseHeight: halvingAt, halvingHeight: halvingAt, reward: state.reward / 2n > 1n ? state.reward / 2n : 1n }
            : { releaseHeight: blockHeight, halvingHeight: state.halvingHeight, reward: state.reward },
    };
}

/** One era of a vault's schedule: blocks `fromHeight` to `toHeight` release `reward` tokens each. */
export interface ScheduleEra {
    era: number;
    fromHeight: bigint;
    toHeight: bigint;
    reward: bigint;
    tokens: bigint;
    /** Tokens released by the end of this era. */
    released: bigint;
}

/**
 * The vault's schedule, era by era: each era is `halvingLength` blocks at a reward that halves (to at least 1) at the
 * next era, until the locked amount is used up. The last era may be short. At most `maximumEras` eras are listed.
 */
export function scheduleOf(parameters: { lockAmount: bigint; reward: bigint; halvingLength: bigint; startHeight: bigint }, maximumEras = 64): ScheduleEra[] {
    const { lockAmount, halvingLength, startHeight } = parameters;
    const eras: ScheduleEra[] = [];
    let reward = parameters.reward;
    let fromHeight = startHeight;
    let released = 0n;

    if (lockAmount <= 0n || reward <= 0n || halvingLength <= 0n) {
        return eras;
    }

    while (released < lockAmount && eras.length < maximumEras) {
        const left = lockAmount - released;
        // At a reward of 1 the halvings change nothing, so the rest is one last era of one token per block.
        const full = reward === 1n ? left : halvingLength * reward;
        // The last era ends when the tokens run out: the block whose reward empties the vault.
        const blocks = full >= left ? (left + reward - 1n) / reward : halvingLength;
        const tokens = full >= left ? left : full;

        released += tokens;
        eras.push({ era: eras.length + 1, fromHeight, toHeight: fromHeight + blocks - 1n, reward, tokens, released });
        fromHeight += halvingLength;
        reward = reward / 2n > 1n ? reward / 2n : 1n;
    }

    return eras;
}

/** The coins a lock spends, picked from the owner's address. */
export interface LockPlan {
    tokenCoins: UnspentCoin[];
    /** The coin at output 0 whose transaction hash becomes the state NFT's category. */
    genesisCoin: UnspentCoin;
    /** Every coin the lock spends, genesis coin first. */
    inputs: UnspentCoin[];
    inputSatoshis: bigint;
    /** Satoshis the lock pays out: the fee coin and the vault's two coins. The rest, less the miner fee, is change. */
    paidSatoshis: bigint;
    tokensAvailable: bigint;
    tokenChange: bigint;
}

/** Everything the page needs from the template file. */
export function createTokenVaultTools(template: Template, templateIdentifier: string) {
    const constant = (identifier: string): bigint => {
        const value = template.constants?.[identifier]?.value;

        if (typeof value !== 'bigint') {
            throw new Error(`Token Vault template constant ${identifier} is missing.`);
        }

        return value;
    };
    const MINER_FEE = constant('releaseMinerFeeSatoshis');
    const MINIMUM_FEE_COIN = constant('minimumFeeCoinSatoshis');
    const MAXIMUM_HEIGHT = constant('maximumHeight');
    const VAULT_COIN = constant('vaultCoinSatoshis');
    /** What a lock keeps back besides its outputs: the miner fee and the satoshis on the wallet's token change. */
    const LOCK_ALLOWANCE = 2000n;
    const vaultBytecode = template.scripts.vaultBytecode as string;

    const compile = (script: string): Uint8Array => {
        const compiled = cashAssemblyToBin(script);

        if (typeof compiled === 'string') {
            throw new Error(`Token Vault script does not compile: ${compiled}`);
        }

        return compiled;
    };

    /** The vault's and the owner's locking bytecode for a record: the template's vaultRedeem and ownerLockingBytecode. */
    function vaultScripts(record: VaultRecord): { vaultLockingBytecode: Uint8Array; ownerLockingBytecode: Uint8Array } {
        const redeem = compile(`<${record.halvingLength}> <0x${record.ownerPublicKey}> ${vaultBytecode}`);

        return {
            vaultLockingBytecode: encodeLockingBytecodeP2sh32(hash256(redeem)),
            ownerLockingBytecode: encodeLockingBytecodeP2pkh(hash160(hexToBin(record.ownerPublicKey))),
        };
    }

    const addressOf = (lockingBytecode: Uint8Array, network: Network): string => {
        const encoded = lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest', tokenSupport: true });

        if (typeof encoded === 'string') {
            throw new Error(encoded);
        }

        return encoded.address;
    };

    /** Finds the vault's token coin and state NFT among the coins at its address: a pair from the same transaction. */
    function readVaultCoins(coins: UnspentCoin[]): VaultCoins | undefined {
        for (const stateCoin of coins) {
            const state = stateCoin.token?.nft?.capability === 'none' ? readVaultState(stateCoin.token.nft.commitment) : undefined;
            const tokenCoin = coins.find(
                (coin) => coin.transactionHash === stateCoin.transactionHash && coin.token && coin.token.amount > 0n && coin.token.nft === undefined,
            );

            if (state && tokenCoin) {
                return { tokenCoin: tokenCoin as VaultCoins['tokenCoin'], stateCoin: stateCoin as VaultCoins['stateCoin'], state };
            }
        }

        return undefined;
    }

    /** Coins at the owner's address that can pay for a release: plain BCH, output 0, large enough. */
    const listFeeCoins = (coins: UnspentCoin[]): UnspentCoin[] => coins.filter((coin) => coin.outputIndex === 0 && !coin.hasTokens && coin.valueSatoshis >= MINIMUM_FEE_COIN);

    /** Builds the unsigned release invitation (or the final release, when it empties the vault). */
    function buildReleaseInvitation(parameters: {
        network: Network;
        record: VaultRecord;
        vault: VaultCoins;
        feeCoin: UnspentCoin;
        blockHeight: bigint;
        tipHeight?: number;
    }): UnsignedInvitation & { plan: ReleasePlan; actionIdentifier: 'release' | 'releaseFinal' } {
        const { network, record, vault, feeCoin, blockHeight, tipHeight } = parameters;
        const { tokenCoin, stateCoin, state } = vault;
        const plan = planRelease({ tokens: tokenCoin.token.amount, state, halvingLength: record.halvingLength }, blockHeight);
        const actionIdentifier = plan.final ? 'releaseFinal' : 'release';
        const { vaultLockingBytecode, ownerLockingBytecode } = vaultScripts(record);

        if (blockHeight <= state.releaseHeight) {
            throw new Error(`Pick a block after the last release (${state.releaseHeight}).`);
        }

        if (blockHeight > MAXIMUM_HEIGHT || (tipHeight !== undefined && blockHeight > BigInt(tipHeight))) {
            throw new Error(`Pick a block that has been mined: the tip is ${tipHeight ?? 'unknown'}.`);
        }

        if (feeCoin.outputIndex !== 0 || feeCoin.hasTokens || feeCoin.valueSatoshis < MINIMUM_FEE_COIN) {
            throw new Error(`The fee coin must be plain BCH at output 0, with at least ${MINIMUM_FEE_COIN} satoshis.`);
        }

        const tokenCategory = hexToBin(tokenCoin.token.category);
        const feeCoinCategory = hexToBin(feeCoin.transactionHash);
        const tokenOf = (amount: bigint): NonNullable<Output['token']> => ({ category: tokenCategory, amount });
        const input = (coin: UnspentCoin, inputIdentifier: string, transactionIndex: number, token?: Output['token']): InvitationInputWithSpentOutputFields => ({
            outpointTransactionHash: hexToBin(coin.transactionHash),
            outpointIndex: coin.outputIndex,
            inputIdentifier,
            transactionIndex,
            // Not final, so the locktime (the release height) is enforced.
            sequenceNumber: 0,
            valueSatoshis: coin.valueSatoshis,
            ...(token ? { token } : {}),
        });
        const stateToken: NonNullable<Output['token']> = {
            category: hexToBin(stateCoin.token.category),
            amount: 0n,
            nft: { capability: 'none', commitment: hexToBin(stateCoin.token.nft!.commitment) },
        };
        const inputs = [
            input(tokenCoin, 'vaultTokenInput', 0, tokenOf(tokenCoin.token.amount)),
            input(stateCoin, 'vaultStateInput', 1, stateToken),
            input(feeCoin, 'feeCoinInput', 2),
        ];
        const outputs = plan.final
            ? [
                  {
                      outputIdentifier: 'finalOutput',
                      transactionIndex: 0,
                      lockingBytecode: ownerLockingBytecode,
                      valueSatoshis: tokenCoin.valueSatoshis + stateCoin.valueSatoshis + feeCoin.valueSatoshis - MINER_FEE,
                      token: tokenOf(tokenCoin.token.amount),
                  },
              ]
            : [
                  { outputIdentifier: 'releasedOutput', transactionIndex: 0, lockingBytecode: ownerLockingBytecode, valueSatoshis: feeCoin.valueSatoshis - MINER_FEE, token: tokenOf(plan.amount) },
                  { outputIdentifier: 'vaultTokenOutput', transactionIndex: 1, lockingBytecode: vaultLockingBytecode, valueSatoshis: tokenCoin.valueSatoshis, token: tokenOf(plan.tokensLeft) },
                  {
                      outputIdentifier: 'vaultStateOutput',
                      transactionIndex: 2,
                      lockingBytecode: vaultLockingBytecode,
                      valueSatoshis: stateCoin.valueSatoshis,
                      token: { category: feeCoinCategory, amount: 0n, nft: { capability: 'none' as const, commitment: encodeVaultState(plan.next) } },
                  },
              ];
        const variable = (variableIdentifier: string, value: bigint | string) => ({ variableIdentifier, value, roleIdentifier: 'provider' });
        const draft = startInvitation({ templateIdentifier, actionIdentifier, network });

        draft.commit({ roleIdentifier: 'provider' });
        draft.commit({
            variables: [
                variable('blockHeight', blockHeight),
                variable('halvingLength', record.halvingLength),
                variable('tokenCategory', tokenCoin.token.category),
                variable('vaultTokenAmount', tokenCoin.token.amount),
                variable('vaultTokenSatoshis', tokenCoin.valueSatoshis),
                variable('stateCategory', stateCoin.token.category),
                variable('vaultStateSatoshis', stateCoin.valueSatoshis),
                variable('releaseHeight', state.releaseHeight),
                variable('halvingHeight', state.halvingHeight),
                variable('reward', state.reward),
                variable('feeCoinTransactionHash', feeCoin.transactionHash),
                variable('feeCoinSatoshis', feeCoin.valueSatoshis),
            ],
        });
        draft.commit({ inputs });
        draft.commit({ outputs });

        const checked = checkUnsignedInvitation({ draft, template, actionIdentifier, network });

        // The transaction XO built must be the one the contract expects: locktime, inputs and outputs in place.
        if (checked.transaction.locktime !== Number(blockHeight)) {
            throw new Error(`XO built locktime ${checked.transaction.locktime}, expected ${blockHeight}.`);
        }

        checked.transaction.outputs.forEach((built, index) => {
            const expected = outputs[index]!;

            if (binToHex(built.lockingBytecode) !== binToHex(expected.lockingBytecode) || built.valueSatoshis !== expected.valueSatoshis || built.token?.amount !== expected.token.amount) {
                throw new Error(`XO built output ${index} differently from the contract’s rules.`);
            }
        });

        if (checked.transaction.outputs.length !== outputs.length || checked.transaction.inputs.length !== 3) {
            throw new Error('XO built a release with the wrong number of inputs or outputs.');
        }

        return { ...checked, plan, actionIdentifier };
    }

    /** Builds an invitation for the owner's wallet to fund a fee coin: output 0 at the owner's address. */
    function buildAddFeeCoinInvitation(parameters: { network: Network; record: VaultRecord; feeCoinSatoshis?: bigint }): { serializedInvitation: string; invitationIdentifier: string; expiresAt: Date } {
        const { network, record } = parameters;
        const feeCoinSatoshis = parameters.feeCoinSatoshis ?? MINIMUM_FEE_COIN + 2000n;

        if (feeCoinSatoshis < MINIMUM_FEE_COIN) {
            throw new Error(`A fee coin needs at least ${MINIMUM_FEE_COIN} satoshis.`);
        }

        const draft = startInvitation({ templateIdentifier, actionIdentifier: 'addFeeCoin', network });

        draft.commit({ roleIdentifier: 'provider' });
        draft.commit({ variables: [{ variableIdentifier: 'feeCoinSatoshis', value: feeCoinSatoshis, roleIdentifier: 'provider' }] });
        draft.commit({ outputs: [{ outputIdentifier: 'feeCoinOutput', transactionIndex: 0, lockingBytecode: vaultScripts(record).ownerLockingBytecode, valueSatoshis: feeCoinSatoshis }] });

        const invitation = draft.builder.build();

        return {
            serializedInvitation: draft.serialize(),
            invitationIdentifier: invitation.invitationIdentifier,
            expiresAt: new Date(Math.min(...invitation.commits.map((commit) => Number(commit.expiresAtTimestamp)))),
        };
    }

    /**
     * Picks the coins for a lock from the owner's address: token coins of the category until they cover the amount, a
     * coin at output 0 for the state NFT's genesis (a plain one when there is one), and plain coins until the BCH covers
     * the fee coin, the vault's two coins, the miner fee and the change.
     */
    function planLock(parameters: { coins: UnspentCoin[]; tokenCategory: string; lockAmount: bigint; feeCoinSatoshis: bigint }): LockPlan {
        const { coins, lockAmount, feeCoinSatoshis } = parameters;
        const category = parameters.tokenCategory.toLowerCase();
        const byValue = (a: UnspentCoin, b: UnspentCoin): number => (b.valueSatoshis > a.valueSatoshis ? 1 : b.valueSatoshis < a.valueSatoshis ? -1 : 0);
        const isFungible = (coin: UnspentCoin): boolean => coin.token?.category.toLowerCase() === category && coin.token.nft === undefined && coin.token.amount > 0n;
        const plain = coins.filter((coin) => !coin.hasTokens).sort(byValue);
        const byAmount = (a: UnspentCoin, b: UnspentCoin): number => (b.token!.amount > a.token!.amount ? 1 : b.token!.amount < a.token!.amount ? -1 : 0);
        const tokenCoins: UnspentCoin[] = [];
        let tokensAvailable = 0n;

        for (const coin of coins.filter(isFungible).sort(byAmount)) {
            if (tokensAvailable >= lockAmount) {
                break;
            }

            tokenCoins.push(coin);
            tokensAvailable += coin.token!.amount;
        }

        if (lockAmount <= 0n || tokensAvailable < lockAmount) {
            throw new Error(`This address holds ${tokensAvailable.toLocaleString('en-US')} of that token; the lock needs ${lockAmount.toLocaleString('en-US')}.`);
        }

        // Prefer a coin already being spent, then a plain coin, then another coin of the same token.
        const genesisCoin =
            tokenCoins.find((coin) => coin.outputIndex === 0) ?? plain.find((coin) => coin.outputIndex === 0) ?? coins.filter(isFungible).find((coin) => coin.outputIndex === 0);

        if (!genesisCoin) {
            throw new Error(
                'No coin at this address is output 0 of its transaction, and the vault’s state NFT must be minted from one. Send some BCH to this address in a transaction of its own, then refresh.',
            );
        }

        const inputs = [genesisCoin, ...tokenCoins.filter((coin) => coin !== genesisCoin)];
        const paidSatoshis = feeCoinSatoshis + 2n * VAULT_COIN;
        const needed = paidSatoshis + LOCK_ALLOWANCE;
        let inputSatoshis = inputs.reduce((sum, coin) => sum + coin.valueSatoshis, 0n);

        // Plain coins first; then more coins of the same token, whose extra tokens go back as change.
        for (const coin of [...plain, ...coins.filter(isFungible).sort(byValue)]) {
            if (inputSatoshis >= needed) {
                break;
            }

            if (!inputs.includes(coin)) {
                inputs.push(coin);
                inputSatoshis += coin.valueSatoshis;
            }
        }

        if (inputSatoshis < needed) {
            throw new Error(
                `The lock needs about ${needed.toLocaleString('en-US')} satoshis from this address; it has ${inputSatoshis.toLocaleString('en-US')} usable. Send more BCH to it.`,
            );
        }

        const tokensSpent = inputs.filter(isFungible).reduce((sum, coin) => sum + coin.token!.amount, 0n);

        return { tokenCoins, genesisCoin, inputs, inputSatoshis, paidSatoshis, tokensAvailable: tokensSpent, tokenChange: tokensSpent - lockAmount };
    }

    /**
     * Builds the `lock` invitation for the owner's wallet to complete: the vault's settings and the coins to spend. The
     * wallet generates the vault key, adds the vault's outputs (fee coin, tokens, state NFT, record) and its change,
     * signs its coins and broadcasts. Nothing can be built before that, so the check here is XO's validation.
     */
    function buildLockInvitation(parameters: {
        network: Network;
        coins: UnspentCoin[];
        tokenCategory: string;
        lockAmount: bigint;
        reward: bigint;
        halvingLength: bigint;
        startHeight: bigint;
        feeCoinSatoshis?: bigint;
    }): Omit<UnsignedInvitation, 'transaction'> & { plan: LockPlan; schedule: ScheduleEra[] } {
        const { network, coins, lockAmount, reward, halvingLength, startHeight } = parameters;
        const tokenCategory = parameters.tokenCategory.toLowerCase();
        const feeCoinSatoshis = parameters.feeCoinSatoshis ?? MINIMUM_FEE_COIN + 2000n;

        if (!/^[0-9a-f]{64}$/.test(tokenCategory)) {
            throw new Error('Pick the token to lock.');
        }

        if (lockAmount <= 0n) {
            throw new Error('Lock at least one token.');
        }

        if (reward < 1n || reward > lockAmount) {
            throw new Error('The reward per block must be at least 1 and at most the amount locked.');
        }

        if (halvingLength < 1n || halvingLength > MAXIMUM_HEIGHT) {
            throw new Error(`The halving length must be from 1 to ${MAXIMUM_HEIGHT.toLocaleString('en-US')} blocks.`);
        }

        if (startHeight < 0n || startHeight > MAXIMUM_HEIGHT) {
            throw new Error('The start block must be a block height, from 0 to 500,000,000.');
        }

        if (feeCoinSatoshis < MINIMUM_FEE_COIN) {
            throw new Error(`The first fee coin needs at least ${MINIMUM_FEE_COIN} satoshis.`);
        }

        const plan = planLock({ coins, tokenCategory, lockAmount, feeCoinSatoshis });
        const variable = (variableIdentifier: string, value: bigint | string) => ({ variableIdentifier, value, roleIdentifier: 'provider' });
        const draft = startInvitation({ templateIdentifier, actionIdentifier: 'lock', network });
        const toLibauthToken = (token: CoinToken): NonNullable<Output['token']> => ({
            category: hexToBin(token.category),
            amount: token.amount,
            ...(token.nft ? { nft: { capability: token.nft.capability, commitment: hexToBin(token.nft.commitment) } } : {}),
        });

        draft.commit({ roleIdentifier: 'provider' });
        draft.commit({
            variables: [
                variable('halvingLength', halvingLength),
                variable('lockTokenCategory', tokenCategory),
                variable('lockAmount', lockAmount),
                variable('startHeight', startHeight),
                variable('reward', reward),
                variable('stateCategory', plan.genesisCoin.transactionHash),
                variable('feeCoinSatoshis', feeCoinSatoshis),
            ],
        });
        draft.commit({
            inputs: plan.inputs.map(
                (coin): InvitationInputWithSpentOutputFields => ({
                    outpointTransactionHash: hexToBin(coin.transactionHash),
                    outpointIndex: coin.outputIndex,
                    valueSatoshis: coin.valueSatoshis,
                    ...(coin.token ? { token: toLibauthToken(coin.token) } : {}),
                }),
            ),
        });

        return { ...checkIncompleteInvitation({ draft, template, network }), plan, schedule: scheduleOf({ lockAmount, reward, halvingLength, startHeight }) };
    }

    return {
        templateIdentifier,
        MINER_FEE,
        VAULT_COIN,
        planLock,
        buildLockInvitation,
        MINIMUM_FEE_COIN,
        vaultScripts,
        addressOf,
        readVaultCoins,
        listFeeCoins,
        buildReleaseInvitation,
        buildAddFeeCoinInvitation,
    };
}

export type TokenVaultTools = ReturnType<typeof createTokenVaultTools>;
