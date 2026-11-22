/**
 * Token Vault on CHIPNET (test coins and test tokens only), through the XO engine.
 *
 * The owner side runs in an XO wallet (the shared test wallet in templates/.xo-demo). Releases are built by the same
 * code as the template tools page (web/src/lib/token-vault-core.ts), saved as the invitation the page would hand out,
 * then imported into the wallet, signed as `owner` and broadcast, the way a user finishes them in their own wallet.
 *
 *     npx tsx token-vault/scripts/chipnet.ts mint            # test fungible tokens to the wallet (Libauth genesis)
 *     npx tsx token-vault/scripts/chipnet.ts lock            # XO action lock: a vault starting 10 blocks back, halving every 3
 *     npx tsx token-vault/scripts/chipnet.ts lock-page <address>  # the page's lock invitation from one address, completed by the wallet
 *     npx tsx token-vault/scripts/chipnet.ts finish <file>   # an invitation copied from the page, finished as the owner's wallet does
 *     npx tsx token-vault/scripts/chipnet.ts feecoin         # page-built addFeeCoin invitation, funded by the wallet
 *     npx tsx token-vault/scripts/chipnet.ts release [height] # page-built release invitation, signed by the wallet
 *     npx tsx token-vault/scripts/chipnet.ts status          # the vault's coins, state and fee coins
 *
 * LOCK_AMOUNT (default 5000), REWARD (default 1000), HALVING_LENGTH (default 3), START_HEIGHT (default: 10 blocks back)
 * and FEE_COIN_SATS (default 5000) set the vault. VAULT names the run (default token-vault), to keep more than one vault.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, cashAddressToLockingBytecode, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { getTemplateLockingScriptOrThrow, type Engine } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { deserializeInvitation, generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { createChipnetEngine, loadOrCreateMnemonic, signAndBroadcast } from '../../shared/chipnet-engine.js';
import { broadcastToChipnet, buildFungibleGenesis, findOutputIndex, getChipnetTipHeight, loadOrCreateMinterKey } from '../../shared/chipnet-tokens.js';
import { listUnspentCoins } from '../../web/src/lib/electrum.js';
import { createTokenVaultTools, readVaultRecord, type VaultRecord } from '../../web/src/lib/token-vault-core.js';

const mode = process.argv[2];
const FOLDER = join(import.meta.dirname, '..', '..', '.xo-demo');
const STATE_FILE = join(FOLDER, `${process.env.VAULT ?? 'token-vault'}.json`);
const FEE_COIN_SATS = BigInt(process.env.FEE_COIN_SATS ?? '5000');
const TEMPLATE_JSON = readFileSync(join(import.meta.dirname, '..', 'template.json'), 'utf8');
const SUPPLY = 1_000_000n;
const MINT_FUNDING_SATS = 3500n;

interface VaultRunState {
    mintFundingTransactionHash?: string;
    mintFundingOutputIndex?: number;
    genesisTransactionHash?: string;
    tokenCategory?: string;
    lockTransactionHash?: string;
    lockSerializedTransaction?: string;
    feeCoinTransactionHashes?: string[];
    releaseTransactionHashes?: string[];
}

const MODES = ['mint', 'lock', 'lock-page', 'finish', 'feecoin', 'release', 'status'];

if (!MODES.includes(mode ?? '')) {
    console.error(`Usage: chipnet.ts ${MODES.join(' | ')} [height]`);
    process.exit(1);
}

const step = (text: string): void => console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${text}`);
const readState = (): VaultRunState => (existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as VaultRunState) : {});
const writeState = (state: VaultRunState): void => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const template = parseTemplate(TEMPLATE_JSON);
const templateIdentifier = generateTemplateIdentifier(template);
const tools = createTokenVaultTools(template, templateIdentifier);

/** Pays `satoshis` from the wallet to `lockingBytecode` with the p2pkh template, and returns where the coin landed. */
async function payTo(engine: Engine, p2pkhIdentifier: string, lockingBytecode: Uint8Array, satoshis: bigint): Promise<{ transactionHash: string; outputIndex: number }> {
    const p2pkh = await engine.getTemplate(p2pkhIdentifier);
    const intent = p2pkh && getTemplateLockingScriptOrThrow(p2pkh, 'receivingLockingScript').roles?.receiver?.actions?.find((entry) => entry.action === 'sendSatoshis');
    const coins = (await engine.listSpendableUnspentOutputs())
        .filter((output) => output.tokenCategory === undefined)
        .sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)))
        .slice(0, 1);

    if (!intent || coins.length === 0 || BigInt(coins[0]!.valueSatoshis) < satoshis + 500n) {
        throw new Error(`Cannot pay ${satoshis} sats: no sendSatoshis intent or no single coin large enough.`);
    }

    const created = await engine.createInvitation({
        templateIdentifier: p2pkhIdentifier,
        actionIdentifier: 'sendSatoshis',
        intent,
        variables: [
            { variableIdentifier: 'transferredSatoshis', roleIdentifier: 'sender', value: satoshis },
            { variableIdentifier: 'recipientLockingscript', roleIdentifier: 'sender', value: binToHex(lockingBytecode) },
        ],
        inputs: coins.map((coin) => ({ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex })),
    });

    await engine.appendInvitation(created.invitation.invitationIdentifier, { templateIdentifier: p2pkhIdentifier, actionIdentifier: 'sendSatoshis', outputs: [{ outputIdentifier: 'transferSatoshisOutput' }] });

    const paid = await signAndBroadcast(engine, created.invitation.invitationIdentifier, { folder: FOLDER, label: 'token-vault-mint-funding' });

    if (!paid.serializedTransaction) {
        throw new Error('The engine did not return the funding transaction, so the output index is unknown.');
    }

    return { transactionHash: paid.transactionHash, outputIndex: findOutputIndex(paid.serializedTransaction, lockingBytecode) };
}

/** The vault record, read back from the lock transaction's OP_RETURN output. */
function recordOf(state: VaultRunState): VaultRecord {
    const transaction = state.lockSerializedTransaction && decodeTransactionBch(hexToBin(state.lockSerializedTransaction));

    if (!transaction || typeof transaction === 'string') {
        throw new Error('No lock transaction yet: run "lock" first.');
    }

    const record = transaction.outputs.map((output) => readVaultRecord(output.lockingBytecode)).find((found) => found !== undefined);

    if (!record) {
        throw new Error('The lock transaction has no vault record.');
    }

    return record;
}

/** Imports an invitation as the page hands it out, takes the owner role, and returns its identifier. */
async function importAsOwner(engine: Engine, serializedInvitation: string, label: string): Promise<string> {
    const file = join(FOLDER, `page-invitation-${label}.json`);

    writeFileSync(file, serializedInvitation);
    console.log(`  page invitation saved: ${file}`);

    const accepted = await engine.acceptInvitation(deserializeInvitation(serializedInvitation), { roleIdentifier: 'owner' });

    return accepted.invitation.invitationIdentifier;
}

/** Signs every input of an invitation this wallet can sign, in transaction order. */
async function signAll(engine: Engine, invitationIdentifier: string): Promise<void> {
    const built = await engine.buildInvitationTransactionFromMergedCommit(invitationIdentifier);
    const transaction = decodeTransactionBch(hexToBin(built.serializedTransaction));

    if (typeof transaction === 'string') {
        throw new Error(transaction);
    }

    for (let inputIndex = 0; inputIndex < transaction.inputs.length; inputIndex += 1) {
        await engine.signInvitation(invitationIdentifier, inputIndex);
    }
}

/** The wallet's part of a lock: add the vault's outputs for its new key, add change, sign every coin, broadcast. */
async function completeLock(engine: Engine, invitationIdentifier: string) {
    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'lock',
        outputs: ['feeCoinOutput', 'lockTokenOutput', 'lockStateOutput', 'vaultRecordOutput'].map((outputIdentifier) => ({ outputIdentifier, roleIdentifier: 'owner' })),
    });

    const leftover = await engine.calculateChange(invitationIdentifier);

    console.log(`  leftover ${leftover.valueSatoshis} sats and ${leftover.tokens.length} token kinds, estimated fee ${await engine.estimateTransactionFee(invitationIdentifier)}`);
    await engine.addChangeToInvitation(invitationIdentifier);
    await signAll(engine, invitationIdentifier);

    return signAndBroadcast(engine, invitationIdentifier, { folder: FOLDER, label: 'token-vault-lock-page', addChange: false, sign: false });
}

/** The wallet's part of a fee coin: add plain coins to pay for it (largest first), then change, sign and broadcast. */
async function completeFeeCoin(engine: Engine, invitationIdentifier: string, feeCoinSatoshis: bigint) {
    const plain = (await engine.listSpendableUnspentOutputs())
        .filter((output) => output.tokenCategory === undefined && output.reservedBy === undefined)
        .sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)));
    const coins: typeof plain = [];
    const total = (): bigint => coins.reduce((sum, chosen) => sum + BigInt(chosen.valueSatoshis), 0n);

    for (const coin of plain) {
        if (total() >= feeCoinSatoshis + 600n) {
            break;
        }

        coins.push(coin);
    }

    if (total() < feeCoinSatoshis + 600n) {
        throw new Error('Not enough plain BCH in the wallet to fund the fee coin.');
    }

    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'addFeeCoin',
        inputs: coins.map((coin) => ({ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex })),
    });

    return signAndBroadcast(engine, invitationIdentifier, { folder: FOLDER, label: 'token-vault-add-fee-coin' });
}

/** The wallet's part of a release: only signatures on the three inputs, then broadcast without change. */
async function completeRelease(engine: Engine, invitationIdentifier: string, actionIdentifier: string) {
    for (const inputIndex of [0, 1, 2]) {
        await engine.signInvitation(invitationIdentifier, inputIndex);
    }

    return signAndBroadcast(engine, invitationIdentifier, { folder: FOLDER, label: `token-vault-${actionIdentifier}`, addChange: false, sign: false });
}

const engine = await createChipnetEngine(loadOrCreateMnemonic(FOLDER), FOLDER);

try {
    const { templateIdentifier: p2pkhIdentifier } = await engine.importTemplate(serializeTemplate(p2pkhTemplate));

    await engine.setDefaultPolicies({
        change: { templateIdentifier: p2pkhIdentifier },
        receive: { templateIdentifier: p2pkhIdentifier },
        address: { templateIdentifier: p2pkhIdentifier },
    });
    await engine.importTemplate(TEMPLATE_JSON);
    console.log(`  Token Vault template ${templateIdentifier}`);

    const state = readState();

    if (mode === 'mint') {
        if (state.genesisTransactionHash) {
            throw new Error(`Already minted ${state.tokenCategory} in ${state.genesisTransactionHash}. Run "lock" next.`);
        }

        const minter = loadOrCreateMinterKey(FOLDER);
        const recipient = hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('receive'));

        if (state.mintFundingTransactionHash === undefined || state.mintFundingOutputIndex === undefined) {
            step(`Paying ${MINT_FUNDING_SATS} sats to the minter key`);

            const funding = await payTo(engine, p2pkhIdentifier, minter.lockingBytecode, MINT_FUNDING_SATS);

            state.mintFundingTransactionHash = funding.transactionHash;
            state.mintFundingOutputIndex = funding.outputIndex;
            writeState(state);
        }

        step(`Test token genesis from ${state.mintFundingTransactionHash}:${state.mintFundingOutputIndex}`);

        const genesis = buildFungibleGenesis({
            minter,
            coin: { transactionHash: state.mintFundingTransactionHash, outputIndex: state.mintFundingOutputIndex, valueSatoshis: MINT_FUNDING_SATS },
            tokenAmount: SUPPLY,
            tokenSatoshis: 1000n,
            tokenRecipient: recipient,
            changeRecipient: recipient,
        });

        state.genesisTransactionHash = await broadcastToChipnet(genesis.serializedTransaction);
        state.tokenCategory = genesis.category;
        writeState(state);
        console.log(`  BROADCAST ${state.genesisTransactionHash}\n  test token category ${genesis.category}: ${SUPPLY} tokens`);
        console.log('\nMINTED. Next:  npx tsx token-vault/scripts/chipnet.ts lock');
    } else if (mode === 'finish') {
        // An invitation copied from the page, finished the way the owner's XO wallet does.
        const file = process.argv[3];

        if (!file || !existsSync(file)) {
            throw new Error('Usage: chipnet.ts finish <invitation file copied from the page>');
        }

        const text = readFileSync(file, 'utf8').trim();
        const invitation = deserializeInvitation(text);
        const action = invitation.actionIdentifier;

        step(`Finishing the page’s ${action} invitation ${invitation.invitationIdentifier} as owner`);

        const invitationIdentifier = await importAsOwner(engine, text, `${action}-copied-${invitation.invitationIdentifier}`);

        if (action === 'lock') {
            if (state.lockTransactionHash) {
                throw new Error(`This run already locked ${state.lockTransactionHash}. Set VAULT to a new name.`);
            }

            const locked = await completeLock(engine, invitationIdentifier);

            state.lockTransactionHash = locked.transactionHash;
            state.lockSerializedTransaction = locked.serializedTransaction;
            writeState(state);
            console.log(`\nLOCKED ${locked.transactionHash}`);
        } else if (action === 'addFeeCoin') {
            const value = invitation.commits.flatMap((commit) => commit.data.variables ?? []).find((variable) => variable.variableIdentifier === 'feeCoinSatoshis')?.value;
            const funded = await completeFeeCoin(engine, invitationIdentifier, BigInt(value as bigint));

            state.feeCoinTransactionHashes = [...(state.feeCoinTransactionHashes ?? []), funded.transactionHash];
            writeState(state);
            console.log(`\nFEE COIN ${funded.transactionHash}:0`);
        } else {
            const released = await completeRelease(engine, invitationIdentifier, action);

            state.releaseTransactionHashes = [...(state.releaseTransactionHashes ?? []), released.transactionHash];
            writeState(state);
            console.log(`\nRELEASED ${released.transactionHash}`);
        }
    } else if (mode === 'lock-page') {
        // The page's lock: everything is read from one pasted address, as the page does.
        const address = process.argv[3];
        const decoded = address ? cashAddressToLockingBytecode(address) : 'no address';

        if (typeof decoded === 'string') {
            throw new Error(`Usage: chipnet.ts lock-page <address of this wallet holding the tokens and BCH> (${decoded})`);
        }

        if (state.lockTransactionHash) {
            throw new Error(`Already locked in ${state.lockTransactionHash}. Set VAULT to a new name.`);
        }

        state.tokenCategory ??= process.env.TOKEN_CATEGORY;

        if (!state.tokenCategory) {
            throw new Error('Set TOKEN_CATEGORY to the token to lock.');
        }

        const coins = await listUnspentCoins('chipnet', decoded.bytecode);
        const built = tools.buildLockInvitation({
            network: 'chipnet',
            coins: coins.coins,
            tokenCategory: state.tokenCategory,
            lockAmount: BigInt(process.env.LOCK_AMOUNT ?? '5000'),
            reward: BigInt(process.env.REWARD ?? '1000'),
            halvingLength: BigInt(process.env.HALVING_LENGTH ?? '3'),
            startHeight: BigInt(process.env.START_HEIGHT ?? coins.tipHeight),
            feeCoinSatoshis: FEE_COIN_SATS,
        });

        step(
            `Page lock from ${address}: ${built.plan.inputs.length} coins (${built.plan.inputSatoshis} sats), genesis ${built.plan.genesisCoin.transactionHash}:0, token change ${built.plan.tokenChange}`,
        );

        // What the owner's XO wallet does with the page's invitation: join as owner (generating the vault key), add the
        // vault's outputs (which makes it track the vault and the owner address), add change, sign every coin, broadcast.
        const locked = await completeLock(engine, await importAsOwner(engine, built.serializedInvitation, `lock-${built.invitationIdentifier}`));

        state.lockTransactionHash = locked.transactionHash;
        state.lockSerializedTransaction = locked.serializedTransaction;
        writeState(state);

        const record = recordOf(state);
        const { vaultLockingBytecode, ownerLockingBytecode } = tools.vaultScripts(record);

        console.log(`  vault ${tools.addressOf(vaultLockingBytecode, 'chipnet')}\n  owner ${tools.addressOf(ownerLockingBytecode, 'chipnet')}`);
        console.log(`\nLOCKED ${locked.transactionHash}`);
    } else if (mode === 'lock') {
        // TOKEN_CATEGORY reuses a test token the wallet already holds instead of minting one.
        state.tokenCategory ??= process.env.TOKEN_CATEGORY;

        if (!state.tokenCategory) {
            throw new Error('No test token yet: run "mint" first, or set TOKEN_CATEGORY to one the wallet holds.');
        }

        if (state.lockTransactionHash) {
            throw new Error(`Already locked in ${state.lockTransactionHash}.`);
        }

        writeState(state);

        const lockAmount = BigInt(process.env.LOCK_AMOUNT ?? '5000');
        const reward = BigInt(process.env.REWARD ?? '1000');
        const halvingLength = BigInt(process.env.HALVING_LENGTH ?? '3');
        const startHeight = BigInt(process.env.START_HEIGHT ?? (await getChipnetTipHeight()) - 10);
        const plainAtIndexZero = async () =>
            (await engine.listSpendableUnspentOutputs())
                .filter((output) => output.tokenCategory === undefined && output.outpointIndex === 0 && BigInt(output.valueSatoshis) >= FEE_COIN_SATS + 4000n)
                .sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)))[0];

        // The state NFT's genesis input must be a plain coin that is output 0 of its transaction. Make one by paying
        // the wallet itself when there is none.
        if (!(await plainAtIndexZero())) {
            step('No plain coin at output index 0: paying the wallet itself a coin for it');

            const self = await payTo(engine, p2pkhIdentifier, hexToBin(await engine.generateLockingBytecodeFromDefaultPolicy('receive')), FEE_COIN_SATS + 5000n);

            if (self.outputIndex !== 0) {
                throw new Error(`The self-payment landed at output ${self.outputIndex}, not 0. Run "lock" again.`);
            }

            for (let attempt = 0; attempt < 20 && !(await plainAtIndexZero()); attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        }

        const spendable = await engine.listSpendableUnspentOutputs();
        const tokenCoin = spendable.find((output) => output.tokenCategory === state.tokenCategory && output.tokenNftCapability === undefined && BigInt(output.tokenAmount ?? '0') >= lockAmount);
        const genesisCoin = await plainAtIndexZero();

        if (!tokenCoin || !genesisCoin) {
            throw new Error(`Need a coin with ${lockAmount} test tokens and a plain coin of FEE_COIN_SATS + 4000 sats at output index 0.`);
        }

        const intent = template.start?.find((entry) => entry.action === 'lock');

        if (!intent) {
            throw new Error('lock start intent not found.');
        }

        step(`Locking ${lockAmount} tokens (reward ${reward}, halving every ${halvingLength} blocks, from block ${startHeight}); state NFT genesis from ${genesisCoin.outpointTransactionHash}:0`);

        const owner = (variableIdentifier: string, value: bigint | string) => ({ variableIdentifier, roleIdentifier: 'owner', value });
        const created = await engine.createInvitation({
            templateIdentifier,
            actionIdentifier: 'lock',
            intent,
            variables: [
                owner('halvingLength', halvingLength),
                owner('lockTokenCategory', state.tokenCategory),
                owner('lockAmount', lockAmount),
                owner('startHeight', startHeight),
                owner('reward', reward),
                owner('stateCategory', genesisCoin.outpointTransactionHash),
                owner('feeCoinSatoshis', FEE_COIN_SATS),
            ],
            inputs: [tokenCoin, genesisCoin].map((coin) => ({ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex })),
        });

        // Tracked for the owner role: this wallet then watches the vault and the owner address and can sign releases.
        await engine.appendInvitation(created.invitation.invitationIdentifier, {
            templateIdentifier,
            actionIdentifier: 'lock',
            outputs: [
                { outputIdentifier: 'feeCoinOutput', roleIdentifier: 'owner' },
                { outputIdentifier: 'lockTokenOutput', roleIdentifier: 'owner' },
                { outputIdentifier: 'lockStateOutput', roleIdentifier: 'owner' },
                { outputIdentifier: 'vaultRecordOutput', roleIdentifier: 'owner' },
            ],
        });

        const locked = await signAndBroadcast(engine, created.invitation.invitationIdentifier, { folder: FOLDER, label: 'token-vault-lock' });

        state.lockTransactionHash = locked.transactionHash;
        state.lockSerializedTransaction = locked.serializedTransaction;
        writeState(state);

        const record = recordOf(state);
        const { vaultLockingBytecode, ownerLockingBytecode } = tools.vaultScripts(record);

        console.log(`  owner public key ${record.ownerPublicKey}\n  vault ${tools.addressOf(vaultLockingBytecode, 'chipnet')}\n  owner ${tools.addressOf(ownerLockingBytecode, 'chipnet')}`);
        console.log(`\nLOCKED ${locked.transactionHash}. Next:  npx tsx token-vault/scripts/chipnet.ts release`);
    } else {
        const record = recordOf(state);
        const { vaultLockingBytecode, ownerLockingBytecode } = tools.vaultScripts(record);
        const vaultCoins = await listUnspentCoins('chipnet', vaultLockingBytecode);
        const ownerCoins = await listUnspentCoins('chipnet', ownerLockingBytecode);
        const vault = tools.readVaultCoins(vaultCoins.coins);
        const feeCoins = tools.listFeeCoins(ownerCoins.coins);

        console.log(`  tip ${vaultCoins.tipHeight}; vault ${vault ? `${vault.tokenCoin.token.amount} tokens, state ${JSON.stringify(vault.state, (_k, v) => (typeof v === 'bigint' ? `${v}` : v))}` : 'empty'}`);
        console.log(`  fee coins: ${feeCoins.map((coin) => `${coin.transactionHash}:0 (${coin.valueSatoshis})`).join(', ') || 'none'}`);

        if (mode === 'feecoin') {
            const built = tools.buildAddFeeCoinInvitation({ network: 'chipnet', record, feeCoinSatoshis: FEE_COIN_SATS });

            step('Importing the page’s addFeeCoin invitation and funding it from the wallet');

            const invitationIdentifier = await importAsOwner(engine, built.serializedInvitation, `add-fee-coin-${built.invitationIdentifier}`);
            const plain = (await engine.listSpendableUnspentOutputs())
                .filter((output) => output.tokenCategory === undefined && output.reservedBy === undefined)
                .sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)));
            // Largest coins first, until they cover the fee coin and a miner fee.
            const coins: typeof plain = [];

            for (const coin of plain) {
                if (coins.reduce((sum, chosen) => sum + BigInt(chosen.valueSatoshis), 0n) >= FEE_COIN_SATS + 600n) {
                    break;
                }

                coins.push(coin);
            }

            if (coins.reduce((sum, chosen) => sum + BigInt(chosen.valueSatoshis), 0n) < FEE_COIN_SATS + 600n) {
                throw new Error('Not enough plain BCH in the wallet to fund the fee coin.');
            }

            await engine.appendInvitation(invitationIdentifier, {
                templateIdentifier,
                actionIdentifier: 'addFeeCoin',
                inputs: coins.map((coin) => ({ outpointTransactionHash: hexToBin(coin.outpointTransactionHash), outpointIndex: coin.outpointIndex })),
            });

            const funded = await signAndBroadcast(engine, invitationIdentifier, { folder: FOLDER, label: 'token-vault-add-fee-coin' });

            state.feeCoinTransactionHashes = [...(state.feeCoinTransactionHashes ?? []), funded.transactionHash];
            writeState(state);
            console.log(`\nFEE COIN ${funded.transactionHash}:0`);
        } else if (mode === 'release') {
            if (!vault) {
                throw new Error('The vault has no token and state coins.');
            }

            const feeCoin = feeCoins[0];

            if (!feeCoin) {
                throw new Error('No fee coin at the owner address: run "feecoin" first.');
            }

            const blockHeight = BigInt(process.argv[3] ?? vaultCoins.tipHeight);
            const built = tools.buildReleaseInvitation({ network: 'chipnet', record, vault, feeCoin, blockHeight, tipHeight: vaultCoins.tipHeight });

            step(`${built.actionIdentifier} up to block ${blockHeight}: ${built.plan.amount} tokens, ${built.plan.tokensLeft} left${built.plan.halving ? ' (halving)' : ''}`);

            const invitationIdentifier = await importAsOwner(engine, built.serializedInvitation, `${built.actionIdentifier}-${built.invitationIdentifier}`);

            // The owner signs all three inputs: the vault's two coins and the fee coin.
            for (const inputIndex of [0, 1, 2]) {
                await engine.signInvitation(invitationIdentifier, inputIndex);
            }

            const released = await signAndBroadcast(engine, invitationIdentifier, { folder: FOLDER, label: `token-vault-${built.actionIdentifier}`, addChange: false, sign: false });

            state.releaseTransactionHashes = [...(state.releaseTransactionHashes ?? []), released.transactionHash];
            writeState(state);
            console.log(`\nRELEASED ${released.transactionHash}`);
        }
    }
} finally {
    await engine.stop();
}
