/**
 * Opens an XO engine on CHIPNET for the contracts' end-to-end scripts. Adapted from server/scripts/_engine.ts.
 *
 * The Electrum client sometimes drops the connection while the engine starts. Its cache is a process-wide singleton
 * that cannot be configured twice, so a retry inside the same process never works: on failure this re-runs the whole
 * script in a fresh process (up to `attempts` times). That is safe because the engine is created before anything is
 * signed or broadcast. The network is hard-coded to chipnet on purpose: these scripts never touch mainnet.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, generateBip39Mnemonic } from '@bitauth/libauth';
import { DUST_LIMIT_SATOSHIS, Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { StorageType } from '@xo-cash/state';
import { serializeInvitation } from '@xo-cash/utils';

/** JSON replacer for logging engine values. */
export const loggable = (_key: string, value: unknown): unknown =>
    typeof value === 'bigint' ? `${value}n` : value instanceof Uint8Array ? binToHex(value) : value;

export interface FinishOptions {
    /** Folder where the executed invitation is saved. */
    folder: string;
    /** File-name label, for example `revenue-split-payout`. */
    label: string;
    /** Add change when there is enough left over. False for transactions whose shape must not change (a burn). */
    addChange?: boolean;
    /** Sign this wallet's reserved inputs. False when the caller already signed them (signing twice conflicts). */
    sign?: boolean;
}

/**
 * Adds change, signs this wallet's inputs, broadcasts, and saves the executed invitation for the Blaze Tool.
 * Returns the transaction hash and the serialized transaction.
 */
export async function signAndBroadcast(
    engine: Engine,
    invitationIdentifier: string,
    { folder, label, addChange = true, sign = true }: FinishOptions,
): Promise<{ transactionHash: string; serializedTransaction?: string }> {
    if (addChange) {
        const leftover = await engine.calculateChange(invitationIdentifier);
        const fee = BigInt(await engine.estimateTransactionFee(invitationIdentifier));
        const change = BigInt(leftover.valueSatoshis) - fee;

        console.log(`  leftover ${leftover.valueSatoshis} sats, estimated fee ${fee}, change ${change}`);

        if (change >= BigInt(DUST_LIMIT_SATOSHIS) || leftover.tokens.length > 0) {
            await engine.addChangeToInvitation(invitationIdentifier);
        }
    }

    for (const inputIndex of sign ? await engine.listOwnInputIndexes(invitationIdentifier) : []) {
        await engine.signInvitation(invitationIdentifier, inputIndex);
    }

    console.log(`  missing: ${JSON.stringify(await engine.listMissingRequirements(invitationIdentifier), loggable)}`);

    let transactionHash: string;
    let serializedTransaction: string | undefined;
    let executed: Parameters<typeof serializeInvitation>[0];

    try {
        const result = await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });

        transactionHash = result.builtTransaction.transactionHash;
        serializedTransaction = result.builtTransaction.serializedTransaction;
        executed = result.storedInvitation.invitation;
    } catch (error) {
        // The engine broadcasts first, then releases reserved coins; Electrum may already have dropped the spent coin,
        // so that clean-up can throw after a successful broadcast (see server/scripts/chipnet-voucher.ts).
        if (!(error instanceof Error) || error.name !== 'UnspentOutputNotFoundInStoreError') {
            throw error;
        }

        const stored = await engine.getInvitation(invitationIdentifier);
        const recorded = Object.values(stored?.invitation.result?.transactions ?? {})[0] as { transactionHash?: string } | undefined;

        if (!stored || !recorded?.transactionHash) {
            throw new Error(`Clean-up failed after broadcast and no transaction hash was recorded: ${error.message}`);
        }

        transactionHash = recorded.transactionHash;
        executed = stored.invitation;
    }

    const file = join(folder, `invitation-${label}-${invitationIdentifier}.json`);

    writeFileSync(file, serializeInvitation(executed));
    console.log(`  BROADCAST ${transactionHash}\n  invitation saved: ${file}`);

    return { transactionHash, serializedTransaction };
}

const ATTEMPT_ENV = 'XO_ENGINE_ATTEMPT';

function pause(seconds: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function rerunInFreshProcess(reason: string, attempts: number): never {
    const attempt = Number(process.env[ATTEMPT_ENV] ?? '1');
    console.error(`  Engine start-up failed (attempt ${attempt}/${attempts}): ${reason}`);

    if (attempt >= attempts) {
        console.error('  Giving up: the chipnet Electrum servers look unreachable. Wait a minute and run the command again.');
        process.exit(1);
    }

    console.error(`  Retrying in a fresh process in ${attempt * 3}s...`);
    pause(attempt * 3);

    const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        stdio: 'inherit',
        env: { ...process.env, [ATTEMPT_ENV]: String(attempt + 1) },
    });

    process.exit(result.status ?? 1);
}

/** Reads the test wallet's mnemonic from `folder`, creating a new test wallet the first time. */
export function loadOrCreateMnemonic(folder: string): string {
    const file = join(folder, 'mnemonic.txt');

    mkdirSync(folder, { recursive: true });

    if (!existsSync(file)) {
        const generated = generateBip39Mnemonic();

        if (typeof generated !== 'string') {
            throw new Error('Could not generate a mnemonic.');
        }

        writeFileSync(file, generated, { mode: 0o600 });
        console.log(`Created a new CHIPNET test wallet in ${file} (test money only; keep it out of git).`);
    }

    return readFileSync(file, 'utf8').trim();
}

export async function createChipnetEngine(mnemonic: string, folder: string, attempts = 4): Promise<Engine> {
    // A connection that drops during start-up can surface as an uncaught error rather than a rejected promise.
    const onStartupCrash = (error: unknown): void => rerunInFreshProcess(error instanceof Error ? error.message : String(error), attempts);
    process.once('uncaughtException', onStartupCrash);
    process.once('unhandledRejection', onStartupCrash);

    try {
        const engine = await Engine.create(mnemonic, {
            network: XO_SUPPORTED_NETWORKS.chipnet,
            storageType: StorageType.INDEXEDDB, // SQLITE storage is incomplete in @xo-cash/state 0.0.5
            databasePath: folder,
            databaseFilename: 'XO',
        });

        process.removeListener('uncaughtException', onStartupCrash);
        process.removeListener('unhandledRejection', onStartupCrash);

        return engine;
    } catch (error) {
        return rerunInFreshProcess(error instanceof Error ? error.message : String(error), attempts);
    }
}
