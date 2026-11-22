/**
 * Builds XO invitations in the browser, signed by a throwaway key.
 *
 * Each invitation gets a fresh random signing identity that holds no funds. Its only job is to sign the invitation's
 * commits, which XO requires. The wallet that imports the invitation adds nothing of its own when the spend needs no
 * wallet coins or signatures (a Drip Mine drip, for example).
 *
 * Before anything is handed out, the finished invitation is parsed back from its serialized form (exactly what the user
 * copies), checked by XO's own validation, built into a transaction by XO, and verified by the BCH 2026 VM.
 */
import { createVirtualMachineBch2026, decodeTransactionBch, hexToBin, type Output, type TransactionBch } from '@bitauth/libauth';
import { Crypto } from '@xo-cash/crypto';
import {
    InvitationBuilder,
    buildInvitationTransactionFromMergedCommit,
    listInvitationValidationIssues,
    mergeInvitationCommits,
    resolveHdKeyNetwork,
    type XONetwork,
} from '@xo-cash/engine';
import { deserializeInvitation, serializeInvitation } from '@xo-cash/utils';

export type Network = Extract<XONetwork, 'mainnet' | 'chipnet'>;

type Template = Parameters<typeof mergeInvitationCommits>[1];
type Invitation = ReturnType<InvitationBuilder['build']>;
type CommitParameters = Parameters<InvitationBuilder['createUnsignedCommit']>[0];

/** An invitation being built: `commit` signs and appends one commit and returns its identifier. */
export interface InvitationDraft {
    builder: InvitationBuilder;
    commit: (parameters: CommitParameters) => string;
    /** The invitation so far, as XO extended JSON. */
    serialize: () => string;
}

export interface FinishedInvitation {
    /** The XO extended-JSON invitation, ready to paste into an XO wallet. */
    serializedInvitation: string;
    invitationIdentifier: string;
    transactionHash: string;
    serializedTransaction: string;
    transactionByteLength: number;
    transaction: TransactionBch;
    /** When the earliest commit expires; the wallet must import the invitation before then. */
    expiresAt: Date;
}

/** Thrown when XO validation, XO's transaction builder or the VM rejects an invitation. */
export class InvitationCheckError extends Error {
    constructor(
        message: string,
        public readonly details: string[] = [],
    ) {
        super(details.length > 0 ? `${message}\n${details.join('\n')}` : message);
        this.name = 'InvitationCheckError';
    }
}

export function startInvitation(parameters: { templateIdentifier: string; actionIdentifier: string; network: Network }): InvitationDraft {
    const { templateIdentifier, actionIdentifier, network } = parameters;
    const signer = new Crypto(globalThis.crypto.getRandomValues(new Uint8Array(64)), { network: resolveHdKeyNetwork(network) });
    const builder = new InvitationBuilder({ templateIdentifier, actionIdentifier }, network);
    let rootCommitIdentifier: string | undefined;

    const commit = (commitParameters: CommitParameters): string => {
        const invitationCommit = builder.createUnsignedCommit(commitParameters);

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

    return { builder, commit, serialize: () => serializeInvitation(builder.build()) };
}

export interface UnsignedInvitation {
    serializedInvitation: string;
    invitationIdentifier: string;
    /** The transaction XO builds from the invitation, with placeholder unlocking bytecode where signatures will go. */
    transaction: TransactionBch;
    expiresAt: Date;
}

/**
 * Checks an invitation the importing wallet still has to complete (add its keys, outputs and change, and sign): XO's
 * validation must pass. Nothing more can be built until the wallet has added its part.
 */
export function checkIncompleteInvitation(parameters: { draft: InvitationDraft; template: Template; network: Network }): Omit<UnsignedInvitation, 'transaction'> {
    const { draft, template, network } = parameters;
    const serializedInvitation = draft.serialize();
    const invitation: Invitation = deserializeInvitation(serializedInvitation);
    const issues = listInvitationValidationIssues(invitation, template, network);

    if (issues.length > 0) {
        throw new InvitationCheckError('XO rejected the invitation.', issues.map((issue) => `${issue.name}: ${issue.message}`));
    }

    return {
        serializedInvitation,
        invitationIdentifier: invitation.invitationIdentifier,
        expiresAt: new Date(Math.min(...invitation.commits.map((commit) => Number(commit.expiresAtTimestamp)))),
    };
}

/**
 * Checks an invitation the importing wallet still has to sign. XO's validation must pass and XO must build the
 * transaction; the VM can't run until the signatures exist, so callers check the built outputs themselves.
 */
export function checkUnsignedInvitation(parameters: { draft: InvitationDraft; template: Template; actionIdentifier: string; network: Network }): UnsignedInvitation {
    const { draft, template, actionIdentifier, network } = parameters;
    const serializedInvitation = draft.serialize();
    const invitation: Invitation = deserializeInvitation(serializedInvitation);
    const issues = listInvitationValidationIssues(invitation, template, network);

    if (issues.length > 0) {
        throw new InvitationCheckError('XO rejected the invitation.', issues.map((issue) => `${issue.name}: ${issue.message}`));
    }

    const built = buildInvitationTransactionFromMergedCommit(mergeInvitationCommits(invitation, template), template, actionIdentifier);
    const transaction = decodeTransactionBch(hexToBin(built.serializedTransaction));

    if (typeof transaction === 'string') {
        throw new InvitationCheckError('XO built a transaction that does not decode.', [transaction]);
    }

    return {
        serializedInvitation,
        invitationIdentifier: invitation.invitationIdentifier,
        transaction,
        expiresAt: new Date(Math.min(...invitation.commits.map((commit) => Number(commit.expiresAtTimestamp)))),
    };
}

/**
 * Checks a drafted invitation end to end and returns what the user copies.
 * `sourceOutputs` are the coins the transaction spends, in input order, for the VM check.
 */
export function finishInvitation(parameters: {
    draft: InvitationDraft;
    template: Template;
    actionIdentifier: string;
    network: Network;
    sourceOutputs: Output[];
}): FinishedInvitation {
    const { draft, template, actionIdentifier, network, sourceOutputs } = parameters;
    const serializedInvitation = serializeInvitation(draft.builder.build());
    // Check the copy the user gets, not the builder's in-memory object.
    const invitation: Invitation = deserializeInvitation(serializedInvitation);
    const issues = listInvitationValidationIssues(invitation, template, network);

    if (issues.length > 0) {
        throw new InvitationCheckError('XO rejected the invitation.', issues.map((issue) => `${issue.name}: ${issue.message}`));
    }

    const built = buildInvitationTransactionFromMergedCommit(mergeInvitationCommits(invitation, template), template, actionIdentifier);
    const transaction = decodeTransactionBch(hexToBin(built.serializedTransaction));

    if (typeof transaction === 'string') {
        throw new InvitationCheckError('XO built a transaction that does not decode.', [transaction]);
    }

    const verified = createVirtualMachineBch2026().verify({ sourceOutputs, transaction });

    if (verified !== true) {
        throw new InvitationCheckError('The VM rejected the transaction.', [verified]);
    }

    return {
        serializedInvitation,
        invitationIdentifier: invitation.invitationIdentifier,
        transactionHash: built.transactionHash,
        serializedTransaction: built.serializedTransaction,
        transactionByteLength: built.transactionByteLength,
        transaction,
        expiresAt: new Date(Math.min(...invitation.commits.map((commit) => Number(commit.expiresAtTimestamp)))),
    };
}
