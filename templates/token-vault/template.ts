/**
 * Token Vault: an XO template for TokenVault_Release by FoldingCash (https://github.com/foldingcash/smart-contracts).
 *
 * The vault holds fungible tokens and releases them on a schedule like Bitcoin's block reward: for every block that has
 * been mined since the last release, the owner may release `reward` tokens, and every `halvingLength` blocks the reward
 * halves (to at least 1). A state NFT next to the tokens records the last release height, the last halving height and
 * the reward. Only the owner can release, and the tokens always go to the owner's P2PKH address.
 *
 *     redeem script   <halvingLength> <ownerKey.public_key> vaultBytecode
 *     unlocking       <blockHeight> <ownerKey.schnorr_signature.all_outputs>
 *
 * CashScript pushes constructor arguments in reverse order (`fund` ends up on top) and the function's arguments the same
 * way (the signature ends up on top). The contract has one function, so there is no selector. The bytecode is the
 * deployed contract's, unchanged; test/template.test.ts proves the redeem script equals the CashScript contract's.
 *
 * Each release spends three coins and makes three outputs, in fixed places:
 *   input 0   the vault's tokens            output 0   the released tokens and the BCH change, to the owner's P2PKH
 *   input 1   the vault's state NFT         output 1   the tokens left, back to the vault
 *   input 2   a plain BCH coin at index 0   output 2   the new state NFT, back to the vault
 * The state NFT is immutable, so each release mints a new one: its category is input 2's transaction hash, which is
 * why input 2 must be output 0 of its transaction. The release that empties the vault (`releaseFinal`) pays everything
 * to the owner in a single output.
 *
 * The transaction's locktime is the release height: the contract checks `tx.time >= blockHeight`.
 *
 * Token fields (category, amount, NFT commitment) are evaluated by the engine as text, so the state commitments are
 * built as hex text with the helper scripts below. test/template.test.ts checks them against the contract's bytes.
 *
 * A token field's `$(…)` runs in the VM under the BCH 2026 operation cost limit (32,800 for an evaluation), and a wallet
 * that goes over it may write an empty field. So the 24 state bytes are turned into hex text in one pass of whole-string
 * shifts, masks and arithmetic rather than a loop over each digit. test/template.test.ts runs every commitment under that limit.
 *
 * Run `npm run template:json` after any change to regenerate template.json.
 */
import artifactJson from './artifact/TokenVault_Release.json' with { type: 'json' };
import { artifactAsmToCashAssembly } from '../shared/cashscript.js';

const noBalance = { satoshis: 0n, fungibleTokens: 0n, nonfungibleTokens: 0 as const };

/** The vault's settings, filled in by the owner's wallet or by the provider (the invitation tool). */
const lockVariables = ['halvingLength', 'lockTokenCategory', 'lockAmount', 'startHeight', 'reward', 'stateCategory', 'feeCoinSatoshis'];

/** What the provider (the invitation tool) fills in for a release. */
const releaseVariables = [
    'blockHeight',
    'halvingLength',
    'tokenCategory',
    'vaultTokenAmount',
    'vaultTokenSatoshis',
    'stateCategory',
    'vaultStateSatoshis',
    'releaseHeight',
    'halvingHeight',
    'reward',
    'feeCoinTransactionHash',
    'feeCoinSatoshis',
];

const ownerActions = [
    { action: 'release', role: 'owner', secrets: [{ ownerKey: null }] },
    { action: 'releaseFinal', role: 'owner', secrets: [{ ownerKey: null }] },
    { action: 'addFeeCoin', role: 'owner', secrets: [{ ownerKey: null }] },
];

const tokenVaultTemplate = {
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    name: 'Token Vault',
    description:
        'Lock fungible tokens in a vault that releases them on a schedule like Bitcoin’s block reward: a fixed number of tokens per block, halving every set number of blocks. Only the owner can release, and only to the owner’s address.',
    icon: 'vault',
    version: '1',
    supported: ['BCH_2023_05', 'BCH_2024_05', 'BCH_2025_05', 'BCH_2026_05'],
    resources: [
        {
            name: 'Original TokenVault_Release contract',
            description: 'TokenVault_Release.cash by FoldingCash (MIT), compiled with cashc 0.10.0-next.5. This template uses it unchanged.',
            url: 'https://github.com/foldingcash/smart-contracts/blob/0604bfbabc711a7a74af24b8535e71476922f7c0/TokenVault/TokenVault_Release.cash',
        },
        {
            name: 'Template, artifact and tests',
            description: 'This template, the rebuilt artifact and the tests that tie it to the contract.',
            url: 'https://github.com/XOGrid-Cash/Blaze2026_XOGrid/tree/main/templates/token-vault',
        },
    ],
    roles: {
        owner: {
            name: 'Owner',
            description: 'Locks the tokens and holds the vault’s key. Only the owner can release, and released tokens always come back to the owner.',
            icon: 'vault',
        },
        provider: {
            name: 'Provider',
            description: 'A tool that reads the vault from the chain and fills in a release for the owner to sign. It holds no keys and receives nothing.',
            icon: 'vault',
        },
    },
    start: [
        { action: 'lock', role: 'owner', generate: ['ownerKey'] },
        { action: 'lock', role: 'provider' },
        { action: 'release', role: 'provider' },
        { action: 'releaseFinal', role: 'provider' },
        { action: 'addFeeCoin', role: 'provider' },
    ],
    actions: {
        lock: {
            name: 'Lock tokens in a vault',
            description:
                'Lock $(<lockAmount>) tokens in a new vault that releases $(<reward>) tokens per block from block $(<startHeight>), halving every $(<halvingLength>) blocks.',
            icon: 'vault',
            roles: {
                provider: {
                    name: 'Fill in the vault',
                    description:
                        'Sets the vault’s schedule and picks the owner’s coins: the tokens to lock, and a coin at output index 0 of its transaction, whose hash becomes the state NFT’s category.',
                    icon: 'vault',
                    requirements: { variables: lockVariables },
                },
                owner: {
                    name: 'Create vault',
                    description:
                        'Generates the vault’s key and adds the vault’s outputs. Spend the tokens to lock, and a coin at output index 0 of its transaction: the vault’s state NFT takes that transaction’s hash as its category.',
                    icon: 'vault',
                    generate: ['ownerKey'],
                    requirements: { secrets: ['ownerKey'], variables: lockVariables },
                },
            },
            requirements: {
                participants: [
                    { role: 'provider', slots: { min: 0, max: 1 } },
                    { role: 'owner', slots: { min: 1, max: 1 } },
                ],
            },
            transaction: 'lockTransaction',
        },
        release: {
            name: 'Release tokens',
            description: 'Release $(releaseAmount) tokens from the vault, up to block $(nextReleaseHeight).',
            icon: 'vault',
            roles: {
                provider: {
                    name: 'Fill in the release',
                    description: 'Reads the vault’s coins and state, and picks a plain BCH coin at output index 0 of the owner’s address to pay the fee.',
                    icon: 'vault',
                    requirements: { variables: releaseVariables },
                },
                owner: {
                    name: 'Sign the release',
                    description: 'Signs the vault’s two coins and the fee coin. The tokens and the BCH change come back to you.',
                    icon: 'vault',
                    requirements: { secrets: ['ownerKey'] },
                },
            },
            requirements: {
                participants: [
                    { role: 'provider', slots: { min: 0, max: 1 } },
                    { role: 'owner', slots: { min: 1, max: 1 } },
                ],
            },
            transaction: 'releaseTransaction',
        },
        releaseFinal: {
            name: 'Release the last tokens',
            description: 'Release the vault’s last $(<vaultTokenAmount>) tokens and close it.',
            icon: 'vault',
            roles: {
                provider: {
                    name: 'Fill in the release',
                    description: 'Reads the vault’s coins and state, and picks a plain BCH coin at output index 0 of the owner’s address to pay the fee.',
                    icon: 'vault',
                    requirements: { variables: releaseVariables },
                },
                owner: {
                    name: 'Sign the release',
                    description: 'Signs the vault’s two coins and the fee coin. Everything left comes back to you in one output.',
                    icon: 'vault',
                    requirements: { secrets: ['ownerKey'] },
                },
            },
            requirements: {
                participants: [
                    { role: 'provider', slots: { min: 0, max: 1 } },
                    { role: 'owner', slots: { min: 1, max: 1 } },
                ],
            },
            transaction: 'releaseFinalTransaction',
        },
        addFeeCoin: {
            name: 'Add a fee coin',
            description: 'Send $(<feeCoinSatoshis>) satoshis to the vault owner’s address as output 0, ready to pay for the next release.',
            icon: 'vault',
            roles: {
                provider: {
                    name: 'Fill in the fee coin',
                    description: 'Names the owner’s address and the amount.',
                    icon: 'vault',
                    requirements: { variables: ['feeCoinSatoshis'] },
                },
                owner: {
                    name: 'Fund the fee coin',
                    description: 'Pays for the coin from your wallet. It must stay output 0 of the transaction.',
                    icon: 'vault',
                },
            },
            requirements: {
                participants: [
                    { role: 'provider', slots: { min: 0, max: 1 } },
                    { role: 'owner', slots: { min: 1, max: 1 } },
                ],
            },
            transaction: 'addFeeCoinTransaction',
        },
    },
    transactions: {
        lockTransaction: {
            name: 'Tokens locked',
            description: '$(<lockAmount>) tokens were locked in a vault.',
            icon: 'vault',
            inputs: [],
            outputs: [
                { output: 'feeCoinOutput', outputIndex: 0 },
                { output: 'lockTokenOutput', outputIndex: 1 },
                { output: 'lockStateOutput', outputIndex: 2 },
                { output: 'vaultRecordOutput', outputIndex: 3 },
            ],
            version: 2,
            locktime: 0,
            composable: true,
        },
        // The contract fixes the layout: exactly three inputs, and exactly three outputs (one when the vault closes). So
        // the engine must not add change: the fee coin's change is part of output 0.
        releaseTransaction: {
            name: 'Tokens released',
            description: '$(releaseAmount) tokens were released from the vault.',
            icon: 'vault',
            inputs: [
                { input: 'vaultTokenInput', inputIndex: 0 },
                { input: 'vaultStateInput', inputIndex: 1 },
                { input: 'feeCoinInput', inputIndex: 2 },
            ],
            outputs: [
                { output: 'releasedOutput', outputIndex: 0 },
                { output: 'vaultTokenOutput', outputIndex: 1 },
                { output: 'vaultStateOutput', outputIndex: 2 },
            ],
            version: 2,
            locktime: '$(<blockHeight>)',
            composable: false,
        },
        releaseFinalTransaction: {
            name: 'Vault closed',
            description: 'The vault’s last $(<vaultTokenAmount>) tokens were released.',
            icon: 'vault',
            inputs: [
                { input: 'vaultTokenInput', inputIndex: 0 },
                { input: 'vaultStateInput', inputIndex: 1 },
                { input: 'feeCoinInput', inputIndex: 2 },
            ],
            outputs: [{ output: 'finalOutput', outputIndex: 0 }],
            version: 2,
            locktime: '$(<blockHeight>)',
            composable: false,
        },
        addFeeCoinTransaction: {
            name: 'Fee coin added',
            description: '$(<feeCoinSatoshis>) satoshis were sent to the vault owner’s address for the next release.',
            icon: 'vault',
            inputs: [],
            outputs: [{ output: 'feeCoinOutput', outputIndex: 0 }],
            version: 2,
            locktime: 0,
            composable: true,
        },
    },
    outputs: {
        feeCoinOutput: {
            name: 'Fee coin',
            description: '$(<feeCoinSatoshis>) satoshis at the owner’s address, output 0, to pay for a release.',
            icon: 'vault',
            lockingScript: 'ownerLockingScript',
            valueSatoshis: '$(checkFeeCoin <feeCoinSatoshis>)',
            token: null,
        },
        lockTokenOutput: {
            name: 'Vault tokens',
            description: '$(<lockAmount>) tokens locked in the vault.',
            icon: 'vault',
            lockingScript: 'vaultLockingScript',
            valueSatoshis: '$(<vaultCoinSatoshis>)',
            token: { category: '$(<lockTokenCategory>)', amount: '$(checkLock <lockAmount>)', nft: null },
        },
        lockStateOutput: {
            name: 'Vault state',
            description: 'The vault’s state NFT: release from block $(<startHeight>) at $(<reward>) tokens per block.',
            icon: 'vault',
            lockingScript: 'vaultLockingScript',
            valueSatoshis: '$(<vaultCoinSatoshis>)',
            token: { category: '$(<stateCategory>)', amount: null, nft: { capability: 'none', commitment: '$(initialStateCommitment)' } },
        },
        vaultRecordOutput: {
            name: 'Vault record',
            description: 'A 0-satoshi data output with the owner’s public key and the halving length, so tools can find and rebuild the vault.',
            icon: 'vault',
            lockingScript: 'vaultRecordLockingScript',
            valueSatoshis: '$(<0>)',
            token: null,
        },
        releasedOutput: {
            name: 'Released tokens',
            description: '$(releaseAmount) tokens and the fee coin’s change, to the owner.',
            icon: 'vault',
            lockingScript: 'ownerLockingScript',
            valueSatoshis: '$(checkRelease checkMoreLeft <feeCoinSatoshis> <releaseMinerFeeSatoshis> OP_SUB)',
            token: { category: '$(<tokenCategory>)', amount: '$(releaseAmount)', nft: null },
        },
        vaultTokenOutput: {
            name: 'Vault tokens',
            description: 'The $(tokensLeft) tokens left, back to the vault.',
            icon: 'vault',
            lockingScript: 'vaultLockingScript',
            valueSatoshis: '$(<vaultTokenSatoshis>)',
            token: { category: '$(<tokenCategory>)', amount: '$(tokensLeft)', nft: null },
        },
        vaultStateOutput: {
            name: 'Vault state',
            description: 'The new state NFT: released up to block $(nextReleaseHeight), $(nextReward) tokens per block.',
            icon: 'vault',
            lockingScript: 'vaultLockingScript',
            valueSatoshis: '$(<vaultStateSatoshis>)',
            token: { category: '$(<feeCoinTransactionHash>)', amount: null, nft: { capability: 'none', commitment: '$(nextStateCommitment)' } },
        },
        finalOutput: {
            name: 'Last tokens',
            description: 'The vault’s last $(<vaultTokenAmount>) tokens and all the BCH, to the owner.',
            icon: 'vault',
            lockingScript: 'ownerLockingScript',
            valueSatoshis: '$(checkRelease checkNoneLeft <vaultTokenSatoshis> <vaultStateSatoshis> OP_ADD <feeCoinSatoshis> OP_ADD <releaseMinerFeeSatoshis> OP_SUB)',
            token: { category: '$(<tokenCategory>)', amount: '$(<vaultTokenAmount>)', nft: null },
        },
    },
    inputs: {
        vaultTokenInput: {
            name: 'Vault tokens',
            description: 'The vault’s $(<vaultTokenAmount>) tokens, at input 0.',
            icon: 'vault',
            valueSatoshis: '$(<vaultTokenSatoshis>)',
            token: { category: '$(<tokenCategory>)', amount: '$(<vaultTokenAmount>)', nft: null },
            // Not final, so the transaction's locktime (the release height) is enforced: the contract checks tx.time.
            sequenceNumber: 0,
            unlockingScript: 'unlockRelease',
        },
        vaultStateInput: {
            name: 'Vault state',
            description: 'The vault’s state NFT, at input 1. It must come from the same transaction as the vault’s tokens.',
            icon: 'vault',
            valueSatoshis: '$(<vaultStateSatoshis>)',
            token: { category: '$(<stateCategory>)', amount: null, nft: { capability: 'none', commitment: '$(stateCommitment)' } },
            sequenceNumber: 0,
            unlockingScript: 'unlockRelease',
        },
        feeCoinInput: {
            name: 'Fee coin',
            description: 'A plain BCH coin at the owner’s address, at input 2. It must be output 0 of its transaction.',
            icon: 'vault',
            valueSatoshis: '$(<feeCoinSatoshis>)',
            token: null,
            sequenceNumber: 0,
            unlockingScript: 'unlockOwner',
        },
    },
    lockingScripts: {
        vaultLockingScript: {
            name: 'Token vault',
            description: 'The TokenVault_Release contract, holding the vault’s tokens and its state NFT.',
            icon: 'vault',
            lockingType: 'p2sh',
            lockingBytecode: 'vaultRedeem',
            unlockingBytecode: 'unlockRelease',
            state: { variables: ['halvingLength'] },
            actions: [],
            // The vault's tokens are not the wallet's to spend freely: only a release can move them.
            balance: noBalance,
            selectable: false,
            roles: {
                owner: {
                    state: { variables: ['halvingLength'], secrets: ['ownerKey'] },
                    actions: ownerActions,
                    balance: noBalance,
                    selectable: false,
                },
            },
        },
        ownerLockingScript: {
            name: 'Vault owner address',
            description: 'The P2PKH address of the vault’s key. The contract releases tokens only here.',
            icon: 'vault',
            lockingType: 'p2s',
            lockingBytecode: 'ownerLockingBytecode',
            unlockingBytecode: 'unlockOwner',
            actions: [],
            roles: {
                owner: {
                    state: { variables: [], secrets: ['ownerKey'] },
                    actions: ownerActions,
                    // Released tokens and fee coins are the owner's own funds.
                    balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true },
                    selectable: true,
                },
            },
        },
        vaultRecordLockingScript: {
            name: 'Vault record',
            description: 'An unspendable data output naming the vault’s public key and halving length.',
            icon: 'vault',
            lockingType: 'p2s',
            lockingBytecode: 'vaultRecord',
            actions: [],
            balance: noBalance,
            selectable: false,
            // The owner's wallet compiles the record with its key; the output is unspendable, so it is not tracked.
            roles: { owner: { relevant: false } },
        },
    },
    scripts: {
        // The deployed bytecode, unchanged.
        vaultBytecode: artifactAsmToCashAssembly(artifactJson.bytecode),
        vaultRedeem: '<halvingLength> <ownerKey.public_key> vaultBytecode',
        unlockRelease: '<blockHeight> <ownerKey.schnorr_signature.all_outputs>',
        ownerLockingBytecode: 'OP_DUP OP_HASH160 <$(<ownerKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
        unlockOwner: '<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key>',
        // OP_RETURN "TVLT" <owner public key> <halving length>
        vaultRecord: 'OP_RETURN <0x54564c54> <ownerKey.public_key> <halvingLength>',

        // The contract's maths, which the template always uses exactly.
        isHalving: '<blockHeight> <halvingHeight> OP_SUB OP_1ADD <halvingLength> OP_GREATERTHANOREQUAL',
        halvingAt: '<halvingHeight> <halvingLength> OP_ADD',
        releasedBlocks: 'isHalving OP_IF halvingAt <releaseHeight> OP_SUB OP_ELSE <blockHeight> <releaseHeight> OP_SUB OP_1ADD OP_ENDIF',
        releaseAmount: 'releasedBlocks <reward> OP_MUL',
        tokensLeft: '<vaultTokenAmount> releaseAmount OP_SUB',
        nextReleaseHeight: 'isHalving OP_IF halvingAt OP_ELSE <blockHeight> OP_ENDIF',
        nextHalvingHeight: 'isHalving OP_IF halvingAt OP_ELSE <halvingHeight> OP_ENDIF',
        nextReward: 'isHalving OP_IF <reward> <2> OP_DIV OP_1 OP_MAX OP_ELSE <reward> OP_ENDIF',

        // Guards: each fails, so the engine refuses to build the output, instead of the contract rejecting the spend.
        checkHalvingLength: '<halvingLength> OP_1 <maximumHeight> OP_1ADD OP_WITHIN OP_VERIFY',
        checkLock:
            'checkHalvingLength ' +
            '<lockAmount> OP_0 OP_GREATERTHAN OP_VERIFY ' +
            '<reward> OP_1 <lockAmount> OP_1ADD OP_WITHIN OP_VERIFY ' +
            '<startHeight> OP_0 <maximumHeight> OP_1ADD OP_WITHIN OP_VERIFY',
        checkFeeCoin: '<feeCoinSatoshis> <minimumFeeCoinSatoshis> OP_GREATERTHANOREQUAL OP_VERIFY',
        checkRelease:
            'checkHalvingLength ' +
            '<releaseHeight> <halvingHeight> OP_GREATERTHANOREQUAL OP_VERIFY ' +
            '<halvingHeight> OP_0 OP_GREATERTHANOREQUAL OP_VERIFY ' +
            '<reward> OP_0 OP_GREATERTHAN OP_VERIFY ' +
            '<blockHeight> <releaseHeight> OP_GREATERTHAN OP_VERIFY ' +
            '<blockHeight> <maximumHeight> OP_LESSTHANOREQUAL OP_VERIFY ' +
            'checkFeeCoin',
        checkMoreLeft: 'tokensLeft OP_0 OP_GREATERTHAN OP_VERIFY',
        checkNoneLeft: 'tokensLeft OP_0 OP_LESSTHANOREQUAL OP_VERIFY',

        // State commitments, as hex text: three 8-byte little-endian numbers (the contract's bytes8), 48 characters.
        initialStateCommitment: '<startHeight> <8> OP_NUM2BIN OP_DUP OP_CAT <reward> <8> OP_NUM2BIN OP_CAT bytes24HexText',
        stateCommitment: '<releaseHeight> <8> OP_NUM2BIN <halvingHeight> <8> OP_NUM2BIN OP_CAT <reward> <8> OP_NUM2BIN OP_CAT bytes24HexText',
        nextStateCommitment: 'nextReleaseHeight <8> OP_NUM2BIN nextHalvingHeight <8> OP_NUM2BIN OP_CAT nextReward <8> OP_NUM2BIN OP_CAT bytes24HexText',

        // 24 bytes to their 48-character hex text, with whole-string steps rather than a loop over each digit (whose
        // cost would go over the limit). Padded to 64 bytes, byte i moves to position 2i in five shift-and-mask rounds;
        // the even copies keep the high nibble (shifted down) and the next position gets the low nibble, so each byte
        // holds one digit (0-15); adding 48, plus 39 more where the digit is 10 or above, makes '0'-'9' and 'a'-'f'.
        bytes24HexText:
            '<0x00000000000000000000000000000000000000000000000000000000000000000000000000000000> OP_CAT ' +
            'OP_DUP <0x00000000000000000000000000000000> OP_SWAP OP_CAT <64> OP_SPLIT OP_DROP OP_OR <0xffffffffffffffffffffffffffffffff00000000000000000000000000000000ffffffffffffffffffffffffffffffff00000000000000000000000000000000> OP_AND ' +
            'OP_DUP <0x0000000000000000> OP_SWAP OP_CAT <64> OP_SPLIT OP_DROP OP_OR <0xffffffffffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff0000000000000000> OP_AND ' +
            'OP_DUP <0x00000000> OP_SWAP OP_CAT <64> OP_SPLIT OP_DROP OP_OR <0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff00000000> OP_AND ' +
            'OP_DUP <0x0000> OP_SWAP OP_CAT <64> OP_SPLIT OP_DROP OP_OR <0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000> OP_AND ' +
            'OP_DUP <0x00> OP_SWAP OP_CAT <64> OP_SPLIT OP_DROP OP_OR <0xff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00> OP_AND ' +
            'OP_DUP <0xf000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000> OP_AND <0x00> OP_CAT OP_BIN2NUM <16> OP_DIV ' +
            'OP_SWAP <0x0f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f000f00> OP_AND <0x00> OP_SWAP OP_CAT <64> OP_SPLIT OP_DROP <0x00> OP_CAT OP_BIN2NUM OP_ADD ' +
            'OP_DUP <0x06060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606060606> OP_ADD <16> OP_DIV <64> OP_NUM2BIN <0x01010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101> OP_AND <0x00> OP_CAT OP_BIN2NUM ' +
            '<39> OP_MUL OP_ADD <0x30303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030> OP_ADD <64> OP_NUM2BIN <48> OP_SPLIT OP_DROP',
    },
    constants: {
        maximumHeight: {
            name: 'Largest block height',
            description: 'Block heights and the halving length stay below 500,000,000, where a locktime turns into a timestamp.',
            type: 'integer',
            value: 500000000n,
        },
        vaultCoinSatoshis: { name: 'Vault coin satoshis', description: 'The satoshis on each of the vault’s two coins when it is created.', type: 'satoshis', value: 1000n },
        minimumFeeCoinSatoshis: {
            name: 'Smallest fee coin',
            description: 'A fee coin must cover the release’s miner fee and leave at least 546 satoshis on the owner’s output.',
            type: 'satoshis',
            value: 3000n,
        },
        releaseMinerFeeSatoshis: {
            name: 'Release fee to miners',
            description: 'The miner fee of a release: about 1.6 satoshis per byte of its ~1,250 signed bytes.',
            type: 'satoshis',
            value: 2000n,
        },
    },
    variables: {
        ownerKey: { name: 'Vault key', description: 'The key that owns the vault: it signs every release and receives the tokens.', type: 'private_key' },
        halvingLength: { name: 'Halving length', description: 'The number of blocks between halvings of the reward, from 1 to 500,000,000.', type: 'integer' },
        lockTokenCategory: { name: 'Token to lock', description: 'The category of the fungible token to lock.', type: 'token_category' },
        lockAmount: { name: 'Amount to lock', description: 'How many tokens to lock in the vault.', type: 'token_amount' },
        startHeight: { name: 'Start block', description: 'The block from which tokens can be released.', type: 'integer' },
        reward: { name: 'Reward per block', description: 'Tokens released per block (before halvings), from 1 to the amount locked.', type: 'token_amount' },
        stateCategory: {
            name: 'State NFT category',
            description: 'The category of the vault’s state NFT: when locking, the transaction hash of a coin spent at output index 0 of its transaction.',
            type: 'token_category',
        },
        feeCoinSatoshis: { name: 'Fee coin value', description: 'The satoshis on the fee coin.', type: 'satoshis' },
        blockHeight: { name: 'Release up to block', description: 'The block to release up to: at most the current block, and after the last release.', type: 'integer' },
        tokenCategory: { name: 'Vault token', description: 'The category of the tokens in the vault.', type: 'token_category' },
        vaultTokenAmount: { name: 'Tokens in the vault', description: 'The tokens on the vault’s token coin now.', type: 'token_amount' },
        vaultTokenSatoshis: { name: 'Vault token coin satoshis', description: 'The satoshis on the vault’s token coin now.', type: 'satoshis' },
        vaultStateSatoshis: { name: 'Vault state coin satoshis', description: 'The satoshis on the vault’s state NFT coin now.', type: 'satoshis' },
        releaseHeight: { name: 'Last release', description: 'The block the vault last released up to, from its state NFT.', type: 'integer' },
        halvingHeight: { name: 'Last halving', description: 'The block of the vault’s last halving, from its state NFT.', type: 'integer' },
        feeCoinTransactionHash: {
            name: 'Fee coin transaction',
            description: 'The transaction hash of the fee coin. The new state NFT takes it as its category.',
            type: 'token_category',
        },
    },
};

export { tokenVaultTemplate };
