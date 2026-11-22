import { cashAddressToLockingBytecode, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import { BookOpen, ChevronDown, Download, FileJson, Hammer, Lock, Search, Settings2, Vault } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getTransactionHex, listUnspentCoins, type UnspentCoinList, type UnspentCoin } from '../lib/electrum';
import type { Network, UnsignedInvitation } from '../lib/invitation';
import { planRelease, readVaultRecord, scheduleOf, tokenVault, tokenVaultTemplateText, type ScheduleEra, type VaultRecord } from '../lib/token-vault';
import { formatUnits, parseUnits } from '../lib/units';
import { AddressBar, BuildError, CoinsGate, MainnetWarning, NetworkBar, errorText, scrollIntoViewSoon, useContractCoins } from './common';
import { CopyButton, Pill, Section, StatusMessage, formatSatoshis, inputClass, primaryButton, secondaryButton, shortHash, smallButton } from './ui';

const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-500';
const EMPTY = new Uint8Array();
const MINUTES_PER_BLOCK = 10;

type Kind = 'lock' | 'release' | 'releaseFinal' | 'addFeeCoin';

interface Built {
    kind: Kind;
    invitation: Pick<UnsignedInvitation, 'serializedInvitation' | 'invitationIdentifier' | 'expiresAt'>;
    details: { label: string; value: ReactNode }[];
}

const NEXT_STEPS: Record<Kind, ReactNode> = {
    lock: (
        <ol className="list-decimal space-y-1 pl-5">
            <li>In your XO wallet, import this invitation and take the role “Owner”. The wallet generates the vault’s key.</li>
            <li>Let the wallet add the vault’s outputs (fee coin, vault tokens, state NFT, vault record) and its change.</li>
            <li>Sign and broadcast. Then copy the transaction id and paste it into “2 · Manage” here.</li>
        </ol>
    ),
    release: (
        <ol className="list-decimal space-y-1 pl-5">
            <li>Import this invitation into the XO wallet that locked the vault, as “Owner”. Only its key can sign.</li>
            <li>It already holds the vault’s two coins, the fee coin, the locktime and every output: sign the three inputs and broadcast. Add no change.</li>
            <li>Before the next release, add a fee coin.</li>
        </ol>
    ),
    releaseFinal: (
        <ol className="list-decimal space-y-1 pl-5">
            <li>Import this invitation into the XO wallet that locked the vault, as “Owner”.</li>
            <li>Sign the three inputs and broadcast. Everything left comes back to you in one output, and the vault closes.</li>
        </ol>
    ),
    addFeeCoin: (
        <ol className="list-decimal space-y-1 pl-5">
            <li>Import this invitation into your XO wallet as “Owner” and add a coin to pay for it; your wallet adds the change.</li>
            <li>The fee coin must stay output 0. Broadcast, wait for it to show here (Refresh coins), then build the release.</li>
        </ol>
    ),
};

/** A collapsible block of the guide. */
function GuideItem({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
    return (
        <details className="group rounded-xl border border-white/[0.06] bg-white/[0.02]" open={open}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-gray-200">
                {title}
                <ChevronDown size={16} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-2 px-4 pb-4 text-sm leading-6 text-gray-400">{children}</div>
        </details>
    );
}

function Guide() {
    const download = (): void => {
        const url = URL.createObjectURL(new Blob([tokenVaultTemplateText], { type: 'application/json' }));
        const link = document.createElement('a');

        link.href = url;
        link.download = 'token-vault.template.json';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <BookOpen size={14} /> How it works
                </span>
                <button type="button" className={smallButton} onClick={download}>
                    <Download size={14} /> Download template.json
                </button>
            </div>
            <GuideItem title="What a token vault is" open>
                <p>
                    A vault locks fungible tokens and releases them on a schedule like Bitcoin’s block reward: for every block mined since the last
                    release, you may release a fixed number of tokens, and every “halving length” blocks that number halves (never below 1). Only you,
                    the owner, can release, and released tokens always come back to the vault’s owner address in your XO wallet.
                </p>
                <p>
                    The full lifecycle runs from this page: <strong className="text-gray-200">lock</strong>, then <strong className="text-gray-200">release</strong> as
                    often as you like, adding a <strong className="text-gray-200">fee coin</strong> before each release after the first, until the{' '}
                    <strong className="text-gray-200">final release</strong> empties the vault.
                </p>
            </GuideItem>
            <GuideItem title="What you need">
                <ul className="list-disc space-y-1 pl-5">
                    <li>
                        An <strong className="text-gray-200">XO wallet</strong> with this template imported: use “Download template.json” above and import it in
                        the wallet’s templates. The same wallet must do every step, because the vault’s key is made inside it.
                    </li>
                    <li>
                        The <strong className="text-gray-200">tokens</strong> to lock, on one address of that wallet, plus some <strong className="text-gray-200">BCH</strong>{' '}
                        on the same address: about 9,000 satoshis to lock (5,000 become the first fee coin, 2,000 sit on the vault’s two coins), and 5,000 for
                        each later release.
                    </li>
                    <li>A coin on that address that is output 0 of its transaction (any coin you received in a transaction of its own usually is). The page tells you if there is none.</li>
                </ul>
            </GuideItem>
            <GuideItem title="Which tokens, and what each is for">
                <ul className="list-disc space-y-1 pl-5">
                    <li>
                        <strong className="text-gray-200">The token you lock</strong>: any fungible CashToken, named by its category id (64 hex characters). Amounts on
                        chain are whole base units; set <em>decimals</em> to the token’s decimals (from its issuer or the wallet that shows it) to type amounts as
                        people read them. A token with 8 decimals and “1.5” means 150,000,000 base units.
                    </li>
                    <li>
                        <strong className="text-gray-200">The vault’s state NFT</strong>: made by the vault itself, holding the last release height, the last halving
                        height and the reward. You never send, hold or buy it. Its category is the transaction id of the output-0 coin the lock spends, and every
                        release mints a new one from that release’s fee coin.
                    </li>
                    <li>
                        <strong className="text-gray-200">BCH</strong>: pays miner fees and the small amounts the vault’s coins carry. NFTs and other tokens on your address
                        are never spent by a lock.
                    </li>
                </ul>
            </GuideItem>
            <GuideItem title="Getting tokens into your XO wallet from another wallet">
                <ol className="list-decimal space-y-1 pl-5">
                    <li>In your XO wallet, copy a receiving address that accepts tokens (on mainnet it starts with “bitcoincash:z”, on chipnet “bchtest:z”).</li>
                    <li>From the wallet that holds the tokens now (Cashonize, Paytaca, Electron Cash, Zapit…), send the tokens to that address.</li>
                    <li>Send some BCH to the same address in a separate transaction; that coin will usually be output 0 and can mint the state NFT.</li>
                    <li>Paste that address in “1 · Lock”. The page reads only that one address.</li>
                </ol>
                <StatusMessage type="warning">
                    Never send tokens or BCH straight to a vault address. Only a lock made here (or by the template in your XO wallet) creates a working vault;
                    anything else sent there can never be released.
                </StatusMessage>
            </GuideItem>
            <GuideItem title="Using this page as your dapp">
                <p>Each step here builds an invitation; your XO wallet finishes it. This page never sees your keys and never broadcasts.</p>
                <ol className="list-decimal space-y-1 pl-5">
                    <li>Build the invitation here and click “Copy invitation”.</li>
                    <li>In your XO wallet, import the invitation (paste it) and accept it with the role “Owner”.</li>
                    <li>Let the wallet finish what the invitation asks for (the lock: key, outputs and change; a fee coin: a coin to pay for it; a release: only signatures).</li>
                    <li>Sign and broadcast from the wallet. Invitations expire after a few hours; build a new one if yours did.</li>
                </ol>
            </GuideItem>
        </div>
    );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
    return (
        <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{name}</dt>
            <dd className="mt-1 truncate text-sm text-gray-200">{children}</dd>
        </div>
    );
}

function UnsignedResult({ built, network }: { built: Built; network: Network }) {
    const pretty = useMemo(() => {
        try {
            return JSON.stringify(JSON.parse(built.invitation.serializedInvitation), null, 2);
        } catch {
            return built.invitation.serializedInvitation;
        }
    }, [built.invitation.serializedInvitation]);

    return (
        <div className="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="emerald">XO valid · your wallet finishes it</Pill>
                    <Pill tone="violet">{built.kind}</Pill>
                    <Pill tone={network === 'mainnet' ? 'rose' : 'gray'}>{network}</Pill>
                </div>
                <CopyButton text={built.invitation.serializedInvitation} label="Copy invitation" className={primaryButton} iconSize={16} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
                <Fact name="Invitation">
                    <span className="font-mono">{built.invitation.invitationIdentifier}</span>
                </Fact>
                {built.details.map((detail) => (
                    <Fact key={detail.label} name={detail.label}>
                        {detail.value}
                    </Fact>
                ))}
                <Fact name="Commits expire">{built.invitation.expiresAt.toLocaleString()}</Fact>
            </dl>
            <StatusMessage type="info">{NEXT_STEPS[built.kind]}</StatusMessage>
            <details>
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <FileJson size={14} /> Invitation JSON
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-white/10 bg-[#080B10] p-4 text-xs leading-relaxed text-gray-300">{pretty}</pre>
            </details>
        </div>
    );
}

const blocksToTime = (blocks: bigint): string => {
    const days = Number(blocks) * MINUTES_PER_BLOCK / 60 / 24;

    return days >= 730 ? `about ${(days / 365).toFixed(1)} years` : days >= 2 ? `about ${Math.round(days)} days` : `about ${Math.max(1, Math.round(days * 24))} hours`;
};

function Schedule({ eras, decimals, tip }: { eras: ScheduleEra[]; decimals: number; tip: number }) {
    if (eras.length === 0) {
        return null;
    }

    const shown = eras.length > 8 ? [...eras.slice(0, 6), undefined, eras.at(-1)!] : eras;
    const last = eras.at(-1)!;

    return (
        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
            <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
                {eras.length.toLocaleString('en-US')} eras. The vault is empty at block {last.toHeight.toLocaleString('en-US')},{' '}
                {last.toHeight > BigInt(tip) ? `${blocksToTime(last.toHeight - BigInt(tip))} from now` : 'already passed'} (at ~{MINUTES_PER_BLOCK} minutes per block).
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-gray-500">
                        <tr>
                            <th className="px-4 py-2 font-semibold">Era</th>
                            <th className="px-4 py-2 font-semibold">Blocks</th>
                            <th className="px-4 py-2 font-semibold">Per block</th>
                            <th className="px-4 py-2 font-semibold">Released</th>
                            <th className="px-4 py-2 font-semibold">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((era, index) =>
                            era ? (
                                <tr key={era.era} className="border-t border-white/[0.04] text-gray-300">
                                    <td className="px-4 py-2">{era.era}</td>
                                    <td className="px-4 py-2 font-mono text-xs">
                                        {era.fromHeight.toLocaleString('en-US')}–{era.toHeight.toLocaleString('en-US')}
                                    </td>
                                    <td className="px-4 py-2">{formatUnits(era.reward, decimals)}</td>
                                    <td className="px-4 py-2">{formatUnits(era.tokens, decimals)}</td>
                                    <td className="px-4 py-2">{formatUnits(era.released, decimals)}</td>
                                </tr>
                            ) : (
                                <tr key={`gap-${index}`} className="border-t border-white/[0.04] text-gray-600">
                                    <td className="px-4 py-1" colSpan={5}>
                                        …
                                    </td>
                                </tr>
                            ),
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

interface ParsedLock {
    decimals: number;
    lockAmount: bigint;
    reward: bigint;
    halvingLength: bigint;
    startHeight: bigint;
    feeCoinSatoshis: bigint;
}

/** One token kind on the pasted address, summed over its coins. */
interface TokenHolding {
    category: string;
    amount: bigint;
    coins: number;
}

function LockSection({ network, onBuilt, onError }: { network: Network; onBuilt: (built: Built) => void; onError: (message: string | undefined) => void }) {
    const [address, setAddress] = useState('');
    const [coins, setCoins] = useState<UnspentCoinList | undefined>();
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | undefined>();
    const [category, setCategory] = useState('');
    const [decimals, setDecimals] = useState('0');
    const [amount, setAmount] = useState('');
    const [reward, setReward] = useState('');
    const [halvingLength, setHalvingLength] = useState('210000');
    const [startHeight, setStartHeight] = useState('');
    const [feeCoin, setFeeCoin] = useState(String(tokenVault.MINIMUM_FEE_COIN + 2000n));

    useEffect(() => {
        setCoins(undefined);
        setLoadError(undefined);
    }, [network]);

    const holdings = useMemo((): TokenHolding[] => {
        const byCategory = new Map<string, TokenHolding>();

        for (const coin of coins?.coins ?? []) {
            if (coin.token && coin.token.nft === undefined && coin.token.amount > 0n) {
                const held = byCategory.get(coin.token.category) ?? { category: coin.token.category, amount: 0n, coins: 0 };

                byCategory.set(coin.token.category, { ...held, amount: held.amount + coin.token.amount, coins: held.coins + 1 });
            }
        }

        return [...byCategory.values()];
    }, [coins]);

    const plainSatoshis = (coins?.coins ?? []).filter((coin) => !coin.hasTokens).reduce((sum, coin) => sum + coin.valueSatoshis, 0n);
    const outputZero = (coins?.coins ?? []).filter((coin) => coin.outputIndex === 0).length;

    const load = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setLoading(true);
        setLoadError(undefined);

        try {
            const decoded = cashAddressToLockingBytecode(address.trim());

            if (typeof decoded === 'string') {
                throw new Error(`That is not a cash address: ${decoded}`);
            }

            if (address.trim().startsWith(network === 'mainnet' ? 'bchtest:' : 'bitcoincash:')) {
                throw new Error(`That is a ${network === 'mainnet' ? 'chipnet' : 'mainnet'} address; switch the network first.`);
            }

            const loaded = await listUnspentCoins(network, decoded.bytecode);

            setCoins(loaded);
            setStartHeight((current) => current || String(loaded.tipHeight));

            const first = loaded.coins.find((coin) => coin.token && coin.token.nft === undefined);

            setCategory((current) => current || first?.token?.category || '');
        } catch (error) {
            setCoins(undefined);
            setLoadError(errorText(error));
        } finally {
            setLoading(false);
        }
    };

    const parsed = ((): ParsedLock | { error: string } => {
        try {
            const places = Number.parseInt(decimals, 10);

            if (!Number.isInteger(places) || places < 0 || places > 18) {
                throw new Error('Decimals must be a whole number from 0 to 18.');
            }

            return {
                decimals: places,
                lockAmount: parseUnits(amount, places),
                reward: parseUnits(reward, places),
                halvingLength: BigInt(halvingLength.trim().replaceAll(',', '')),
                startHeight: BigInt(startHeight.trim().replaceAll(',', '')),
                feeCoinSatoshis: BigInt(feeCoin.trim().replaceAll(',', '')),
            };
        } catch (error) {
            return { error: errorText(error) };
        }
    })();
    const places = 'decimals' in parsed ? parsed.decimals : Math.max(0, Number.parseInt(decimals, 10) || 0);
    const schedule = 'lockAmount' in parsed && parsed.reward > 0n && parsed.halvingLength > 0n ? scheduleOf(parsed) : [];

    const build = (): void => {
        onError(undefined);

        try {
            if ('error' in parsed) {
                throw new Error(parsed.error);
            }

            const result = tokenVault.buildLockInvitation({ network, coins: coins?.coins ?? [], tokenCategory: category, ...parsed });

            onBuilt({
                kind: 'lock',
                invitation: result,
                details: [
                    { label: 'Locks', value: `${formatUnits(parsed.lockAmount, parsed.decimals)} of ${shortHash(category)}` },
                    { label: 'Schedule', value: `${formatUnits(parsed.reward, parsed.decimals)} per block from block ${parsed.startHeight.toLocaleString('en-US')}, halving every ${parsed.halvingLength.toLocaleString('en-US')}` },
                    { label: 'Coins spent', value: `${result.plan.inputs.length} (${formatSatoshis(result.plan.inputSatoshis)})` },
                    { label: 'State NFT category', value: <span className="font-mono">{shortHash(result.plan.genesisCoin.transactionHash)}</span> },
                    { label: 'First fee coin', value: formatSatoshis(parsed.feeCoinSatoshis) },
                    { label: 'Tokens back as change', value: formatUnits(result.plan.tokenChange, parsed.decimals) },
                ],
            });
        } catch (error) {
            onError(errorText(error));
        }
    };

    return (
        <div className="space-y-4">
            <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(event) => void load(event)}>
                <label className="block text-sm">
                    <span className={label}>Your XO wallet address holding the tokens</span>
                    <input
                        className={`${inputClass} font-mono`}
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        placeholder={network === 'mainnet' ? 'bitcoincash:z…' : 'bchtest:z…'}
                        spellCheck={false}
                    />
                </label>
                <button type="submit" className={secondaryButton} disabled={loading}>
                    <Search size={16} /> Read address
                </button>
            </form>

            <BuildError message={loadError} />

            {coins && (
                <>
                    <dl className="grid gap-3 sm:grid-cols-3">
                        <Fact name="Fungible tokens">{holdings.length === 0 ? 'none' : `${holdings.length} kind${holdings.length === 1 ? '' : 's'}`}</Fact>
                        <Fact name="Plain BCH">{formatSatoshis(plainSatoshis)}</Fact>
                        <Fact name="Coins at output 0">{outputZero}</Fact>
                    </dl>
                    {coins.tokensMayBeHidden && <StatusMessage type="warning">This Electrum server refused the token filter, so token coins may be missing.</StatusMessage>}

                    {holdings.length === 0 ? (
                        <StatusMessage type="info">No fungible tokens on this address. Send the tokens here first (see “Getting tokens into your XO wallet”).</StatusMessage>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                                <label className="block text-sm">
                                    <span className={label}>Token to lock</span>
                                    <select className={`${inputClass} font-mono`} value={category} onChange={(event) => setCategory(event.target.value)}>
                                        {holdings.map((holding) => (
                                            <option key={holding.category} value={holding.category}>
                                                {shortHash(holding.category)} · {formatUnits(holding.amount, places)} in {holding.coins} coin{holding.coins === 1 ? '' : 's'}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block text-sm">
                                    <span className={label}>Decimals</span>
                                    <input className={`${inputClass} font-mono`} value={decimals} onChange={(event) => setDecimals(event.target.value)} inputMode="numeric" />
                                </label>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block text-sm">
                                    <span className={label}>Amount to lock</span>
                                    <input className={`${inputClass} font-mono`} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1000000" inputMode="decimal" />
                                </label>
                                <label className="block text-sm">
                                    <span className={label}>Reward per block (before halvings)</span>
                                    <input className={`${inputClass} font-mono`} value={reward} onChange={(event) => setReward(event.target.value)} placeholder="50" inputMode="decimal" />
                                </label>
                                <label className="block text-sm">
                                    <span className={label}>Halving every (blocks)</span>
                                    <input className={`${inputClass} font-mono`} value={halvingLength} onChange={(event) => setHalvingLength(event.target.value)} inputMode="numeric" />
                                    <span className="mt-1 block text-xs text-gray-500">210,000 blocks is about 4 years, like Bitcoin. 144 is about a day.</span>
                                </label>
                                <label className="block text-sm">
                                    <span className={label}>Start block</span>
                                    <input className={`${inputClass} font-mono`} value={startHeight} onChange={(event) => setStartHeight(event.target.value)} inputMode="numeric" />
                                    <span className="mt-1 block text-xs text-gray-500">Defaults to the current block ({coins.tipHeight.toLocaleString('en-US')}). Releases count from here.</span>
                                </label>
                                <label className="block text-sm">
                                    <span className={label}>First fee coin (satoshis)</span>
                                    <input className={`${inputClass} font-mono`} value={feeCoin} onChange={(event) => setFeeCoin(event.target.value)} inputMode="numeric" />
                                    <span className="mt-1 block text-xs text-gray-500">Pays for the first release; at least {tokenVault.MINIMUM_FEE_COIN.toLocaleString('en-US')}.</span>
                                </label>
                            </div>

                            {'error' in parsed ? (
                                amount || reward ? <StatusMessage type="warning">{parsed.error}</StatusMessage> : null
                            ) : (
                                <Schedule eras={schedule} decimals={places} tip={coins.tipHeight} />
                            )}

                            {network === 'mainnet' && (
                                <MainnetWarning>Locked tokens can only come out on this schedule, and only to the wallet that locked them. Check every number.</MainnetWarning>
                            )}

                            <button type="button" className={primaryButton} onClick={build} disabled={!amount || !reward}>
                                <Lock size={16} /> Build lock invitation
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/** Finds the vault record (OP_RETURN "TVLT" …) in a lock transaction. */
async function findVault(network: Network, lockTransactionHash: string): Promise<VaultRecord> {
    const transaction = decodeTransactionBch(hexToBin(await getTransactionHex(network, lockTransactionHash.trim())));

    if (typeof transaction === 'string') {
        throw new Error(`That transaction does not decode: ${transaction}`);
    }

    const record = transaction.outputs.map((output) => readVaultRecord(output.lockingBytecode)).find((found) => found !== undefined);

    if (!record) {
        throw new Error('No vault record in that transaction. Enter the transaction of your lock.');
    }

    return record;
}

function ManageSection({ network, onBuilt, onError }: { network: Network; onBuilt: (built: Built) => void; onError: (message: string | undefined) => void }) {
    const [lockTransaction, setLockTransaction] = useState('');
    const [record, setRecord] = useState<VaultRecord | undefined>();
    const [lookupError, setLookupError] = useState<string | undefined>();
    const [looking, setLooking] = useState(false);
    const [height, setHeight] = useState('');
    const [decimals, setDecimals] = useState('0');
    const places = Math.min(18, Math.max(0, Number.parseInt(decimals, 10) || 0));
    const tokens = (amount: bigint): string => formatUnits(amount, places);
    const scripts = useMemo(() => (record ? tokenVault.vaultScripts(record) : undefined), [record]);
    const vaultCoins = useContractCoins(network, scripts?.vaultLockingBytecode ?? EMPTY);
    const ownerCoins = useContractCoins(network, scripts?.ownerLockingBytecode ?? EMPTY);

    useEffect(() => {
        setRecord(undefined);
        setLookupError(undefined);
    }, [network]);

    const lookUp = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setLooking(true);
        setLookupError(undefined);

        try {
            setRecord(await findVault(network, lockTransaction));
        } catch (error) {
            setRecord(undefined);
            setLookupError(errorText(error));
        } finally {
            setLooking(false);
        }
    };

    const buildFeeCoin = (): void => {
        onError(undefined);

        try {
            const invitation = tokenVault.buildAddFeeCoinInvitation({ network, record: record! });

            onBuilt({ kind: 'addFeeCoin', invitation, details: [{ label: 'Pays', value: `${formatSatoshis(tokenVault.MINIMUM_FEE_COIN + 2000n)} to the owner address, output 0` }] });
        } catch (error) {
            onError(errorText(error));
        }
    };

    const buildRelease = (vault: NonNullable<ReturnType<typeof tokenVault.readVaultCoins>>, feeCoin: UnspentCoin, tipHeight: number): void => {
        onError(undefined);

        try {
            const blockHeight = BigInt(height.trim() || String(tipHeight));
            const result = tokenVault.buildReleaseInvitation({ network, record: record!, vault, feeCoin, blockHeight, tipHeight });

            onBuilt({
                kind: result.actionIdentifier,
                invitation: result,
                details: [
                    { label: 'Release up to block', value: blockHeight.toLocaleString('en-US') },
                    { label: 'Tokens released', value: tokens(result.plan.amount) },
                    { label: 'Tokens left', value: result.plan.final ? 'none: the vault closes' : tokens(result.plan.tokensLeft) },
                    { label: 'Halving', value: result.plan.halving ? `yes: the reward becomes ${tokens(result.plan.next.reward)}` : 'no' },
                    { label: 'Fee coin', value: <span className="font-mono">{shortHash(feeCoin.transactionHash)}:0</span> },
                    { label: 'Miner fee', value: formatSatoshis(tokenVault.MINER_FEE) },
                ],
            });
        } catch (error) {
            onError(errorText(error));
        }
    };

    return (
        <div className="space-y-4">
            <form className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end" onSubmit={(event) => void lookUp(event)}>
                <label className="block text-sm">
                    <span className={label}>Lock transaction id</span>
                    <input className={`${inputClass} font-mono`} value={lockTransaction} onChange={(event) => setLockTransaction(event.target.value)} placeholder="the transaction of your lock" spellCheck={false} />
                </label>
                <label className="block text-sm">
                    <span className={label}>Decimals</span>
                    <input className={`${inputClass} font-mono`} value={decimals} onChange={(event) => setDecimals(event.target.value)} inputMode="numeric" />
                </label>
                <button type="submit" className={secondaryButton} disabled={looking}>
                    <Search size={16} /> Find vault
                </button>
            </form>

            <BuildError message={lookupError} />

            {record && scripts && (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            className={smallButton}
                            onClick={() => {
                                vaultCoins.reload();
                                ownerCoins.reload();
                            }}
                        >
                            Refresh coins
                        </button>
                    </div>
                    <AddressBar address={tokenVault.addressOf(scripts.vaultLockingBytecode, network)} />
                    <dl className="grid gap-3 sm:grid-cols-2">
                        <Fact name="Owner address (in your XO wallet)">
                            <span className="font-mono text-xs">{tokenVault.addressOf(scripts.ownerLockingBytecode, network)}</span>
                        </Fact>
                        <Fact name="Halving every">{record.halvingLength.toLocaleString('en-US')} blocks</Fact>
                    </dl>

                    <CoinsGate coins={vaultCoins.coins} emptyText="Nothing at the vault address: it is closed (all tokens released), or the lock is not visible yet.">
                        {(loaded) => {
                            const vault = tokenVault.readVaultCoins(loaded.coins);

                            if (!vault) {
                                return <StatusMessage type="info">The vault’s token coin and state NFT were not found together at this address.</StatusMessage>;
                            }

                            const tip = loaded.tipHeight;
                            const preview = (() => {
                                try {
                                    const blockHeight = BigInt(height.trim() || String(tip));

                                    return blockHeight > vault.state.releaseHeight
                                        ? planRelease({ tokens: vault.tokenCoin.token.amount, state: vault.state, halvingLength: record.halvingLength }, blockHeight)
                                        : undefined;
                                } catch {
                                    return undefined;
                                }
                            })();
                            const feeCoins = ownerCoins.coins.status === 'loaded' ? tokenVault.listFeeCoins(ownerCoins.coins.coins) : [];
                            const remaining = scheduleOf({ lockAmount: vault.tokenCoin.token.amount, reward: vault.state.reward, halvingLength: record.halvingLength, startHeight: vault.state.halvingHeight });

                            return (
                                <div className="space-y-4">
                                    <StatusMessage type="info">
                                        {tokens(vault.tokenCoin.token.amount)} tokens still locked · released up to block {vault.state.releaseHeight.toLocaleString('en-US')} · next halving at{' '}
                                        {(vault.state.halvingHeight + record.halvingLength).toLocaleString('en-US')} ·{' '}
                                        {feeCoins.length > 0 ? 'fee coin ready' : 'needs a fee coin before the next release'}
                                        {remaining.length > 0 && ` · empty around block ${remaining.at(-1)!.toHeight.toLocaleString('en-US')}`}
                                    </StatusMessage>
                                    <dl className="grid gap-3 sm:grid-cols-3">
                                        <Fact name="Tokens in the vault">{tokens(vault.tokenCoin.token.amount)}</Fact>
                                        <Fact name="Reward per block">{tokens(vault.state.reward)}</Fact>
                                        <Fact name="Current block">{tip.toLocaleString('en-US')}</Fact>
                                        <Fact name="Released up to">{vault.state.releaseHeight.toLocaleString('en-US')}</Fact>
                                        <Fact name="Last halving">{vault.state.halvingHeight.toLocaleString('en-US')}</Fact>
                                        <Fact name="Next halving">{(vault.state.halvingHeight + record.halvingLength).toLocaleString('en-US')}</Fact>
                                    </dl>

                                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                                        <label className="block text-sm">
                                            <span className={label}>Release up to block</span>
                                            <input className={`${inputClass} font-mono`} value={height} onChange={(event) => setHeight(event.target.value)} placeholder={String(tip)} inputMode="numeric" />
                                        </label>
                                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
                                            {preview ? (
                                                <>
                                                    {tokens(preview.amount)} tokens
                                                    {preview.halving && <Pill tone="violet">stops at the halving</Pill>}
                                                    {preview.final && <Pill tone="rose">closes the vault</Pill>}
                                                </>
                                            ) : (
                                                `Pick a block after ${vault.state.releaseHeight}.`
                                            )}
                                        </div>
                                    </div>

                                    {feeCoins.length === 0 ? (
                                        <StatusMessage type="warning">
                                            A release needs a plain BCH coin at output 0 of the owner address (the new state NFT is minted from it). There is none yet.{' '}
                                            <button type="button" className={smallButton} onClick={buildFeeCoin}>
                                                Build a fee coin invitation
                                            </button>
                                        </StatusMessage>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-3">
                                            <button type="button" className={primaryButton} onClick={() => buildRelease(vault, feeCoins[0]!, tip)}>
                                                <Hammer size={16} /> Build release
                                            </button>
                                            <span className="text-xs text-gray-500">
                                                Fee coin <span className="font-mono">{shortHash(feeCoins[0]!.transactionHash)}:0</span> ({formatSatoshis(feeCoins[0]!.valueSatoshis)})
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        }}
                    </CoinsGate>
                </>
            )}
        </div>
    );
}

export function TokenVaultPanel() {
    const [network, setNetwork] = useState<Network>('chipnet');
    const [step, setStep] = useState<'lock' | 'manage'>('lock');
    const [built, setBuilt] = useState<Built | undefined>();
    const [buildError, setBuildError] = useState<string | undefined>();
    const resultRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setBuilt(undefined);
        setBuildError(undefined);
    }, [network, step]);

    const show = (next: Built): void => {
        setBuildError(undefined);
        setBuilt(next);
        scrollIntoViewSoon(resultRef.current);
    };

    const fail = (message: string | undefined): void => {
        if (message) {
            setBuilt(undefined);
        }

        setBuildError(message);
    };

    return (
        <Section
            icon={<Vault size={24} />}
            title="Token Vault"
            description={
                <>
                    Lock fungible tokens in a vault that releases them on a halving schedule, then release them, from this page. Each step builds an
                    invitation that your XO wallet finishes, signs and broadcasts. Template{' '}
                    <span className="font-mono text-gray-400" title={tokenVault.templateIdentifier}>
                        {shortHash(tokenVault.templateIdentifier)}
                    </span>
                    .
                </>
            }
        >
            <Guide />

            <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Vault step">
                    {(
                        [
                            ['lock', '1 · Lock', <Lock key="lock" size={14} />],
                            ['manage', '2 · Manage', <Settings2 key="manage" size={14} />],
                        ] as const
                    ).map(([value, text, icon]) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={step === value}
                            onClick={() => setStep(value)}
                            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${step === value ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            {icon} {text}
                        </button>
                    ))}
                </div>
                <NetworkBarCompact network={network} onChange={setNetwork} />
            </div>

            {step === 'lock' ? <LockSection network={network} onBuilt={show} onError={fail} /> : <ManageSection network={network} onBuilt={show} onError={fail} />}

            <BuildError message={buildError} />

            <div ref={resultRef}>{built && <UnsignedResult built={built} network={network} />}</div>
        </Section>
    );
}

/** The network switch, without the shared bar's Refresh button (each step reloads its own coins). */
function NetworkBarCompact({ network, onChange }: { network: Network; onChange: (network: Network) => void }) {
    return (
        <div className="[&>div>button:last-child]:hidden">
            <NetworkBar network={network} onChange={onChange} loading={false} onRefresh={() => undefined} />
        </div>
    );
}
