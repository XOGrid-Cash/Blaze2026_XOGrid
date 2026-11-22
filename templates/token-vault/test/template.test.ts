/**
 * The Token Vault XO template: it must embed exactly the upstream TokenVault_Release bytecode, build the same redeem
 * script and unlocking order as CashScript, resolve every output (including the state commitments it builds as hex
 * text) to what the contract requires, build releases the VM accepts, refuse bad releases, and pass the registry audit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    bigIntToVmNumber,
    binToHex,
    createCompilerBch,
    createVirtualMachineBch2026,
    decodeAuthenticationInstructions,
    encodeDataPush,
    hexToBin,
    type AuthenticationInstructionPush,
    type Output,
} from '@bitauth/libauth';
import { buildCompilerBytecodeDataFromCompilationVariables, completeMergedOutput } from '@xo-cash/engine';
import { compileCashAssemblyString, extractCashAssemblyEvaluations, generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { compileString } from 'cashc-0.10';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../../../server/src/audit/index.js';
import artifact from '../artifact/TokenVault_Release.json' with { type: 'json' };
import upstream from '../upstream/TokenVault_Release.artifact.json' with { type: 'json' };
import { tokenVaultTemplate } from '../template.js';
import { buildRelease, ownerLock, publicKeyOf, releaseOf, releaseSize, stateCommitment, vaultLock, verifyRelease, type Coin, type Owner } from './vault.js';

// Parse the object directly: a JSON round trip of our own would turn bigints into plain strings.
const template = parseTemplate(tokenVaultTemplate as Parameters<typeof parseTemplate>[0]);
const constant = (identifier: string): bigint => template.constants![identifier]!.value as bigint;
const MINER_FEE = constant('releaseMinerFeeSatoshis');

const OWNER: Owner = { privateKey: new Uint8Array(32).fill(7), halvingLength: 100n };
const TOKEN = '11'.repeat(32);
const VAULT_TRANSACTION = hexToBin('22'.repeat(32));
const FEE_TRANSACTION = '33'.repeat(32);
const STATE_CATEGORY = '55'.repeat(32);

type Variables = Record<string, bigint | string>;

/** A template script compiled the way the engine compiles locking and unlocking scripts, with the owner's key operations. */
function compileWithOwner(script: string, variables: Variables, operations: Record<string, Uint8Array> = {}): Uint8Array {
    const bytecode = buildCompilerBytecodeDataFromCompilationVariables(template as never, variables as never) as Record<string, Uint8Array>;

    return hexToBin(
        compileCashAssemblyString({
            cashAssemblyText: `$(<${script}>)`,
            variables: { ...bytecode, 'ownerKey.public_key': publicKeyOf(OWNER), ...operations },
            evaluationDecodeMode: 'hex',
            templateVariables: template.variables,
            templateScripts: template.scripts,
        } as never),
    );
}

/**
 * One template output, resolved exactly as the engine does when it builds the transaction. The locking bytecode is
 * given (the owner's wallet compiles it with its key), so only the value and token come from the template.
 */
function resolveOutput(action: string, outputIdentifier: string, lockingBytecode: Uint8Array, variables: Variables): Output {
    const withConstants = { ...Object.fromEntries(Object.entries(template.constants ?? {}).map(([key, value]) => [key, value.value])), ...variables };
    const invitationVariables = Object.entries(withConstants).map(([variableIdentifier, value]) => ({ variableIdentifier, value }));
    const resolved = completeMergedOutput({ outputIdentifier, lockingBytecode } as never, 0, invitationVariables as never, template as never, action) as unknown as {
        valueSatoshis: bigint;
        token?: { category: string | Uint8Array; amount?: bigint; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string | Uint8Array } };
    };
    const token = resolved.token;
    // The engine returns some token fields as hex and some as bytes.
    const bin = (value: string | Uint8Array): Uint8Array => (typeof value === 'string' ? hexToBin(value) : value);

    return {
        lockingBytecode,
        valueSatoshis: resolved.valueSatoshis,
        ...(token
            ? {
                  token: {
                      category: bin(token.category),
                      amount: token.amount ?? 0n,
                      ...(token.nft ? { nft: { capability: token.nft.capability, commitment: bin(token.nft.commitment) } } : {}),
                  },
              }
            : {}),
    };
}

/** A template script evaluated the way the engine evaluates token fields: variables as text, result read as text. */
const asText = (cashAssemblyText: string, variables: Variables): string =>
    compileCashAssemblyString({ cashAssemblyText, variables, evaluationDecodeMode: 'utf8', templateVariables: template.variables, templateScripts: template.scripts } as never);

/** The NFT commitment text a template output or input writes. */
const commitmentOf = (identifier: string): string => ((template.outputs?.[identifier] ?? template.inputs?.[identifier]) as { token: { nft: { commitment: string } } }).token.nft.commitment;

/**
 * Runs each `$(…)` evaluation of a token field in the BCH 2026 VM, as a wallet reduces it, and returns its operation
 * cost, or the VM's error (for example, over the operation cost limit).
 */
function evaluationCosts(cashAssemblyText: string, variables: Record<string, bigint>): Array<{ evaluation: string; cost: number; error?: string }> {
    const vm = createVirtualMachineBch2026(false);

    return extractCashAssemblyEvaluations(cashAssemblyText).map((evaluation: string) => {
        const source = evaluation.replace(/^\$\(/, '').replace(/\)$/, '');
        const compiler = createCompilerBch({
            scripts: { ...(template.scripts as Record<string, string>), probe: source },
            variables: Object.fromEntries(Object.keys(variables).map((name) => [name, { type: 'WalletData' as const }])),
        });
        const compiled = compiler.generateBytecode({ scriptId: 'probe', data: { bytecode: Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, bigIntToVmNumber(value)])) } });

        if (!compiled.success) {
            throw new Error(JSON.stringify(compiled.errors));
        }

        const state = vm.evaluate({
            inputIndex: 0,
            sourceOutputs: [{ lockingBytecode: compiled.bytecode, valueSatoshis: 0n }],
            transaction: {
                version: 2,
                locktime: 0,
                inputs: [{ outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() }],
                outputs: [{ lockingBytecode: new Uint8Array([0x6a]), valueSatoshis: 0n }],
            },
        });

        return { evaluation, cost: state.metrics.operationCost, ...(state.error ? { error: state.error } : {}) };
    });
}

interface Vault {
    tokens: bigint;
    releaseHeight: bigint;
    halvingHeight: bigint;
    reward: bigint;
}

const releaseVariables = (vault: Vault, blockHeight: bigint, feeCoinSatoshis = 5000n): Variables => ({
    blockHeight,
    halvingLength: OWNER.halvingLength,
    tokenCategory: TOKEN,
    vaultTokenAmount: vault.tokens,
    vaultTokenSatoshis: 1000n,
    stateCategory: STATE_CATEGORY,
    vaultStateSatoshis: 1000n,
    releaseHeight: vault.releaseHeight,
    halvingHeight: vault.halvingHeight,
    reward: vault.reward,
    feeCoinTransactionHash: FEE_TRANSACTION,
    feeCoinSatoshis,
});

const coinsFor = (vault: Vault, blockHeight: bigint, feeCoinSatoshis = 5000n): Coin[] => [
    { transactionHash: VAULT_TRANSACTION, outputIndex: 1, valueSatoshis: 1000n, token: { category: hexToBin(TOKEN), amount: vault.tokens }, unlock: { vault: OWNER, blockHeight } },
    {
        transactionHash: VAULT_TRANSACTION,
        outputIndex: 2,
        valueSatoshis: 1000n,
        token: { category: hexToBin(STATE_CATEGORY), amount: 0n, nft: { capability: 'none', commitment: stateCommitment(vault.releaseHeight, vault.halvingHeight, vault.reward) } },
        unlock: { vault: OWNER, blockHeight },
    },
    { transactionHash: hexToBin(FEE_TRANSACTION), outputIndex: 0, valueSatoshis: feeCoinSatoshis, unlock: { owner: OWNER } },
];

const releaseOutputs = (vault: Vault, blockHeight: bigint, feeCoinSatoshis = 5000n): Output[] => {
    const variables = releaseVariables(vault, blockHeight, feeCoinSatoshis);

    return [
        resolveOutput('release', 'releasedOutput', ownerLock(OWNER), variables),
        resolveOutput('release', 'vaultTokenOutput', vaultLock(OWNER), variables),
        resolveOutput('release', 'vaultStateOutput', vaultLock(OWNER), variables),
    ];
};

const VAULT: Vault = { tokens: 1_000_000n, releaseHeight: 1000n, halvingHeight: 1000n, reward: 1000n };

describe('Token Vault template', () => {
    it('parses, and has a stable canonical identifier', () => {
        const identifier = generateTemplateIdentifier(template);

        expect(identifier).toMatch(/^[0-9a-f]{64}$/);
        expect(generateTemplateIdentifier(parseTemplate(serializeTemplate(template)))).toBe(identifier);
    });

    it('embeds the upstream bytecode unchanged, and cashc 0.10.0-next.4 rebuilds it', () => {
        const rebuilt = compileString(readFileSync(join(import.meta.dirname, '..', 'TokenVault_Release.cash'), 'utf8').replaceAll('\r\n', '\n'));

        expect(upstream.compiler.version).toBe('0.10.0-next.5');
        expect(artifact.bytecode).toBe(upstream.bytecode);
        expect(rebuilt.bytecode).toBe(upstream.bytecode);
    });

    it('builds the same vault and owner locking bytecode as the contract', () => {
        const redeem = compileWithOwner('vaultRedeem', { halvingLength: OWNER.halvingLength });
        const lockFromTemplate = binToHex(vaultLock(OWNER));

        // vaultLock (test/vault.ts) is a P2SH32 of the CashScript constructor push order, built straight from the artifact.
        expect(lockFromTemplate).toMatch(/^aa20[0-9a-f]{64}87$/);
        expect(binToHex(compileWithOwner('vaultBytecode', {}))).toBe(binToHex(redeem.slice(redeem.length - compileWithOwner('vaultBytecode', {}).length)));
        expect(binToHex(compileWithOwner('ownerLockingBytecode', {}))).toBe(binToHex(ownerLock(OWNER)));

        const built = buildRelease(coinsFor(VAULT, 1049n), releaseOutputs(VAULT, 1049n), 1049);

        if (typeof built === 'string') {
            throw new Error(built);
        }

        // The last push of the vault input's unlocking bytecode is the redeem script the VM hashed to the lock.
        const pushes = decodeAuthenticationInstructions(built.transaction.inputs[0]!.unlockingBytecode) as AuthenticationInstructionPush[];

        expect(binToHex(pushes.at(-1)!.data)).toBe(binToHex(redeem));
    });

    it('unlocks in the contract’s order: the release height, then the owner’s signature', () => {
        const built = buildRelease(coinsFor(VAULT, 1049n), releaseOutputs(VAULT, 1049n), 1049);

        if (typeof built === 'string') {
            throw new Error(built);
        }

        for (const index of [0, 1]) {
            const unlocking = built.transaction.inputs[index]!.unlockingBytecode;
            const pushes = decodeAuthenticationInstructions(unlocking) as AuthenticationInstructionPush[];
            const signature = pushes[1]!.data;
            const fromTemplate = compileWithOwner('unlockRelease', { blockHeight: 1049n }, { 'ownerKey.schnorr_signature.all_outputs': signature });

            expect(binToHex(new Uint8Array([...fromTemplate, ...encodeDataPush(pushes[2]!.data)]))).toBe(binToHex(unlocking));
        }
    });

    it('records the owner’s public key and the halving length in the lock transaction', () => {
        const record = compileWithOwner('vaultRecord', { halvingLength: OWNER.halvingLength });

        expect(binToHex(record)).toBe(`6a0454564c5421${binToHex(publicKeyOf(OWNER))}${binToHex(encodeDataPush(bigIntToVmNumber(OWNER.halvingLength)))}`);
    });

    it('writes the state commitments as the contract’s three 8-byte numbers', () => {
        const state = { releaseHeight: 857_132n, halvingHeight: 857_000n, reward: 250_000_000_000n };

        expect(asText(commitmentOf('vaultStateInput'), { ...state })).toBe(binToHex(stateCommitment(state.releaseHeight, state.halvingHeight, state.reward)));
        expect(asText(commitmentOf('lockStateOutput'), { startHeight: 857_132n, reward: 250_000_000_000n })).toBe(binToHex(stateCommitment(857_132n, 857_132n, 250_000_000_000n)));
        expect(asText(commitmentOf('vaultStateInput'), { releaseHeight: 0n, halvingHeight: 0n, reward: 1n })).toBe(binToHex(stateCommitment(0n, 0n, 1n)));
        // The largest values: the maximum height and the largest token amount as the reward.
        const largest = { releaseHeight: 499_999_999n, halvingHeight: 499_999_999n, reward: 9_223_372_036_854_775_807n };

        expect(asText(commitmentOf('vaultStateInput'), largest)).toBe(binToHex(stateCommitment(largest.releaseHeight, largest.halvingHeight, largest.reward)));
        // Every digit value, in both nibbles.
        expect(asText(commitmentOf('vaultStateInput'), { releaseHeight: 0x0123_4567_89ab_cdefn, halvingHeight: 0x7edc_ba98_7654_3210n, reward: 0x7f80_a5c3_0f1e_2d3cn })).toBe(
            binToHex(stateCommitment(0x0123_4567_89ab_cdefn, 0x7edc_ba98_7654_3210n, 0x7f80_a5c3_0f1e_2d3cn)),
        );
    });

    it('keeps every evaluation of the state commitments under the BCH 2026 operation cost limit', () => {
        const largest = { startHeight: 499_999_999n, releaseHeight: 499_999_999n, halvingHeight: 499_999_000n, reward: 9_223_372_036_854_775_807n };
        // The next state after a release at a halving, with the largest values the release can see.
        const release = { ...largest, blockHeight: 499_999_999n, halvingLength: 999n };
        const costs = [
            ...evaluationCosts(commitmentOf('lockStateOutput'), largest),
            ...evaluationCosts(commitmentOf('vaultStateInput'), largest),
            ...evaluationCosts(commitmentOf('vaultStateOutput'), release),
        ];

        expect(costs).toHaveLength(3);
        expect(costs.filter((cost) => cost.error !== undefined)).toEqual([]);
        // Leave room under the 32,800 limit of an evaluation with no unlocking bytecode.
        expect(Math.max(...costs.map((cost) => cost.cost))).toBeLessThan(24_000);
    });

    it('builds a lock with the fee coin first, then the vault’s tokens and state NFT', () => {
        const variables = { halvingLength: 100n, lockTokenCategory: TOKEN, lockAmount: 1_000_000n, startHeight: 1000n, reward: 1000n, stateCategory: STATE_CATEGORY, feeCoinSatoshis: 5000n };
        const tokens = resolveOutput('lock', 'lockTokenOutput', vaultLock(OWNER), variables);
        const state = resolveOutput('lock', 'lockStateOutput', vaultLock(OWNER), variables);

        expect(tokens.token).toEqual({ category: hexToBin(TOKEN), amount: 1_000_000n });
        expect(binToHex(state.token!.nft!.commitment)).toBe(binToHex(stateCommitment(1000n, 1000n, 1000n)));
        expect(template.transactions!.lockTransaction!.outputs.map((output) => [output.output, output.outputIndex])).toEqual([
            ['feeCoinOutput', 0],
            ['lockTokenOutput', 1],
            ['lockStateOutput', 2],
            ['vaultRecordOutput', 3],
        ]);
        // A reward above the amount locked, or nothing locked, is refused.
        expect(() => resolveOutput('lock', 'lockTokenOutput', vaultLock(OWNER), { ...variables, reward: 1_000_001n })).toThrow();
        expect(() => resolveOutput('lock', 'lockTokenOutput', vaultLock(OWNER), { ...variables, lockAmount: 0n, reward: 0n })).toThrow();
        expect(() => resolveOutput('lock', 'lockTokenOutput', vaultLock(OWNER), { ...variables, halvingLength: 0n })).toThrow();
    });

    it.each([
        ['between halvings', VAULT, 1049n],
        ['up to a halving', VAULT, 1150n],
        ['after a halving', { tokens: 900_000n, releaseHeight: 1100n, halvingHeight: 1100n, reward: 500n }, 1120n],
        ['at a reward of 1', { tokens: 100n, releaseHeight: 5000n, halvingHeight: 5000n, reward: 1n }, 5010n],
    ])('builds a release the VM accepts: %s', (_label, vault, blockHeight) => {
        const outputs = releaseOutputs(vault, blockHeight);
        const next = releaseOf(vault, blockHeight, OWNER.halvingLength);

        expect(outputs[0]!.token!.amount).toBe(next.amount);
        expect(outputs[1]!.token!.amount).toBe(vault.tokens - next.amount);
        expect(binToHex(outputs[2]!.token!.nft!.commitment)).toBe(binToHex(stateCommitment(next.nextReleaseHeight, next.nextHalvingHeight, next.nextReward)));
        expect(verifyRelease(coinsFor(vault, blockHeight), outputs, Number(blockHeight))).toBe(true);
    });

    it('builds the release that empties the vault as one output the VM accepts', () => {
        const vault = { ...VAULT, tokens: 30_000n };
        const variables = releaseVariables(vault, 1049n);
        const final = resolveOutput('releaseFinal', 'finalOutput', ownerLock(OWNER), variables);

        expect(final.token!.amount).toBe(30_000n);
        expect(final.valueSatoshis).toBe(1000n + 1000n + 5000n - MINER_FEE);
        expect(verifyRelease(coinsFor(vault, 1049n), [final], 1049)).toBe(true);
        // The ordinary release refuses to build when the vault would be emptied, and the final one when it would not.
        expect(() => resolveOutput('release', 'releasedOutput', ownerLock(OWNER), variables)).toThrow();
        expect(() => resolveOutput('releaseFinal', 'finalOutput', ownerLock(OWNER), releaseVariables(VAULT, 1049n))).toThrow();
    });

    it('sets the release height as the transaction’s locktime, with non-final inputs', () => {
        for (const transaction of ['releaseTransaction', 'releaseFinalTransaction'] as const) {
            expect(template.transactions![transaction]!.locktime).toBe('$(<blockHeight>)');
            expect(template.transactions![transaction]!.composable).toBe(false);
        }

        for (const input of ['vaultTokenInput', 'vaultStateInput', 'feeCoinInput']) {
            expect(template.inputs![input]!.sequenceNumber).toBe(0);
        }
    });

    it('refuses a release that does not move past the last release, or a fee coin too small', () => {
        expect(() => releaseOutputs(VAULT, 1000n)).toThrow();
        expect(() => releaseOutputs(VAULT, 999n)).toThrow();
        expect(() => releaseOutputs(VAULT, 1049n, 2999n)).toThrow();
        expect(() => releaseOutputs({ ...VAULT, reward: 0n }, 1049n)).toThrow();
    });

    it('pays the miner at least 1 satoshi per byte of a signed release', () => {
        const size = releaseSize(coinsFor(VAULT, 1049n), releaseOutputs(VAULT, 1049n), 1049);

        expect(MINER_FEE).toBeGreaterThanOrEqual(BigInt(size));
        expect(constant('minimumFeeCoinSatoshis')).toBeGreaterThanOrEqual(MINER_FEE + 546n);
    });

    it('committed template.json is current, with bigints in XO extended-JSON form', () => {
        const committed = readFileSync(join(import.meta.dirname, '..', 'template.json'), 'utf8');

        expect(committed).toBe(serializeTemplate(template));
        expect(committed).not.toMatch(/"-?\d+n"/);
    });

    it('passes every automated registry audit check with no failures', () => {
        const report = runAudit({ storedJson: serializeTemplate(template), storedIdentifier: generateTemplateIdentifier(template) });
        const failing = report.results.filter((result) => result.status === 'fail');

        expect(failing).toEqual([]);
        // Every locking script needs the owner's key, so the audit cannot compile any with sample values.
        expect(report.results.find((result) => result.id === 'compile')?.status).toBe('skipped');
    });
});
