import { binToHex } from '@bitauth/libauth';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    ArrowRight,
    Check,
    CheckCircle2,
    CircleDollarSign,
    Copy,
    ExternalLink,
    Loader2,
    LockKeyhole,
    QrCode,
    RefreshCw,
    ShieldCheck,
    Wallet,
} from 'lucide-react';

import xogridlogo from '../assets/images/xogridlogo.png';
import { hub, type Summary } from '../hub/api';
import { explorerUrl } from '../hub/receipts';
import { useWallet } from '../hub/WalletContext';
import { Chain } from '../voucher/chain';
import TemplateGuide from '../components/demo/TemplateGuide';
import TemplatePicker, { type LiveTemplate } from '../components/demo/TemplatePicker';
import { RunDripMine } from '../components/hub/RunDripMine';
import { DRIP_MINE_TEMPLATE_IDENTIFIER } from '../hub/run';

import {
    CLAIM_FEE_SATOSHIS,
    ISSUE_FEE_SATOSHIS,
    MINIMUM_VOUCHER_SATOSHIS,
    NETWORKS,
    VOUCHER_TEMPLATE_IDENTIFIER,
    addressFor,
    claimFragment,
    codeHash,
    lockingBytecodeFromAddress,
    newClaimCode,
    parseClaimCode,
    parseClaimFragment,
    walletLockingBytecode,
    type Coin,
    type Network,
} from '../voucher/core';
// The voucher's lock, unlocking script and transactions are built by the XO engine from the registry template (xo.ts),
// each compared with the independent implementation in core.ts.
import { buildIssue, buildIssueSignRequest, prepareClaim, verifySignedIssue, voucherLockingBytecode } from '../voucher/xo';

import { WizardConnectWallet, scanCoins } from '../voucher/wallet';

const buttonBase =
    'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40';

const primaryButton = `${buttonBase} bg-orange-500 text-white shadow-lg shadow-orange-500/20 hover:bg-orange-400`;

const secondaryButton = `${buttonBase} border border-white/10 bg-white/[0.04] text-gray-200 hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-white`;

const inputClass =
    'w-full rounded-xl border border-white/10 bg-[#080B10] px-4 py-3 text-base text-white outline-none transition-all placeholder:text-gray-600 focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/10';

const cardClass = 'rounded-2xl border border-white/[0.08] bg-[#0D1117]/90 shadow-2xl shadow-black/20';

const LIVE_TEMPLATES: LiveTemplate[] = [
    {
        identifier: VOUCHER_TEMPLATE_IDENTIFIER,
        name: 'Claim-Code Voucher',
        blurb: 'Lock some BCH behind a secret code. Share the code and whoever has it can claim the money.',
        icon: <LockKeyhole size={20} />,
    },
    {
        identifier: DRIP_MINE_TEMPLATE_IDENTIFIER,
        name: 'Drip Mine',
        blurb: 'A shared pot of coins that slowly pays out to miners. Trigger a payout and watch it happen.',
        icon: <CircleDollarSign size={20} />,
    },
];

const shortId = (id: string): string => (id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id);

/** A numbered heading inside a card. */
function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
    return (
        <div className="mb-4 flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
                {n}
            </span>
            <div>
                <h3 className="text-base font-semibold text-white sm:text-lg">{title}</h3>
                {hint ? <p className="mt-0.5 text-sm text-gray-500">{hint}</p> : null}
            </div>
        </div>
    );
}

function Notice({
    children,
    type = 'info',
}: {
    children: ReactNode;
    type?: 'success' | 'error' | 'info' | 'warning';
}) {
    const styles = {
        success: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300',
        error: 'border-rose-500/20 bg-rose-500/[0.07] text-rose-300',
        info: 'border-orange-500/20 bg-orange-500/[0.07] text-orange-200',
        warning: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-200',
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-4 text-sm leading-relaxed ${styles[type]}`}
        >
            {children}
        </motion.div>
    );
}

/** A transaction id, shortened, with a link to the explorer. */
function TransactionLine({ id, network }: { id: string; network: Network }) {
    return (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-400">
            <span>
                Transaction <span className="font-mono text-gray-300" title={id}>{shortId(id)}</span>
            </span>
            <a
                className="inline-flex items-center gap-1 font-semibold text-orange-400 hover:text-orange-300"
                href={explorerUrl(network, id)}
                target="_blank"
                rel="noreferrer"
            >
                View on the explorer
                <ExternalLink size={12} />
            </a>
        </div>
    );
}

function VoucherDemo() {
    const fragment = useMemo(() => parseClaimFragment(window.location.hash), []);

    const [network, setNetwork] = useState<Network>(fragment.network ?? 'chipnet');
    // A visitor who arrives from a claim link goes straight to claiming.
    const [mode, setMode] = useState<'create' | 'claim'>(fragment.code ? 'claim' : 'create');

    const [mainnetOk, setMainnetOk] = useState(false);
    const [template, setTemplate] = useState<Summary | undefined>();

    const wallet = useRef(new WizardConnectWallet());
    const chain = useRef<Chain | undefined>(undefined);

    // One wallet connection for the whole site (hub/WalletContext). The Demo borrows it; it never closes it.
    const {
        session: walletSession,
        connected: walletConnected,
        walletName,
        status: relayStatus,
        openModal,
    } = useWallet();
    const [coins, setCoins] = useState<Coin[]>([]);
    const [scanning, setScanning] = useState(false);
    const [chosen, setChosen] = useState<Coin | undefined>();

    const [amount, setAmount] = useState('1000');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const [issued, setIssued] = useState<
        { code: string; transactionId: string; network: Network } | undefined
    >();
    // True once the network has accepted the voucher transaction.
    const [issuedSent, setIssuedSent] = useState(false);

    const [claimCode, setClaimCode] = useState(fragment.code ?? '');
    const [destination, setDestination] = useState('');

    const [claimed, setClaimed] = useState<
        { transactionId: string; network: Network } | undefined
    >();

    const [claimStatus, setClaimStatus] = useState('');
    const [copied, setCopied] = useState('');

    const enabled = network === 'chipnet' || mainnetOk;

    const amountSats = (() => {
        try {
            return BigInt(amount.trim() === '' ? '0' : amount.trim());
        } catch {
            return 0n;
        }
    })();

    useEffect(() => {
        hub<Summary>(`/api/templates/${VOUCHER_TEMPLATE_IDENTIFIER}`)
            .then(setTemplate)
            .catch(() => setTemplate(undefined));
    }, []);

    // Use the shared wallet connection whenever one is open, and let go of it when it closes.
    useEffect(() => {
        if (walletConnected && walletSession) {
            wallet.current.adopt(walletSession.manager);
        } else {
            wallet.current.stop();
        }

        // A different wallet means different coins.
        setCoins([]);
        setChosen(undefined);
    }, [walletConnected, walletSession]);

    useEffect(
        () => () => {
            wallet.current.stop();
            void chain.current?.close();
        },
        []
    );

    const resetForNetwork = (next: Network) => {
        void chain.current?.close();

        chain.current = undefined;

        setNetwork(next);
        setMainnetOk(false);
        setCoins([]);
        setChosen(undefined);
        setIssued(undefined);
        setIssuedSent(false);
        setClaimed(undefined);
        setError('');
    };

    const getChain = (): Chain => {
        chain.current ??= new Chain(network);
        return chain.current;
    };

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError('');

        try {
            await action();
        } catch (caught) {
            setError(
                caught instanceof Error ? caught.message : String(caught)
            );
        } finally {
            setBusy(false);
        }
    };

    // Opens the site-wide connect window. The wallet connection itself is shared, so it also shows in the navbar.
    const connect = () => {
        setError('');
        openModal();
    };

    const findCoins = () => {
        if (scanning) return;

        setScanning(true);
        setCoins([]);
        setChosen(undefined);

        run(async () => {
            const found = await scanCoins(wallet.current, getChain());

            setCoins(found);
            // The biggest coin first: it is the one most likely to cover the amount, and it can still be changed.
            setChosen(found[0]);

            if (found.length === 0) {
                const keys = wallet.current.keys(1);
                const first = keys.find((key) => key.pathName === 'receive') ?? keys[0];
                const fund = first
                    ? ` To get started, send a little BCH to ${addressFor(walletLockingBytecode(first.publicKey), network)} and press Check again.`
                    : '';

                setError(
                    network === 'chipnet'
                        ? `No coins found on chipnet (the test network). Chipnet coins are free from a faucet (tbch.googol.cash). If your coins are real BCH, switch to Real BCH above.${fund}`
                        : `No plain coins found on mainnet in the first 20 addresses of each path your wallet shares. Coins that carry tokens are skipped. If you are testing with chipnet coins, switch to Practice mode above.${fund}`
                );
            }
        }).finally(() => setScanning(false));
    };

    // No button press is needed to look for coins. The wallet shares only public keys, so the page asks the chain about
    // each one as soon as a wallet is connected on a network that is switched on.
    const autoScanned = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!walletConnected || !walletName || !enabled) {
            if (!walletConnected) {
                autoScanned.current = undefined;
            }

            return;
        }

        const key = `${network}|${walletName}`;

        if (autoScanned.current === key) {
            return;
        }

        autoScanned.current = key;
        findCoins();
    }, [walletConnected, walletName, enabled, network]);

    const issue = () =>
        run(async () => {
            if (!chosen) {
                throw new Error('Choose a coin first.');
            }

            setIssued(undefined);
            setIssuedSent(false);

            const code = newClaimCode();
            const hash = codeHash(code);

            buildIssue(chosen, amountSats, hash);

            const signedHex = await wallet.current.sign(
                buildIssueSignRequest(chosen, amountSats, hash),
                chosen.pathName,
                chosen.addressIndex
            );

            const verdict = verifySignedIssue(
                chosen,
                amountSats,
                hash,
                signedHex
            );

            if (
                !verdict.valid ||
                !verdict.transactionHex ||
                !verdict.transactionId
            ) {
                throw new Error(
                    `The signed transaction did not pass XOGrid's check, so it was NOT sent. ${verdict.reason ?? ''}`
                );
            }

            const codeHex = binToHex(code);

            // The code is shown before sending, so it is never lost if the network is slow to answer.
            setIssued({
                code: codeHex,
                transactionId: verdict.transactionId,
                network,
            });

            setClaimCode(codeHex);

            const returned = await getChain().broadcast(
                verdict.transactionHex
            );

            if (returned !== verdict.transactionId) {
                throw new Error(
                    `The server returned a different transaction id (${returned}).`
                );
            }

            setIssuedSent(true);
            setChosen(undefined);
            setCoins([]);
        });

    const claim = () =>
        run(async () => {
            setClaimStatus('');
            setClaimed(undefined);

            const code = parseClaimCode(claimCode);
            const target = lockingBytecodeFromAddress(destination, network);

            setClaimStatus('Looking for the voucher on chain...');

            const voucher = await getChain().findVoucher(
                voucherLockingBytecode(codeHash(code))
            );

            if (!voucher) {
                throw new Error(
                    'No unspent voucher matches that code on this network. It may already be claimed, still unconfirmed, or on the other network.'
                );
            }

            setClaimStatus(
                `Found a voucher holding ${voucher.valueSatoshis} sats. Checking the claim...`
            );

            const verdict = prepareClaim(voucher, code, target);

            if (
                !verdict.valid ||
                !verdict.transactionHex ||
                !verdict.transactionId
            ) {
                throw new Error(verdict.reason ?? 'The claim did not verify.');
            }

            const returned = await getChain().broadcast(
                verdict.transactionHex
            );

            setClaimed({ transactionId: returned, network });
            setClaimStatus('');
        });

    const claimLink = issued
        ? `${window.location.origin}/demo${claimFragment(
              parseClaimCode(issued.code),
              issued.network
          )}`
        : '';

    const suggestedAddress = chosen
        ? addressFor(walletLockingBytecode(chosen.publicKey), network)
        : coins[0]
          ? addressFor(walletLockingBytecode(coins[0].publicKey), network)
          : '';

    const copyValue = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(label);
            window.setTimeout(() => setCopied(''), 1800);
        } catch {
            setError('Unable to copy. Please select and copy the text manually.');
        }
    };

    const insufficient = chosen !== undefined && chosen.valueSatoshis < amountSats + ISSUE_FEE_SATOSHIS;
    const change =
        chosen && !insufficient && amountSats >= MINIMUM_VOUCHER_SATOSHIS
            ? chosen.valueSatoshis - amountSats - ISSUE_FEE_SATOSHIS
            : undefined;

    const quickAmounts = [1000n, 5000n, 10000n];

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                <span>
                    Template:{' '}
                    <Link
                        to={`/t/${VOUCHER_TEMPLATE_IDENTIFIER}`}
                        className="font-medium text-gray-300 underline-offset-2 hover:text-orange-300 hover:underline"
                    >
                        {template?.name ?? 'Claim-Code Voucher'}
                    </Link>
                </span>
                {template?.badge && (
                    <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 font-medium text-orange-300">
                        {template.badge}
                    </span>
                )}
            </div>

            {/* Network */}
            <section className={`${cardClass} p-5 sm:p-6`}>
                <p className="text-sm font-semibold text-white">Where do you want to try it?</p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {(Object.keys(NETWORKS) as Network[]).map((name) => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => resetForNetwork(name)}
                            aria-pressed={network === name}
                            className={`rounded-xl border p-4 text-left transition ${
                                network === name
                                    ? 'border-orange-500/60 bg-orange-500/[0.08]'
                                    : 'border-white/10 hover:border-white/25'
                            }`}
                        >
                            <span className="block text-sm font-semibold text-white">
                                {name === 'chipnet' ? 'Practice mode' : 'Real BCH'}
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-500">
                                {name === 'chipnet'
                                    ? 'Free test coins, no real money'
                                    : 'Real money on the main network'}
                            </span>
                        </button>
                    ))}
                </div>

                <AnimatePresence>
                    {network === 'mainnet' && (
                        <motion.label
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-4 flex cursor-pointer items-start gap-3 overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-100"
                        >
                            <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 accent-orange-500"
                                checked={mainnetOk}
                                onChange={(event) => setMainnetOk(event.target.checked)}
                            />
                            <span className="leading-relaxed">
                                <b className="block text-amber-300">This uses real money</b>
                                I understand this sends real BCH. I will keep amounts small and save the claim code,
                                because XOGrid does not store it.
                            </span>
                        </motion.label>
                    )}
                </AnimatePresence>
            </section>

            {/* Create or claim */}
            <div className="flex rounded-2xl border border-white/10 bg-black/30 p-1.5" role="tablist">
                {(
                    [
                        ['create', 'Create a voucher'],
                        ['claim', 'Claim a voucher'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={mode === key}
                        onClick={() => setMode(key)}
                        className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                            mode === key
                                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                    >
                        <Notice type="error">{error}</Notice>
                    </motion.div>
                )}
            </AnimatePresence>

            {mode === 'create' ? (
                <div className="space-y-6">
                    {/* Connect */}
                    <section className={`${cardClass} p-5 sm:p-7`}>
                        <StepHeading
                            n={1}
                            title="Connect your wallet"
                            hint="The voucher is paid for from your wallet, so it needs to be connected."
                        />

                        {walletName ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
                                <div className="flex items-center gap-3 text-emerald-300">
                                    <CheckCircle2 size={22} />
                                    <div>
                                        <p className="text-sm font-semibold">Connected to {walletName}</p>
                                        <p className="text-xs text-emerald-200/60">Your wallet is ready.</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className={secondaryButton}
                                    disabled={!enabled || busy}
                                    onClick={connect}
                                >
                                    Change wallet
                                </button>
                            </div>
                        ) : (
                            <div>
                                <p className="text-sm leading-6 text-gray-400">
                                    Open a wallet that supports WizardConnect, such as Selene or Paytaca
                                    {network === 'chipnet' ? ' (switched to chipnet)' : ''}. Then press the button and
                                    scan the QR code that appears.
                                </p>

                                <button
                                    type="button"
                                    className={`${primaryButton} mt-4`}
                                    disabled={!enabled || busy}
                                    onClick={connect}
                                >
                                    <QrCode size={17} />
                                    Connect wallet
                                    <ArrowRight size={16} />
                                </button>

                                {!enabled ? (
                                    <p className="mt-3 text-xs text-amber-300">Tick the box above to continue.</p>
                                ) : null}

                                {relayStatus ? (
                                    <p className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                                        <Loader2 size={14} className="animate-spin text-orange-400" />
                                        {relayStatus}
                                    </p>
                                ) : null}
                            </div>
                        )}
                    </section>

                    {/* Amount */}
                    <section className={`${cardClass} p-5 sm:p-7`}>
                        <StepHeading
                            n={2}
                            title="Choose an amount"
                            hint="This is the money the voucher will hold. Sats are tiny units of BCH."
                        />

                        {!walletName ? (
                            <p className="rounded-xl border border-white/[0.07] bg-black/20 p-4 text-sm text-gray-500">
                                Connect your wallet first. We will then find the coins you can use.
                            </p>
                        ) : (
                            <div className="space-y-5">
                                {scanning ? (
                                    <p className="flex items-center gap-2 text-sm text-gray-400">
                                        <Loader2 size={16} className="animate-spin text-orange-400" />
                                        Looking for coins in your wallet...
                                    </p>
                                ) : coins.length === 0 ? (
                                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-4">
                                        <p className="text-sm text-gray-400">No usable coins found yet.</p>
                                        <button
                                            type="button"
                                            className={secondaryButton}
                                            disabled={!enabled || busy}
                                            onClick={findCoins}
                                        >
                                            <RefreshCw size={15} />
                                            Check again
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-medium text-gray-300">
                                                {coins.length === 1 ? 'Paying from your coin' : 'Pay from which coin?'}
                                            </p>
                                            <button
                                                type="button"
                                                className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 disabled:opacity-40"
                                                disabled={busy || scanning}
                                                onClick={findCoins}
                                            >
                                                <RefreshCw size={12} />
                                                Check again
                                            </button>
                                        </div>

                                        {coins.map((coin) => (
                                            <button
                                                key={`${coin.transactionHash}:${coin.outputIndex}`}
                                                type="button"
                                                onClick={() => setChosen(coin)}
                                                aria-pressed={chosen === coin}
                                                className={`flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition ${
                                                    chosen === coin
                                                        ? 'border-orange-500/50 bg-orange-500/[0.08]'
                                                        : 'border-white/[0.08] bg-black/20 hover:border-white/20'
                                                }`}
                                            >
                                                <span>
                                                    <span className="block text-sm font-semibold text-white">
                                                        {coin.valueSatoshis.toString()}{' '}
                                                        <span className="font-normal text-gray-500">sats</span>
                                                    </span>
                                                    <span className="mt-0.5 block text-[11px] text-gray-600">
                                                        {coin.transactionHash.slice(0, 8)}…:{coin.outputIndex}
                                                    </span>
                                                </span>
                                                <span
                                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                                        chosen === coin
                                                            ? 'border-orange-500 bg-orange-500 text-white'
                                                            : 'border-white/20 text-transparent'
                                                    }`}
                                                >
                                                    <Check size={14} />
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div>
                                    <label
                                        htmlFor="voucher-amount"
                                        className="block text-sm font-medium text-gray-300"
                                    >
                                        How much should the voucher hold?
                                    </label>

                                    <div className="relative mt-2">
                                        <input
                                            id="voucher-amount"
                                            className={`${inputClass} pr-16 font-mono`}
                                            value={amount}
                                            onChange={(event) => setAmount(event.target.value)}
                                            inputMode="numeric"
                                            placeholder="Amount in sats"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-orange-400">
                                            sats
                                        </span>
                                    </div>

                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        {quickAmounts.map((quick) => (
                                            <button
                                                key={quick.toString()}
                                                type="button"
                                                onClick={() => setAmount(quick.toString())}
                                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                                                    amountSats === quick
                                                        ? 'border-orange-500/50 bg-orange-500/10 text-orange-200'
                                                        : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
                                                }`}
                                            >
                                                {quick.toLocaleString()}
                                            </button>
                                        ))}
                                        <span className="text-xs text-gray-600">
                                            Minimum {MINIMUM_VOUCHER_SATOSHIS.toString()} sats
                                        </span>
                                    </div>

                                    {amountSats < MINIMUM_VOUCHER_SATOSHIS && amount.trim() !== '' ? (
                                        <p className="mt-2 text-xs text-amber-300">
                                            The smallest voucher is {MINIMUM_VOUCHER_SATOSHIS.toString()} sats.
                                        </p>
                                    ) : null}
                                    {insufficient ? (
                                        <p className="mt-2 text-xs text-amber-300">
                                            That is more than this coin can cover once the network fee is added. Try a
                                            smaller amount.
                                        </p>
                                    ) : null}
                                </div>

                                {chosen && (
                                    <Notice type="info">
                                        <p className="font-semibold text-orange-300">What will happen</p>
                                        <div className="mt-3 space-y-2 text-sm">
                                            <div className="flex justify-between gap-3">
                                                <span className="text-gray-400">The voucher holds</span>
                                                <span className="text-white">{amountSats.toString()} sats</span>
                                            </div>
                                            <div className="flex justify-between gap-3">
                                                <span className="text-gray-400">Network fee (paid to miners)</span>
                                                <span className="text-white">{ISSUE_FEE_SATOSHIS.toString()} sats</span>
                                            </div>
                                            <div className="flex justify-between gap-3 border-t border-white/10 pt-2">
                                                <span className="text-gray-400">Back to your wallet</span>
                                                <span className="font-semibold text-emerald-300">
                                                    {change !== undefined ? `${change.toString()} sats` : '–'}
                                                </span>
                                            </div>
                                        </div>
                                    </Notice>
                                )}

                                <button
                                    type="button"
                                    className={`${primaryButton} w-full sm:w-auto`}
                                    disabled={
                                        !enabled ||
                                        !chosen ||
                                        busy ||
                                        insufficient ||
                                        amountSats < MINIMUM_VOUCHER_SATOSHIS
                                    }
                                    onClick={issue}
                                >
                                    {busy ? (
                                        <>
                                            <Loader2 size={17} className="animate-spin" />
                                            Waiting for your wallet...
                                        </>
                                    ) : (
                                        <>
                                            <LockKeyhole size={17} />
                                            Create voucher
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
                                {busy ? (
                                    <p className="text-xs text-gray-500">
                                        Approve the request in your wallet. Keep this page open until it finishes.
                                    </p>
                                ) : null}
                            </div>
                        )}
                    </section>

                    <AnimatePresence>
                        {issued && (
                            <motion.section
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 sm:p-7"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                                        {issuedSent ? (
                                            <CheckCircle2 size={24} />
                                        ) : busy ? (
                                            <Loader2 size={22} className="animate-spin" />
                                        ) : (
                                            <ShieldCheck size={22} />
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-lg font-semibold text-emerald-300">
                                            {issuedSent
                                                ? 'Your voucher is ready'
                                                : busy
                                                  ? 'Sending your voucher...'
                                                  : 'Your voucher may not have been sent'}
                                        </p>
                                        <p className="text-sm text-gray-400">
                                            {issuedSent
                                                ? 'Share the link or the code below with the person who should receive it.'
                                                : busy
                                                  ? 'Your code is below. Keep this page open.'
                                                  : 'Your code is below, but the network did not confirm the transaction. See the message above.'}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                                        Secret claim code
                                    </p>
                                    <p className="break-all font-mono text-base tracking-wider text-white sm:text-lg">
                                        {issued.code}
                                    </p>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className={primaryButton}
                                        onClick={() => void copyValue(claimLink, 'link')}
                                    >
                                        {copied === 'link' ? <Check size={15} /> : <Copy size={15} />}
                                        {copied === 'link' ? 'Copied' : 'Copy claim link'}
                                    </button>

                                    <button
                                        type="button"
                                        className={secondaryButton}
                                        onClick={() => void copyValue(issued.code, 'code')}
                                    >
                                        {copied === 'code' ? <Check size={15} /> : <Copy size={15} />}
                                        {copied === 'code' ? 'Copied' : 'Copy code only'}
                                    </button>

                                    <button
                                        type="button"
                                        className={secondaryButton}
                                        onClick={() => setMode('claim')}
                                    >
                                        Claim it myself
                                        <ArrowRight size={15} />
                                    </button>
                                </div>

                                <p className="mt-4 text-sm leading-6 text-gray-400">
                                    Save the code now: XOGrid does not keep it. Anyone who has it can claim the money.
                                </p>

                                <TransactionLine id={issued.transactionId} network={issued.network} />
                            </motion.section>
                        )}
                    </AnimatePresence>
                </div>
            ) : (
                <section className={`${cardClass} p-5 sm:p-7`}>
                    <StepHeading
                        n={1}
                        title="Claim a voucher"
                        hint="Paste the secret code and say where the money should go. No wallet is needed."
                    />

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="claim-code" className="block text-sm font-medium text-gray-300">
                                Secret claim code
                            </label>
                            <input
                                id="claim-code"
                                className={`${inputClass} mt-2 font-mono`}
                                value={claimCode}
                                onChange={(event) => setClaimCode(event.target.value)}
                                placeholder="Paste the code you were given"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>

                        <div>
                            <label htmlFor="claim-destination" className="block text-sm font-medium text-gray-300">
                                Where should the money go?
                            </label>
                            <input
                                id="claim-destination"
                                className={`${inputClass} mt-2 font-mono`}
                                value={destination}
                                onChange={(event) => setDestination(event.target.value)}
                                placeholder={`Your BCH address, starting with ${NETWORKS[network].prefix}:`}
                                autoComplete="off"
                                spellCheck={false}
                            />

                            {suggestedAddress && destination === '' && (
                                <button
                                    type="button"
                                    className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-orange-400 transition hover:text-orange-300"
                                    onClick={() => setDestination(suggestedAddress)}
                                >
                                    <Wallet size={14} />
                                    Use my wallet address
                                </button>
                            )}
                        </div>

                        <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-xs text-gray-500">Network fee (paid to miners)</p>
                                <p className="mt-0.5 font-semibold text-white">{CLAIM_FEE_SATOSHIS.toString()} sats</p>
                            </div>

                            <button
                                type="button"
                                className={`${primaryButton} w-full sm:w-auto`}
                                disabled={
                                    !enabled ||
                                    busy ||
                                    claimCode.trim() === '' ||
                                    destination.trim() === ''
                                }
                                onClick={claim}
                            >
                                {busy ? (
                                    <>
                                        <Loader2 size={17} className="animate-spin" />
                                        Working...
                                    </>
                                ) : (
                                    <>
                                        <LockKeyhole size={17} />
                                        Claim voucher
                                        <ArrowRight size={16} />
                                    </>
                                )}
                            </button>
                        </div>

                        {!enabled ? (
                            <p className="text-xs text-amber-300">Tick the box at the top to use real BCH.</p>
                        ) : null}

                        <p className="text-xs leading-5 text-gray-500">
                            Before anything is sent, the page checks the claim in the BCH virtual machine. If the code
                            is wrong, nothing happens.
                        </p>

                        <AnimatePresence>
                            {claimStatus && (
                                <Notice type="info">
                                    <div className="flex items-center gap-2">
                                        <Loader2 size={16} className="animate-spin" />
                                        {claimStatus}
                                    </div>
                                </Notice>
                            )}

                            {claimed && (
                                <Notice type="success">
                                    <div className="flex items-center gap-2 text-base font-semibold">
                                        <CheckCircle2 size={20} />
                                        Voucher claimed. The money is on its way.
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-gray-400">
                                        The code is now public on the blockchain, so this voucher cannot be used again.
                                    </p>
                                    <TransactionLine id={claimed.transactionId} network={claimed.network} />
                                </Notice>
                            )}
                        </AnimatePresence>
                    </div>
                </section>
            )}

            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                <ShieldCheck size={20} className="mt-0.5 shrink-0 text-orange-400" />
                <div>
                    <p className="text-sm font-semibold text-gray-200">Good to know</p>
                    <p className="mt-1 text-sm leading-6 text-gray-500">
                        The code becomes public the moment a voucher is claimed, and someone watching the network could
                        try to claim first. Keep amounts small. The code in the claim link stays in your browser and
                        is never sent to XOGrid.
                    </p>
                </div>
            </div>
        </div>
    );
}

/** The Demo page: pick any registry template. The Claim-Code Voucher and Drip Mine run live; every other template opens as a guide. */
export default function Demo() {
    const navigate = useNavigate();
    const [selected, setSelected] = useState<string>(VOUCHER_TEMPLATE_IDENTIFIER);
    const viewRef = useRef<HTMLDivElement>(null);

    const select = (identifier: string) => {
        setSelected(identifier);
        // Bring the chosen template into view, so on a small screen the person is not left looking at the list.
        window.setTimeout(() => viewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    };

    const goBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/');
        }
    };

    return (
        <main className="relative min-h-screen overflow-hidden bg-[#05070B] pb-20 text-white">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-orange-600/[0.08] blur-[130px]" />
                <div className="absolute -right-40 top-[40%] h-[480px] w-[480px] rounded-full bg-amber-500/[0.05] blur-[140px]" />
            </div>

            <div className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6">
                <header className="flex items-center justify-between border-b border-white/[0.07] py-5">
                    <button
                        type="button"
                        onClick={goBack}
                        className="group inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-gray-300 transition hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-white"
                    >
                        <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
                        Back
                    </button>

                    <Link to="/" className="flex items-center">
                        <img src={xogridlogo} alt="XOGrid" className="h-9 w-auto object-contain sm:h-10" />
                    </Link>

                    <span className="w-[84px]" aria-hidden="true" />
                </header>

                <motion.section
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="py-10 text-center sm:py-14"
                >
                    <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
                        Try XOGrid templates{' '}
                        <span className="bg-gradient-to-r from-orange-300 via-orange-500 to-amber-300 bg-clip-text text-transparent">
                            live
                        </span>
                    </h1>
                    <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-gray-400">
                        Pick a template and watch it work on the Bitcoin Cash network. New here? Start with the voucher:
                        lock some BCH behind a secret code, then claim it from any browser.
                    </p>
                </motion.section>

                <TemplatePicker selected={selected} live={LIVE_TEMPLATES} onSelect={select} />

                <div ref={viewRef} className="mt-10 scroll-mt-6">
                    {selected === VOUCHER_TEMPLATE_IDENTIFIER ? (
                        <VoucherDemo />
                    ) : (
                        <div className="space-y-8">
                            {selected === DRIP_MINE_TEMPLATE_IDENTIFIER ? <RunDripMine /> : null}
                            <TemplateGuide identifier={selected} />
                        </div>
                    )}
                </div>

                <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/[0.07] pt-6 sm:flex-row">
                    <p className="text-xs text-gray-600">XOGrid · Template demo</p>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 transition hover:text-orange-400"
                    >
                        Back to XOGrid
                        <ArrowRight size={14} />
                    </Link>
                </footer>
            </div>
        </main>
    );
}
