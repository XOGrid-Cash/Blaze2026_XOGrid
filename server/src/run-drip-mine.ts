import {
    binToHex,
    cashAssemblyToBin,
    createVirtualMachineBch2026,
    encodeDataPush,
    encodeLockingBytecodeP2sh32,
    encodeTransaction,
    hash256,
    hexToBin,
    lockingBytecodeToCashAddress,
    type TransactionCommon,
} from '@bitauth/libauth';
import { DEFAULT_ELECTRUM, ElectrumServer, FailoverChain, parseEndpoints, type ChainSource, type Unspent } from './electrum.js';
import { RegistryError } from './registry.js';
import { transactionHashOf } from './review-receipt.js';

/**
 * Live runs of the Drip Mine template (templates/drip-mine). A Drip Mine coin needs no signature and no wallet: anyone
 * can spend it once it is a block old. So XOGrid builds the transaction from a coin that already sits at the shared
 * address, checks it against the contract in the BCH 2026 virtual machine, and only then broadcasts it. Nothing here
 * touches a visitor's keys or funds. The payout goes to the miner as the transaction fee.
 */

export type RunNetwork = 'mainnet' | 'chipnet';

export const isRunNetwork = (value: unknown): value is RunNetwork => value === 'mainnet' || value === 'chipnet';

/** The contract, copied from templates/drip-mine/template.json (scripts.dripMineBytecode). A test ties it to the live address. */
const DRIP_MINE_SCRIPT =
    'OP_1 OP_CHECKSEQUENCEVERIFY OP_DROP OP_TXINPUTCOUNT OP_1 OP_NUMEQUALVERIFY OP_TXOUTPUTCOUNT OP_1 OP_NUMEQUALVERIFY <0x4002> <0xa400> OP_INPUTINDEX OP_UTXOVALUE OP_ROT OP_2 OP_PICK OP_ADD OP_GREATERTHAN OP_IF OP_INPUTINDEX OP_UTXOBYTECODE OP_INPUTINDEX OP_OUTPUTBYTECODE OP_EQUALVERIFY OP_INPUTINDEX OP_UTXOVALUE <0x2811> OP_MUL <0xc685744f> OP_DIV OP_2DUP OP_GREATERTHAN OP_IF OP_OVER OP_NIP OP_ENDIF OP_INPUTINDEX OP_UTXOVALUE OP_INPUTINDEX OP_OUTPUTVALUE OP_SUB OP_2DUP OP_GREATERTHANOREQUAL OP_VERIFY OP_2DROP OP_ELSE OP_INPUTINDEX OP_OUTPUTVALUE OP_0 OP_NUMEQUALVERIFY OP_INPUTINDEX OP_OUTPUTBYTECODE <0x6a> OP_EQUALVERIFY OP_ENDIF OP_DROP OP_1';

/** The template's constants (dustLimit, minPayout, decayNumerator, decayDenominator). */
const DUST_LIMIT = 576n;
const MIN_PAYOUT = 164n;
const DECAY_NUMERATOR = 4392n;
const DECAY_DENOMINATOR = 1333036486n;

/** Coins of this value or less can only be terminated: a drip would leave less than dust behind. */
export const TERMINATE_AT_OR_BELOW = DUST_LIMIT + MIN_PAYOUT;
/** The most coins one lookup returns. */
const MAX_COINS = 50;

const compiled = cashAssemblyToBin(DRIP_MINE_SCRIPT);

if (typeof compiled === 'string') {
    throw new Error(`The Drip Mine contract does not compile: ${compiled}`);
}

export const dripMineLockingBytecode = encodeLockingBytecodeP2sh32(hash256(compiled));
/** P2SH32 unlocking: the contract takes no arguments, so this is only the redeem script push. */
const dripMineUnlockingBytecode = encodeDataPush(compiled);
const TERMINAL_LOCKING_BYTECODE = hexToBin('6a');

export function dripMineAddress(network: RunNetwork): string {
    const encoded = lockingBytecodeToCashAddress({ bytecode: dripMineLockingBytecode, prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest' });

    if (typeof encoded === 'string') {
        throw new Error(`The Drip Mine address could not be encoded: ${encoded}`);
    }

    return encoded.address;
}

export type DripAction = 'drip' | 'terminate';

export const dripActionFor = (satoshis: bigint): DripAction => (satoshis <= TERMINATE_AT_OR_BELOW ? 'terminate' : 'drip');

/** What a spend pays the miner: the largest payout the contract allows, or the whole coin when terminating. */
export function dripPayoutFor(satoshis: bigint): bigint {
    if (dripActionFor(satoshis) === 'terminate') {
        return satoshis;
    }

    const proportional = (satoshis * DECAY_NUMERATOR) / DECAY_DENOMINATOR;

    return proportional > MIN_PAYOUT ? proportional : MIN_PAYOUT;
}

export interface DripPlan {
    action: DripAction;
    payoutSatoshis: bigint;
    remainderSatoshis: bigint;
    transaction: TransactionCommon;
    transactionHex: string;
    transactionId: string;
    sizeBytes: number;
}

/** The raw transaction for spending one coin. The outpoint hash is in wire order, as the rest of the server writes it. */
export function buildDripTransaction(coin: { txid: string; index: number; satoshis: bigint }): DripPlan {
    const action = dripActionFor(coin.satoshis);
    const payoutSatoshis = dripPayoutFor(coin.satoshis);
    const remainderSatoshis = coin.satoshis - payoutSatoshis;
    const transaction: TransactionCommon = {
        version: 2,
        locktime: 0,
        inputs: [
            {
                outpointTransactionHash: hexToBin(coin.txid).reverse(),
                outpointIndex: coin.index,
                // The contract starts with `1 OP_CHECKSEQUENCEVERIFY`: the coin must be at least one block old.
                sequenceNumber: 1,
                unlockingBytecode: dripMineUnlockingBytecode,
            },
        ],
        outputs: [
            action === 'drip'
                ? { lockingBytecode: dripMineLockingBytecode, valueSatoshis: remainderSatoshis }
                : { lockingBytecode: TERMINAL_LOCKING_BYTECODE, valueSatoshis: 0n },
        ],
    };
    const bytes = encodeTransaction(transaction);

    return {
        action,
        payoutSatoshis,
        remainderSatoshis,
        transaction,
        transactionHex: binToHex(bytes),
        transactionId: transactionHashOf(transaction),
        sizeBytes: bytes.length,
    };
}

/** Runs the transaction through the BCH 2026 virtual machine against the coin it spends. True, or the reason it fails. */
export function verifyDripTransaction(transaction: TransactionCommon, coinSatoshis: bigint): true | string {
    const result = createVirtualMachineBch2026().verify({
        sourceOutputs: [{ lockingBytecode: dripMineLockingBytecode, valueSatoshis: coinSatoshis }],
        transaction,
    });

    return result === true ? true : String(result);
}

export interface DripCoinView {
    txid: string;
    index: number;
    satoshis: number;
    /** Block height, or 0 while unconfirmed. */
    height: number;
    action: DripAction;
    payoutSatoshis: number;
    remainderSatoshis: number;
    spendable: boolean;
    /** Why a coin cannot be spent right now, when it cannot. */
    reason?: string;
}

export function describeDripCoin(coin: Unspent): DripCoinView {
    const plan = buildDripTransaction(coin);
    let reason: string | undefined;

    if (coin.hasToken) {
        reason = 'It carries tokens, which a plain spend would destroy.';
    } else if (coin.height <= 0) {
        reason = 'It is not confirmed yet. The contract needs a coin to be at least one block old.';
    } else if (plan.payoutSatoshis < BigInt(plan.sizeBytes)) {
        reason = `It is worth less than the ${plan.sizeBytes}-byte fee the network requires.`;
    }

    return {
        txid: coin.txid,
        index: coin.index,
        satoshis: Number(coin.satoshis),
        height: Math.max(coin.height, 0),
        action: plan.action,
        payoutSatoshis: Number(plan.payoutSatoshis),
        remainderSatoshis: Number(plan.remainderSatoshis),
        spendable: reason === undefined,
        ...(reason ? { reason } : {}),
    };
}

export interface RunConfig {
    chains: Partial<Record<RunNetwork, ChainSource>>;
}

/** ELECTRUM_MAINNET and ELECTRUM_CHIPNET are "host:port" (TLS) servers; a comma-separated list is tried in order. RUN_LIVE=0 switches live runs off. */
export function buildRunConfig(env: NodeJS.ProcessEnv): RunConfig | undefined {
    if (env.RUN_LIVE === '0') {
        console.log('Live template runs are switched off (RUN_LIVE=0).');

        return undefined;
    }

    const chains: RunConfig['chains'] = {};
    const insecureTls = env.ELECTRUM_INSECURE_TLS === '1';
    const specs = { mainnet: env.ELECTRUM_MAINNET ?? DEFAULT_ELECTRUM.mainnet, chipnet: env.ELECTRUM_CHIPNET ?? DEFAULT_ELECTRUM.chipnet };

    for (const network of ['mainnet', 'chipnet'] as const) {
        const endpoints = parseEndpoints(specs[network]);

        if (endpoints) {
            const servers = endpoints.map((endpoint) => new ElectrumServer(endpoint, { insecureTls }));

            chains[network] = servers.length === 1 ? servers[0]! : new FailoverChain(servers);
        } else {
            console.warn(`ELECTRUM_${network.toUpperCase()} is not a host:port value; live runs are off on ${network}.`);
        }
    }

    return { chains };
}

function chainFor(config: RunConfig, network: RunNetwork): ChainSource {
    const chain = config.chains[network];

    if (!chain) {
        throw new RegistryError(`Live runs are not available on ${network} on this server.`, 503);
    }

    return chain;
}

async function fromChain<T>(network: RunNetwork, action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof RegistryError) {
            throw error;
        }

        throw new RegistryError(`The ${network} network answered with an error: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
}

export async function listDripCoins(config: RunConfig, network: RunNetwork): Promise<{ network: RunNetwork; address: string; coins: DripCoinView[] }> {
    const chain = chainFor(config, network);
    const unspent = await fromChain(network, () => chain.listUnspent(dripMineLockingBytecode));
    const coins = unspent
        .slice()
        .sort((a, b) => Number(b.satoshis - a.satoshis))
        .slice(0, MAX_COINS)
        .map(describeDripCoin);

    return { network, address: dripMineAddress(network), coins };
}

export interface DripRun {
    network: RunNetwork;
    transactionId: string;
    transactionHex: string;
    action: DripAction;
    coin: { txid: string; index: number; satoshis: number };
    payoutSatoshis: number;
    remainderSatoshis: number;
    sizeBytes: number;
    /** Coins tried and found already taken before this one went through (only when other coins were allowed). */
    coinsSkipped: number;
}

/** A node's way of saying the coin is gone: spent by someone else, or never there as far as it knows. */
export const SPENT_COIN_ERROR = /missing.?inputs|missingorspent|already.?spent|txn-mempool-conflict|inputs-missing|double.?spend/i;

/** At most this many further coins are tried when the chosen one turns out to be taken. */
const EXTRA_COINS = 3;

/**
 * Spends one Drip Mine coin. The coin's value comes from the chain, never from the request. The transaction is checked
 * in the virtual machine before it is sent, and the id the server reports must match the id we computed.
 *
 * A shared coin can be spent by anyone at any moment, and an index server can lag its node, so "missing inputs" is an
 * ordinary answer here. With `anyCoin`, the next few spendable coins are tried before giving up. When every try fails
 * the error says which of the two it looks like: the coin is gone from the list, or the list still shows a coin the
 * node does not know.
 */
export async function runDripMine(
    config: RunConfig,
    network: RunNetwork,
    txid: string,
    index: number,
    confirmMainnet: boolean,
    anyCoin = false,
): Promise<DripRun> {
    if (network === 'mainnet' && !confirmMainnet) {
        throw new RegistryError('Mainnet moves real BCH. Confirm that first.', 400);
    }

    const chain = chainFor(config, network);
    const unspent = await fromChain(network, () => chain.listUnspent(dripMineLockingBytecode));
    const wanted = unspent.find((item) => item.txid.toLowerCase() === txid.toLowerCase() && item.index === index);

    if (!wanted) {
        throw new RegistryError('That coin is not at the Drip Mine address on this network. It may already have been spent.', 404);
    }

    const view = describeDripCoin(wanted);

    if (!view.spendable) {
        throw new RegistryError(view.reason ?? 'That coin cannot be spent right now.', 409);
    }

    const candidates = [wanted];

    if (anyCoin) {
        const others = unspent
            .filter((item) => item !== wanted && describeDripCoin(item).spendable)
            .sort((a, b) => Number(b.satoshis - a.satoshis))
            .slice(0, EXTRA_COINS);

        candidates.push(...others);
    }

    let rejection = '';

    for (const [position, coin] of candidates.entries()) {
        const plan = buildDripTransaction(coin);
        const verdict = verifyDripTransaction(plan.transaction, coin.satoshis);

        if (verdict !== true) {
            if (position === 0) {
                throw new RegistryError(`XOGrid's own check of the transaction failed, so it was not sent: ${verdict}`, 500);
            }

            continue;
        }

        let returned: string;

        try {
            returned = await chain.broadcast(plan.transactionHex);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (SPENT_COIN_ERROR.test(message)) {
                rejection ||= message;

                continue;
            }

            throw new RegistryError(`The ${network} network answered with an error: ${message}`, 502);
        }

        if (returned !== plan.transactionId) {
            throw new RegistryError(`The network reported a different transaction id (${returned}).`, 502);
        }

        return {
            network,
            transactionId: plan.transactionId,
            transactionHex: plan.transactionHex,
            action: plan.action,
            coin: { txid: coin.txid, index: coin.index, satoshis: Number(coin.satoshis) },
            payoutSatoshis: Number(plan.payoutSatoshis),
            remainderSatoshis: Number(plan.remainderSatoshis),
            sizeBytes: plan.sizeBytes,
            coinsSkipped: position,
        };
    }

    throw await explainRejection(chain, network, wanted, rejection, candidates.length);
}

/** Works out whether the coin was taken or the list is out of step with the node, and says so. Nothing was spent. */
async function explainRejection(chain: ChainSource, network: RunNetwork, wanted: Unspent, rejection: string, tried: number): Promise<RegistryError> {
    let stillListed = true;
    let fundingKnown = true;

    try {
        const again = await chain.listUnspent(dripMineLockingBytecode);

        stillListed = again.some((item) => item.txid === wanted.txid && item.index === wanted.index);
    } catch {
        // keep the safe assumption: the list was not re-checked
    }

    try {
        fundingKnown = (await chain.getTransaction(wanted.txid)) !== undefined;
    } catch {
        // unknown either way
    }

    const triedText = tried > 1 ? `${tried} coins were tried and each was refused. ` : '';

    if (!stillListed) {
        return new RegistryError(`${triedText}Someone else spent that coin a moment ago. Nothing was spent from here. Refresh the list and pick another.`, 409);
    }

    return new RegistryError(
        `${triedText}The ${network} node says the coin's inputs are missing, yet the index server still lists the coin${fundingKnown ? '' : ' and cannot find its funding transaction'}. ` +
            `That usually means the index server is out of step with its node. Nothing was spent. Details: ${rejection}`,
        502,
    );
}
