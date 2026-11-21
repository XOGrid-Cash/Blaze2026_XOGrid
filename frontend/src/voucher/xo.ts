/**
 * The Claim-Code Voucher, built by the XO engine.
 *
 * The lock, the unlocking script and every transaction below come from the registry's Claim-Code Voucher template
 * through @xo-cash/engine: the engine compiles the template's scripts, resolves the voucher output (lock and value)
 * from the template, and assembles the transaction from an XO invitation.
 *
 * core.ts is a second, independent implementation written directly with libauth. Every build here is compared with it
 * byte for byte, and an answer is refused when the two differ, so a change in the engine can never put a different
 * transaction in front of a wallet or onto the network unnoticed.
 *
 * Bytes variables go to the engine as HEX text, never as a raw Uint8Array (a raw array compiles to a different script).
 */
import {
    binToHex,
    createVirtualMachineBch2026,
    decodeTransaction,
    encodeDataPush,
    encodeTransaction,
    flattenBinArray,
    hash256,
    hexToBin,
    type TransactionCommon,
} from '@bitauth/libauth';
import { Crypto } from '@xo-cash/crypto';
import {
    InvitationBuilder,
    buildCompilerBytecodeDataFromCompilationVariables,
    buildInvitationTransactionFromMergedCommit,
    compileLockingBytecodeFromTemplateLockingScriptIdentifier,
    listInvitationValidationIssues,
    mergeInvitationCommits,
    resolveHdKeyNetwork,
    type InvitationInputWithSpentOutputFields,
} from '@xo-cash/engine';
import { compileCashAssemblyString, deserializeInvitation, generateTemplateIdentifier, parseTemplate, serializeInvitation } from '@xo-cash/utils';

import voucherTemplateText from './claim-voucher.template.json?raw';
import {
    CLAIM_FEE_SATOSHIS,
    ISSUE_FEE_SATOSHIS,
    VOUCHER_TEMPLATE_IDENTIFIER,
    buildClaim as independentBuildClaim,
    buildIssue as independentBuildIssue,
    codeHash,
    verifySignedIssue as independentVerifySignedIssue,
    voucherLockingBytecode as independentLockingBytecode,
    voucherUnlockingBytecode as independentUnlockingBytecode,
    walletLockingBytecode,
    type Coin,
    type IssuePlan,
    type Verdict,
    type VoucherCoin,
} from './core';

const voucherTemplate = parseTemplate(voucherTemplateText);

if (generateTemplateIdentifier(voucherTemplate) !== VOUCHER_TEMPLATE_IDENTIFIER) {
    throw new Error('The voucher template shipped with the page is not the registry template (its identifier changed).');
}

/** What built a voucher transaction, shown on the page. */
export const VOUCHER_BUILD = { engine: '@xo-cash/engine', templateIdentifier: VOUCHER_TEMPLATE_IDENTIFIER } as const;

type Variables = Record<string, string | bigint>;

const withConstants = (variables: Variables): Record<string, unknown> => ({
    ...Object.fromEntries(Object.entries(voucherTemplate.constants ?? {}).map(([identifier, constant]) => [identifier, constant.value])),
    ...variables,
});

/** One template script compiled the way the engine compiles it for locking and unlocking scripts. */
function compileTemplateScript(scriptIdentifier: string, variables: Variables): Uint8Array {
    return hexToBin(
        compileCashAssemblyString({
            cashAssemblyText: `$(<${scriptIdentifier}>)`,
            variables: buildCompilerBytecodeDataFromCompilationVariables(voucherTemplate as never, withConstants(variables) as never),
            evaluationDecodeMode: 'hex',
            templateVariables: voucherTemplate.variables,
            templateScripts: voucherTemplate.scripts,
        } as never),
    );
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

const disagreement = (what: string): Error => new Error(`The XO engine and XOGrid's independent check disagree about ${what}, so nothing was built.`);

/** OP_SHA256 <hash> OP_EQUAL, compiled from the template's `voucherRedeemBytecode`. */
export const redeemScript = (hash: Uint8Array): Uint8Array => compileTemplateScript('voucherRedeemBytecode', { codeHash: binToHex(hash) });

/** The voucher's lock, compiled by the engine from the template's `voucherLockingScript`. */
export function voucherLockingBytecode(hash: Uint8Array): Uint8Array {
    const lock = compileLockingBytecodeFromTemplateLockingScriptIdentifier(voucherTemplate as never, 'voucherLockingScript', withConstants({ codeHash: binToHex(hash) }) as never);

    if (!same(lock, independentLockingBytecode(hash))) {
        throw disagreement('the voucher lock');
    }

    return lock;
}

/** The P2SH unlocking: the template's `unlockVoucher` script (the claim code), then a push of the redeem script. */
export function voucherUnlockingBytecode(code: Uint8Array): Uint8Array {
    const unlocking = flattenBinArray([compileTemplateScript('unlockVoucher', { claimCode: binToHex(code) }), encodeDataPush(redeemScript(codeHash(code)))]);

    if (!same(unlocking, independentUnlockingBytecode(code))) {
        throw disagreement('the unlocking script');
    }

    return unlocking;
}

/** The engine's invitation machinery used as a pure transaction builder: no wallet, a throwaway key signs the commits. */
function draftInvitation(actionIdentifier: string) {
    const templateIdentifier = VOUCHER_TEMPLATE_IDENTIFIER;
    // The transaction bytes do not depend on the network; the engine only needs to be told one.
    const network = 'chipnet' as const;
    const signer = new Crypto(globalThis.crypto.getRandomValues(new Uint8Array(64)), { network: resolveHdKeyNetwork(network) });
    const builder = new InvitationBuilder({ templateIdentifier, actionIdentifier }, network);
    let rootCommitIdentifier: string | undefined;

    const commit = (parameters: Parameters<InvitationBuilder['createUnsignedCommit']>[0]): string => {
        const invitationCommit = builder.createUnsignedCommit(parameters);

        rootCommitIdentifier ??= invitationCommit.commitIdentifier;
        builder.addCommit(
            signer.signInvitationCommitWithSchnorr({
                invitationCommit,
                invitationIdentifier: builder.invitationIdentifier,
                rootCommitIdentifier,
                templateIdentifier,
                actionIdentifier,
            }),
        );

        return invitationCommit.commitIdentifier;
    };

    const build = (): string => {
        const invitation = deserializeInvitation(serializeInvitation(builder.build()));
        const issues = listInvitationValidationIssues(invitation, voucherTemplate as never, network);

        if (issues.length > 0) {
            throw new Error(`XO rejected the invitation: ${issues.map((issue) => `${issue.name}: ${issue.message}`).join('; ')}`);
        }

        return buildInvitationTransactionFromMergedCommit(mergeInvitationCommits(invitation, voucherTemplate as never), voucherTemplate as never, actionIdentifier).serializedTransaction;
    };

    return { commit, build };
}

const decoded = (hex: string): TransactionCommon => {
    const transaction = decodeTransaction(hexToBin(hex));

    if (typeof transaction === 'string') {
        throw new Error(`The XO engine built a transaction that does not decode: ${transaction}`);
    }

    return transaction;
};

/**
 * The unsigned issue transaction, built by the engine from the template's `createVoucher` action: the voucher output
 * (lock and value) is resolved by the engine from the template; the wallet's coin is the input and the rest returns to
 * the coin's own address. Same checks and errors as core.buildIssue, which also supplies the independent build.
 */
export function buildIssue(coin: Coin, voucherSatoshis: bigint, hash: Uint8Array): IssuePlan {
    const independent = independentBuildIssue(coin, voucherSatoshis, hash);
    const draft = draftInvitation('createVoucher');
    const walletInput: InvitationInputWithSpentOutputFields = {
        transactionIndex: 0,
        outpointTransactionHash: hexToBin(coin.transactionHash),
        outpointIndex: coin.outputIndex,
        // The same sequence number the wallet is asked to sign with (core.buildIssue).
        sequenceNumber: independent.transaction.inputs[0]!.sequenceNumber,
        valueSatoshis: coin.valueSatoshis,
    };

    draft.commit({ roleIdentifier: 'issuer' });
    draft.commit({
        variables: [
            { variableIdentifier: 'voucherSatoshis', value: voucherSatoshis, roleIdentifier: 'issuer' },
            { variableIdentifier: 'codeHash', value: binToHex(hash), roleIdentifier: 'issuer' },
        ],
    });
    draft.commit({ inputs: [walletInput] });
    draft.commit({
        outputs: [
            { outputIdentifier: 'voucherOutput', transactionIndex: 0 },
            { transactionIndex: 1, valueSatoshis: independent.changeSatoshis, lockingBytecode: walletLockingBytecode(coin.publicKey) },
        ],
    });

    const hex = draft.build();

    if (hex !== binToHex(encodeTransaction(independent.transaction))) {
        throw disagreement('the issue transaction');
    }

    return { ...independent, transaction: decoded(hex) };
}

/** The signTransaction request body in relay-safe JSON form, for the engine-built issue transaction. */
export function buildIssueSignRequest(coin: Coin, voucherSatoshis: bigint, hash: Uint8Array) {
    const { transaction, sourceOutput } = buildIssue(coin, voucherSatoshis, hash);
    const input = transaction.inputs[0]!;

    return {
        transaction: binToHex(encodeTransaction(transaction)),
        sourceOutputs: [
            {
                outpointTransactionHash: binToHex(input.outpointTransactionHash),
                outpointIndex: input.outpointIndex,
                unlockingBytecode: '',
                sequenceNumber: input.sequenceNumber,
                valueSatoshis: `<bigint: ${sourceOutput.valueSatoshis}n>`,
                lockingBytecode: binToHex(sourceOutput.lockingBytecode),
            },
        ],
        broadcast: false,
        userPrompt: `XOGrid: lock ${voucherSatoshis} sats in a claim-code voucher. The network fee is ${ISSUE_FEE_SATOSHIS} sats; the rest returns to your own address.`,
    };
}

/**
 * Checks the wallet returned exactly the issue transaction we asked for, correctly signed. The engine's build is made
 * (and compared with the independent one) first; the comparison with what the wallet returned is core's.
 */
export function verifySignedIssue(coin: Coin, voucherSatoshis: bigint, hash: Uint8Array, signedHex: string): Verdict {
    buildIssue(coin, voucherSatoshis, hash);

    return independentVerifySignedIssue(coin, voucherSatoshis, hash, signedHex);
}

/** The claim transaction, built by the engine from the template's `claimVoucher` action. It needs no signature, only the code. */
export function buildClaim(voucher: VoucherCoin, code: Uint8Array, destination: Uint8Array) {
    const independent = independentBuildClaim(voucher, code, destination);
    const draft = draftInvitation('claimVoucher');
    const voucherInput: InvitationInputWithSpentOutputFields = {
        inputIdentifier: 'voucherInput',
        transactionIndex: 0,
        outpointTransactionHash: hexToBin(voucher.transactionHash),
        outpointIndex: voucher.outputIndex,
        sequenceNumber: independent.transaction.inputs[0]!.sequenceNumber,
        valueSatoshis: voucher.valueSatoshis,
    };

    draft.commit({ roleIdentifier: 'claimer' });
    const inputCommit = draft.commit({ inputs: [voucherInput] });
    draft.commit({ variables: [{ variableIdentifier: 'claimCode', value: binToHex(code), roleIdentifier: 'claimer' }] });
    // The input's unlocking bytecode, compiled from the template, filled into the input commit above (XO's mergesWith).
    draft.commit({ inputs: [{ mergesWith: { commitIdentifier: inputCommit, itemIndex: 0 }, unlockingBytecode: voucherUnlockingBytecode(code) }] });
    draft.commit({ outputs: [{ transactionIndex: 0, valueSatoshis: voucher.valueSatoshis - CLAIM_FEE_SATOSHIS, lockingBytecode: destination }] });

    const hex = draft.build();

    if (hex !== binToHex(encodeTransaction(independent.transaction))) {
        throw disagreement('the claim transaction');
    }

    return { transaction: decoded(hex), sourceOutput: { lockingBytecode: voucherLockingBytecode(codeHash(code)), valueSatoshis: voucher.valueSatoshis } };
}

/** Builds the claim with the engine and proves in the BCH virtual machine that it is valid before anything is broadcast. */
export function prepareClaim(voucher: VoucherCoin, code: Uint8Array, destination: Uint8Array): Verdict {
    const { transaction, sourceOutput } = buildClaim(voucher, code, destination);
    const result = createVirtualMachineBch2026().verify({ sourceOutputs: [sourceOutput], transaction });

    if (result !== true) {
        return { valid: false, reason: `the code does not unlock this voucher: ${String(result)}` };
    }

    const bytes = encodeTransaction(transaction);

    return { valid: true, transactionHex: binToHex(bytes), transactionId: binToHex(hash256(bytes).reverse()) };
}

