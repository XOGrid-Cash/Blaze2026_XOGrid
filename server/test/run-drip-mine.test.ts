import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import type { ChainSource, Unspent } from '../src/electrum.js';
import {
    buildDripTransaction,
    describeDripCoin,
    dripMineAddress,
    dripPayoutFor,
    DRIP_MINE_TEMPLATE_IDENTIFIER,
    listDripCoins,
    prepareDripInvitation,
    runDripMine,
    verifyDripTransaction,
    type RunConfig,
} from '../src/run-drip-mine.js';
import { transactionHashOf } from '../src/review-receipt.js';
import { COMMUNITY_TEMPLATE_JSON } from '../src/templates/community-data.js';
import { buildInvitationTransactionFromMergedCommit, listInvitationValidationIssues, mergeInvitationCommits } from '@xo-cash/engine';
import { deserializeInvitation, parseTemplate } from '@xo-cash/utils';
import { freshDb } from './helpers.js';

const TXID = 'ab'.repeat(32);
const coin = (satoshis: bigint, overrides: Partial<Unspent> = {}): Unspent => ({ txid: TXID, index: 0, satoshis, height: 100, hasToken: false, ...overrides });

function fakeChain(coins: Unspent[], broadcast?: (hex: string) => string | Promise<string>) {
    const sent: string[] = [];
    const chain: ChainSource = {
        async listUnspent() {
            return coins;
        },
        async getTransaction() {
            return undefined;
        },
        async broadcast(hex) {
            sent.push(hex);

            if (broadcast) {
                return broadcast(hex);
            }

            const decoded = decodeTransaction(hexToBin(hex));

            if (typeof decoded === 'string') {
                throw new Error(decoded);
            }

            return transactionHashOf(decoded);
        },
    };

    return { chain, sent };
}

const configFor = (chain: ChainSource): RunConfig => ({ chains: { chipnet: chain, mainnet: chain } });

describe('the Drip Mine contract', () => {
    it('lives at the same address as the template test expects on both networks', () => {
        expect(dripMineAddress('mainnet')).toBe('bitcoincash:pwsu8f4ftnsugunzy8wruhuayvtpz9mt88euwvwtp5jvv58wnd95c0td3wpdp');
        expect(dripMineAddress('chipnet')).toBe('bchtest:pwsu8f4ftnsugunzy8wruhuayvtpz9mt88euwvwtp5jvv58wnd95cvvu0kjcn');
    });

    it('pays the larger of the proportional payout and the minimum, or the whole coin at 740 sats or less', () => {
        expect(dripPayoutFor(741n)).toBe(164n);
        expect(dripPayoutFor(100_000n)).toBe(164n);
        expect(dripPayoutFor(100_000_000_000n)).toBe(329_473n);
        expect(dripPayoutFor(740n)).toBe(740n);
        expect(dripPayoutFor(576n)).toBe(576n);
    });
});

describe('building and checking the transaction', () => {
    it.each([741n, 1_000n, 100_000n, 100_000_000n, 100_000_000_000n])('a %s sat coin drips and passes the 2026 virtual machine', (satoshis) => {
        const plan = buildDripTransaction({ txid: TXID, index: 3, satoshis });

        expect(plan.action).toBe('drip');
        expect(plan.remainderSatoshis).toBe(satoshis - plan.payoutSatoshis);
        expect(plan.transaction.outputs[0]?.valueSatoshis).toBe(plan.remainderSatoshis);
        expect(verifyDripTransaction(plan.transaction, satoshis)).toBe(true);
        // The payout is the fee, so it has to cover the size at 1 sat per byte.
        expect(plan.payoutSatoshis).toBeGreaterThanOrEqual(BigInt(plan.sizeBytes));
    });

    it.each([740n, 700n, 600n, 576n])('a %s sat coin terminates into a zero-value OP_RETURN and passes the virtual machine', (satoshis) => {
        const plan = buildDripTransaction({ txid: TXID, index: 0, satoshis });

        expect(plan.action).toBe('terminate');
        expect(plan.remainderSatoshis).toBe(0n);
        expect(binToHex(plan.transaction.outputs[0]!.lockingBytecode)).toBe('6a');
        expect(verifyDripTransaction(plan.transaction, satoshis)).toBe(true);
    });

    it('writes the outpoint in wire order and a sequence number of 1', () => {
        const txid = `de${'00'.repeat(30)}01`;
        const plan = buildDripTransaction({ txid, index: 7, satoshis: 5_000n });
        const wire = binToHex(hexToBin(txid).reverse());

        // the raw bytes: version, one input, then the outpoint hash in wire order (the txid reversed), then the index
        expect(plan.transactionHex.slice(10, 74)).toBe(wire);
        expect(plan.transactionHex.slice(74, 82)).toBe('07000000');
        // and the library reads it back as the same txid text, which is what a node and an explorer show
        const decoded = decodeTransaction(hexToBin(plan.transactionHex));

        expect(typeof decoded).not.toBe('string');
        expect(binToHex((decoded as { inputs: { outpointTransactionHash: Uint8Array }[] }).inputs[0]!.outpointTransactionHash)).toBe(txid);
        expect(plan.transaction.inputs[0]?.sequenceNumber).toBe(1);
        expect(plan.transaction.inputs[0]?.outpointIndex).toBe(7);
        expect(plan.transactionId).toBe(transactionHashOf(plan.transaction));
    });

    it('rejects a drip that pays the miner more than the contract allows', () => {
        const plan = buildDripTransaction({ txid: TXID, index: 0, satoshis: 100_000n });
        const greedy = { ...plan.transaction, outputs: [{ ...plan.transaction.outputs[0]!, valueSatoshis: plan.remainderSatoshis - 1n }] };

        expect(verifyDripTransaction(greedy, 100_000n)).not.toBe(true);
    });

    it('allows exactly the largest payout and not one satoshi more, even for a very large coin', () => {
        const satoshis = 100_000_000_000n;
        const plan = buildDripTransaction({ txid: TXID, index: 0, satoshis });
        const output = plan.transaction.outputs[0]!;

        expect(plan.payoutSatoshis).toBe(329_473n);
        expect(verifyDripTransaction(plan.transaction, satoshis)).toBe(true);
        expect(verifyDripTransaction({ ...plan.transaction, outputs: [{ ...output, valueSatoshis: output.valueSatoshis - 1n }] }, satoshis)).not.toBe(true);
    });

    it('rejects a terminate that keeps any value, a different output script, a second output, and a spend with no age', () => {
        const drip = buildDripTransaction({ txid: TXID, index: 0, satoshis: 100_000n });
        const terminate = buildDripTransaction({ txid: TXID, index: 0, satoshis: 700n });
        const stranger = Uint8Array.from([0x51]);

        expect(verifyDripTransaction({ ...terminate.transaction, outputs: [{ ...terminate.transaction.outputs[0]!, valueSatoshis: 1n }] }, 700n)).not.toBe(true);
        expect(verifyDripTransaction({ ...drip.transaction, outputs: [{ ...drip.transaction.outputs[0]!, lockingBytecode: stranger }] }, 100_000n)).not.toBe(true);
        expect(verifyDripTransaction({ ...drip.transaction, outputs: [...drip.transaction.outputs, { lockingBytecode: stranger, valueSatoshis: 0n }] }, 100_000n)).not.toBe(true);
        expect(verifyDripTransaction({ ...drip.transaction, inputs: [{ ...drip.transaction.inputs[0]!, sequenceNumber: 0 }] }, 100_000n)).not.toBe(true);
    });
});

describe('which coins can be run', () => {
    it('allows a confirmed plain coin', () => {
        expect(describeDripCoin(coin(100_000n))).toMatchObject({ action: 'drip', spendable: true, payoutSatoshis: 164, remainderSatoshis: 99_836, satoshis: 100_000, height: 100 });
    });

    it('holds back an unconfirmed coin, a token coin, and a coin too small to pay the network fee', () => {
        expect(describeDripCoin(coin(100_000n, { height: 0 }))).toMatchObject({ spendable: false, reason: expect.stringContaining('not confirmed') });
        expect(describeDripCoin(coin(100_000n, { height: -1 }))).toMatchObject({ spendable: false, height: 0 });
        expect(describeDripCoin(coin(100_000n, { hasToken: true }))).toMatchObject({ spendable: false, reason: expect.stringContaining('tokens') });
        expect(describeDripCoin(coin(50n))).toMatchObject({ action: 'terminate', spendable: false, reason: expect.stringContaining('fee') });
    });
});

describe('listing and running', () => {
    it('lists the coins at the shared address, biggest first', async () => {
        const { chain } = fakeChain([coin(1_000n, { index: 1 }), coin(9_000n, { index: 2 })]);
        const listing = await listDripCoins(configFor(chain), 'chipnet');

        expect(listing.address).toBe(dripMineAddress('chipnet'));
        expect(listing.coins.map((item) => item.satoshis)).toEqual([9_000, 1_000]);
    });

    it('builds, checks and broadcasts exactly one transaction, using the value the chain reports', async () => {
        const { chain, sent } = fakeChain([coin(100_000n)]);
        const run = await runDripMine(configFor(chain), 'chipnet', TXID.toUpperCase(), 0, false);

        expect(sent).toHaveLength(1);
        expect(sent[0]).toBe(run.transactionHex);
        expect(run).toMatchObject({ network: 'chipnet', action: 'drip', payoutSatoshis: 164, remainderSatoshis: 99_836, coin: { txid: TXID, index: 0, satoshis: 100_000 } });
        expect(run.transactionId).toBe(buildDripTransaction({ txid: TXID, index: 0, satoshis: 100_000n }).transactionId);
    });

    it('needs a confirmation for mainnet and sends nothing without it', async () => {
        const { chain, sent } = fakeChain([coin(100_000n)]);

        await expect(runDripMine(configFor(chain), 'mainnet', TXID, 0, false)).rejects.toMatchObject({ status: 400 });
        expect(sent).toHaveLength(0);
        await expect(runDripMine(configFor(chain), 'mainnet', TXID, 0, true)).resolves.toMatchObject({ network: 'mainnet' });
    });

    it('refuses a coin that is not there, an unconfirmed one, and a transaction id the network disagrees with', async () => {
        const missing = fakeChain([coin(100_000n)]);
        const young = fakeChain([coin(100_000n, { height: 0 })]);
        const odd = fakeChain([coin(100_000n)], () => 'cd'.repeat(32));

        await expect(runDripMine(configFor(missing.chain), 'chipnet', TXID, 9, false)).rejects.toMatchObject({ status: 404 });
        await expect(runDripMine(configFor(young.chain), 'chipnet', TXID, 0, false)).rejects.toMatchObject({ status: 409 });
        await expect(runDripMine(configFor(odd.chain), 'chipnet', TXID, 0, false)).rejects.toMatchObject({ status: 502 });
        expect(missing.sent).toHaveLength(0);
        expect(young.sent).toHaveLength(0);
    });

    it('reports a network that rejects the transaction or cannot be reached as a gateway error', async () => {
        const rejecting = fakeChain([coin(100_000n)], () => {
            throw new Error('txn-mempool-conflict');
        });

        await expect(runDripMine(configFor(rejecting.chain), 'chipnet', TXID, 0, false)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('txn-mempool-conflict') });
        await expect(listDripCoins({ chains: {} }, 'chipnet')).rejects.toMatchObject({ status: 503 });
    });
});

describe('an invitation for the user\'s own wallet', () => {
    const dripMineTemplate = parseTemplate(COMMUNITY_TEMPLATE_JSON['drip-mine']!);

    it.each([
        ['chipnet', 100_000n, 'drip'],
        ['mainnet', 100_000n, 'drip'],
        ['chipnet', 700n, 'terminate'],
    ] as const)('on %s for a %s sat coin: XO accepts it and builds the very transaction a run would send (%s)', async (network, satoshis, action) => {
        const { chain, sent } = fakeChain([coin(satoshis, { index: 4 })]);
        const view = await prepareDripInvitation(configFor(chain), network, TXID, 4);
        const invitation = deserializeInvitation(view.invitation);

        // nothing went to the network
        expect(sent).toHaveLength(0);
        expect(invitation.templateIdentifier).toBe(DRIP_MINE_TEMPLATE_IDENTIFIER);
        expect(invitation.actionIdentifier).toBe(action);
        expect(invitation.invitationIdentifier).toBe(view.invitationIdentifier);
        expect(listInvitationValidationIssues(invitation, dripMineTemplate as never, network)).toEqual([]);

        const built = buildInvitationTransactionFromMergedCommit(mergeInvitationCommits(invitation, dripMineTemplate as never), dripMineTemplate as never, action);
        const expected = buildDripTransaction({ txid: TXID, index: 4, satoshis }, network);

        expect(built.serializedTransaction).toBe(expected.transactionHex);
        expect(built.transactionHash).toBe(view.transactionId);
        expect(view.transactionHex).toBe(expected.transactionHex);

        const decoded = decodeTransaction(hexToBin(view.transactionHex));

        if (typeof decoded === 'string') {
            throw new Error(decoded);
        }

        expect(verifyDripTransaction(decoded, satoshis)).toBe(true);
        expect(view).toMatchObject({ network, action, coin: { txid: TXID, index: 4, satoshis: Number(satoshis) } });
        expect(Date.parse(view.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('wrong network: the invitation is refused on the other network', async () => {
        const { chain } = fakeChain([coin(100_000n)]);
        const view = await prepareDripInvitation(configFor(chain), 'mainnet', TXID, 0);

        expect(listInvitationValidationIssues(deserializeInvitation(view.invitation), dripMineTemplate as never, 'mainnet')).toEqual([]);
        expect(listInvitationValidationIssues(deserializeInvitation(view.invitation), dripMineTemplate as never, 'chipnet')).not.toEqual([]);
    });

    it('carries the coin value on the input so a wallet needs no lookup, and takes that value from the chain', async () => {
        const { chain } = fakeChain([coin(123_456n)]);
        const view = await prepareDripInvitation(configFor(chain), 'chipnet', TXID, 0);
        const inputs = deserializeInvitation(view.invitation).commits.flatMap((item) => (item.data as { inputs?: { valueSatoshis?: bigint }[] }).inputs ?? []);

        expect(inputs.some((input) => input.valueSatoshis === 123_456n)).toBe(true);
    });

    it('refuses coins a run would refuse, and sends nothing', async () => {
        const missing = fakeChain([coin(100_000n)]);
        const young = fakeChain([coin(100_000n, { height: 0 })]);
        const tokens = fakeChain([coin(100_000n, { hasToken: true })]);

        await expect(prepareDripInvitation(configFor(missing.chain), 'chipnet', TXID, 9)).rejects.toMatchObject({ status: 404 });
        await expect(prepareDripInvitation(configFor(young.chain), 'chipnet', TXID, 0)).rejects.toMatchObject({ status: 409 });
        await expect(prepareDripInvitation(configFor(tokens.chain), 'chipnet', TXID, 0)).rejects.toMatchObject({ status: 409 });
        await expect(prepareDripInvitation({ chains: {} }, 'chipnet', TXID, 0)).rejects.toMatchObject({ status: 503 });
        expect([...missing.sent, ...young.sent, ...tokens.sent]).toHaveLength(0);
    });
});

describe('the routes', () => {
    let db: Db;
    let app: FastifyInstance;
    let sent: string[];

    beforeEach(async () => {
        db = await freshDb();
        const fake = fakeChain([coin(100_000n)]);

        sent = fake.sent;
        app = await buildApp(db, { rateLimit: false, run: configFor(fake.chain) });
    });

    afterEach(async () => {
        await app.close();
        await db.destroy();
    });

    it('lists coins and runs one', async () => {
        const listed = await app.inject({ method: 'GET', url: '/api/run/drip-mine/coins?network=chipnet' });

        expect(listed.statusCode).toBe(200);
        expect(listed.json().coins).toHaveLength(1);

        const ran = await app.inject({ method: 'POST', url: '/api/run/drip-mine', payload: { network: 'chipnet', txid: TXID, index: 0 } });

        expect(ran.statusCode).toBe(200);
        expect(ran.json()).toMatchObject({ action: 'drip', network: 'chipnet' });
        expect(sent).toHaveLength(1);
    });

    it('answers bad requests with 400 and mainnet without confirmation with 400', async () => {
        expect((await app.inject({ method: 'GET', url: '/api/run/drip-mine/coins?network=nope' })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/run/drip-mine', payload: { network: 'chipnet', txid: 'xyz', index: 0 } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/run/drip-mine', payload: { network: 'chipnet', txid: TXID, index: -1 } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/run/drip-mine', payload: { network: 'mainnet', txid: TXID, index: 0 } })).statusCode).toBe(400);
        expect(sent).toHaveLength(0);
    });

    it('hands out an invitation without broadcasting, on mainnet too and without a confirmation', async () => {
        const answer = await app.inject({ method: 'POST', url: '/api/run/drip-mine/invitation', payload: { network: 'mainnet', txid: TXID.toUpperCase(), index: 0 } });

        expect(answer.statusCode).toBe(200);
        expect(answer.json()).toMatchObject({ network: 'mainnet', action: 'drip', builtBy: { engine: '@xo-cash/engine', templateIdentifier: DRIP_MINE_TEMPLATE_IDENTIFIER } });
        expect(deserializeInvitation(answer.json().invitation).invitationIdentifier).toBe(answer.json().invitationIdentifier);
        expect(sent).toHaveLength(0);
        expect((await app.inject({ method: 'POST', url: '/api/run/drip-mine/invitation', payload: { network: 'nope', txid: TXID, index: 0 } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/run/drip-mine/invitation', payload: { network: 'chipnet', txid: TXID, index: 1.5 } })).statusCode).toBe(400);
    });

    it('answers 503 when live runs are off', async () => {
        const off = await buildApp(db, { rateLimit: false });

        expect((await off.inject({ method: 'GET', url: '/api/run/drip-mine/coins?network=chipnet' })).statusCode).toBe(503);
        expect((await off.inject({ method: 'POST', url: '/api/run/drip-mine', payload: { network: 'chipnet', txid: TXID, index: 0 } })).statusCode).toBe(503);
        await off.close();
    });
});
