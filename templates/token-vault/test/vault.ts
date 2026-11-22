/**
 * Test helpers for the Token Vault: an independent Libauth wallet template for the contract (built straight from the
 * cashc artifact, not from the XO template), and a transaction builder that signs vault and owner coins and runs the
 * result in the BCH 2026 VM.
 */
import {
    bigIntToVmNumber,
    binToHex,
    createVirtualMachineBch2026,
    encodeTransactionBch,
    generateTransaction,
    importWalletTemplate,
    secp256k1,
    walletTemplateToCompilerBch,
    type Input,
    type InputTemplate,
    type Output,
    type Transaction,
} from '@bitauth/libauth';
import artifact from '../artifact/TokenVault_Release.json' with { type: 'json' };
import { artifactAsmToCashAssembly } from '../../shared/cashscript.js';

const imported = importWalletTemplate({
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    name: 'TokenVault_Release (tests)',
    supported: ['BCH_2025_05'],
    version: 0,
    entities: {
        owner: {
            name: 'Owner',
            variables: {
                ownerKey: { type: 'Key' },
                halvingLength: { type: 'WalletData' },
                blockHeight: { type: 'WalletData' },
            },
        },
    },
    scripts: {
        vaultBytecode: { script: artifactAsmToCashAssembly(artifact.bytecode) },
        // CashScript pushes constructor arguments in reverse: TokenVault_Release(fund, halvingLength).
        vaultLock: { lockingType: 'p2sh32', script: '<halvingLength> <ownerKey.public_key> vaultBytecode' },
        // release(sig signature, int blockHeight), arguments in reverse.
        vaultUnlock: { unlocks: 'vaultLock', script: '<blockHeight> <ownerKey.schnorr_signature.all_outputs>' },
        ownerLock: { lockingType: 'standard', script: 'OP_DUP OP_HASH160 <$(<ownerKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG' },
        ownerUnlock: { unlocks: 'ownerLock', script: '<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key>' },
    },
});

if (typeof imported === 'string') {
    throw new Error(imported);
}

const compiler = walletTemplateToCompilerBch(imported);
const vm = createVirtualMachineBch2026();

export interface Owner {
    privateKey: Uint8Array;
    halvingLength: bigint;
}

/** The owner's compressed public key. */
export function publicKeyOf(owner: Owner): Uint8Array {
    const publicKey = secp256k1.derivePublicKeyCompressed(owner.privateKey);

    if (typeof publicKey === 'string') {
        throw new Error(publicKey);
    }

    return publicKey;
}

const dataFor = (owner: Owner, blockHeight = 0n) => ({
    keys: { privateKeys: { ownerKey: owner.privateKey } },
    bytecode: { halvingLength: bigIntToVmNumber(owner.halvingLength), blockHeight: bigIntToVmNumber(blockHeight) },
});

function lockFor(owner: Owner, script: 'vaultLock' | 'ownerLock'): Uint8Array {
    const result = compiler.generateBytecode({ data: dataFor(owner), scriptId: script });

    if (!result.success) {
        throw new Error(JSON.stringify(result.errors));
    }

    return result.bytecode;
}

/** The vault's P2SH32 locking bytecode, as CashScript builds it for these constructor arguments. */
export const vaultLock = (owner: Owner): Uint8Array => lockFor(owner, 'vaultLock');
/** The owner's P2PKH locking bytecode: where the contract sends released tokens. */
export const ownerLock = (owner: Owner): Uint8Array => lockFor(owner, 'ownerLock');

/** The contract's state commitment: three 8-byte little-endian numbers. */
export function stateCommitment(releaseHeight: bigint, halvingHeight: bigint, reward: bigint): Uint8Array {
    const bytes8 = (value: bigint): number[] => {
        const number = bigIntToVmNumber(value);
        const padded = new Uint8Array(8);

        padded.set(number);
        return [...padded];
    };

    return new Uint8Array([...bytes8(releaseHeight), ...bytes8(halvingHeight), ...bytes8(reward)]);
}

export interface Coin {
    /** Display-order transaction hash; a state NFT minted from a coin at index 0 takes it as its category. */
    transactionHash: Uint8Array;
    outputIndex: number;
    valueSatoshis: bigint;
    token?: Output['token'];
    /** How to unlock: a vault coin with the release function, an owner coin with its P2PKH signature, or raw bytes. */
    unlock: { vault: Owner; blockHeight: bigint; signer?: Owner } | { owner: Owner } | { raw: Uint8Array; lockingBytecode: Uint8Array };
    sequenceNumber?: number;
}

const lockingBytecodeOf = (coin: Coin): Uint8Array =>
    'vault' in coin.unlock ? vaultLock(coin.unlock.vault) : 'owner' in coin.unlock ? ownerLock(coin.unlock.owner) : coin.unlock.lockingBytecode;

/** Builds and signs the transaction, or returns the generation error. */
export function buildRelease(coins: Coin[], outputs: Output[], locktime: number): { transaction: Transaction; sourceOutputs: Output[] } | string {
    const sourceOutputs: Output[] = coins.map((coin) => ({ lockingBytecode: lockingBytecodeOf(coin), valueSatoshis: coin.valueSatoshis, ...(coin.token ? { token: coin.token } : {}) }));
    const inputs = coins.map((coin) => {
        const base = { outpointTransactionHash: coin.transactionHash, outpointIndex: coin.outputIndex, sequenceNumber: coin.sequenceNumber ?? 0 };
        const signed = { valueSatoshis: coin.valueSatoshis, ...(coin.token ? { token: coin.token } : {}) };

        if ('vault' in coin.unlock) {
            const { vault, signer, blockHeight } = coin.unlock;
            const data: ReturnType<typeof dataFor> & { bytecode: Record<string, Uint8Array> } = dataFor(signer ?? vault, blockHeight);

            data.bytecode.halvingLength = bigIntToVmNumber(vault.halvingLength);

            // Another signer: its key signs, but the redeem script keeps the vault's public key.
            if (signer) {
                data.bytecode['ownerKey.public_key'] = publicKeyOf(vault);
            }

            return { ...base, unlockingBytecode: { compiler, script: 'vaultUnlock', data, ...signed } };
        }

        if ('owner' in coin.unlock) {
            return { ...base, unlockingBytecode: { compiler, script: 'ownerUnlock', data: dataFor(coin.unlock.owner), ...signed } };
        }

        return { ...base, unlockingBytecode: coin.unlock.raw };
    });
    const generated = generateTransaction({ version: 2, locktime, inputs: inputs as InputTemplate<typeof compiler>[], outputs });

    return generated.success ? { transaction: generated.transaction, sourceOutputs } : `Transaction generation failed: ${JSON.stringify(generated.errors)}`;
}

/** Builds, signs and verifies a spend: true when the VM accepts it, otherwise the reason. */
export function verifyRelease(coins: Coin[], outputs: Output[], locktime: number): true | string {
    const built = buildRelease(coins, outputs, locktime);

    if (typeof built === 'string') {
        return built;
    }

    const result = vm.verify(built);

    return result === true ? true : String(result);
}

/** The signed size in bytes of a spend, for fee checks. */
export function releaseSize(coins: Coin[], outputs: Output[], locktime: number): number {
    const built = buildRelease(coins, outputs, locktime);

    if (typeof built === 'string') {
        throw new Error(built);
    }

    return encodeTransactionBch(built.transaction).length;
}

/** The unlocking bytecode of input `index` of a built release, as hex. */
export function unlockingHex(coins: Coin[], outputs: Output[], locktime: number, index: number): string {
    const built = buildRelease(coins, outputs, locktime);

    if (typeof built === 'string') {
        throw new Error(built);
    }

    return binToHex((built.transaction.inputs[index] as Input).unlockingBytecode);
}

/** The contract's release maths (TokenVault_Release.release), for building expected outputs. */
export function releaseOf(state: { releaseHeight: bigint; halvingHeight: bigint; reward: bigint }, blockHeight: bigint, halvingLength: bigint) {
    let nextReleaseHeight = blockHeight;
    let nextHalvingHeight = state.halvingHeight;
    let nextReward = state.reward;
    let amount = (blockHeight - state.releaseHeight + 1n) * state.reward;

    if (blockHeight - state.halvingHeight + 1n >= halvingLength) {
        nextReleaseHeight = state.halvingHeight + halvingLength;
        nextHalvingHeight = nextReleaseHeight;
        nextReward = state.reward / 2n > 1n ? state.reward / 2n : 1n;
        amount = (nextReleaseHeight - state.releaseHeight) * state.reward;
    }

    return { amount, nextReleaseHeight, nextHalvingHeight, nextReward };
}
