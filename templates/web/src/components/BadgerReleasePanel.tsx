import { Coins } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    badgerAddress,
    badgerLockingBytecode,
    badgersStakeTemplateIdentifier,
    blocksUntilRelease,
    buildBadgerReleaseInvitation,
    readStakeLock,
    type ReleaseInvitation,
    type StakeLock,
} from '../lib/badgers-stake';
import type { Network } from '../lib/invitation';
import { AddressBar, BuildError, CoinsGate, MainnetWarning, NetworkBar, errorText, scrollIntoViewSoon, useContractCoins } from './common';
import { InvitationResult } from './InvitationResult';
import { Pill, Section, StatusMessage, formatBch, formatSatoshis, primaryButton, shortHash, smallButton } from './ui';

const PAGE_SIZE = 25;
const outpointOf = (lock: Pick<StakeLock, 'transactionHash' | 'outputIndex'>): string => `${lock.transactionHash}:${lock.outputIndex}`;

export function BadgerReleasePanel() {
    // The live contract and its masterBadger category exist on mainnet. Chipnet is listed only so the page shows that it is empty there.
    const [network, setNetwork] = useState<Network>('mainnet');
    const { coins, reload } = useContractCoins(network, badgerLockingBytecode);
    const [shown, setShown] = useState(PAGE_SIZE);
    const [result, setResult] = useState<ReleaseInvitation | undefined>();
    const [buildError, setBuildError] = useState<string | undefined>();
    const resultRef = useRef<HTMLDivElement>(null);
    const address = useMemo(() => badgerAddress(network), [network]);

    useEffect(() => {
        setResult(undefined);
        setBuildError(undefined);
        setShown(PAGE_SIZE);
    }, [network]);

    const build = (lock: StakeLock, tipHeight: number): void => {
        setBuildError(undefined);

        try {
            setResult(buildBadgerReleaseInvitation(network, lock, tipHeight));
            scrollIntoViewSoon(resultRef.current);
        } catch (error) {
            setResult(undefined);
            setBuildError(errorText(error));
        }
    };

    return (
        <Section
            icon={<Coins size={24} />}
            title="Badgers Stake"
            description={
                <>
                    Release a finished stake. Anyone can release a lock once its period has passed: the BCH, the BadgerCoins and a Honey NFT receipt go
                    to the staker who made it, never to you. Staking itself needs your own coin and signature, so use your XO wallet's stake action for
                    that. Template{' '}
                    <span className="font-mono text-gray-400" title={badgersStakeTemplateIdentifier}>
                        {shortHash(badgersStakeTemplateIdentifier)}
                    </span>
                    .
                </>
            }
        >
            <NetworkBar network={network} onChange={setNetwork} loading={coins.status === 'loading'} onRefresh={reload} />

            {network === 'mainnet' && (
                <MainnetWarning>
                    This releases someone else's stake to them, for a 1,000-sat miner fee taken from the stake. It cannot send their funds anywhere else.
                    This page only builds the invitation; your wallet broadcasts it.
                </MainnetWarning>
            )}

            <AddressBar address={address} />

            <CoinsGate
                coins={coins}
                emptyText={
                    network === 'mainnet'
                        ? 'No coins at the BadgerStake address right now.'
                        : 'The live BadgerStake contract and its masterBadger exist on mainnet only. Switch to mainnet.'
                }
            >
                {(loaded) => {
                    const locks = loaded.coins.flatMap((coin) => {
                        const lock = readStakeLock(coin, network);

                        return lock ? [lock] : [];
                    });

                    if (locks.length === 0) {
                        return <StatusMessage type="info">No stake locks are listed. The coin at this address may be only the masterBadger.</StatusMessage>;
                    }

                    // Ready locks first, then the ones closest to ready.
                    const ordered = [...locks].sort((a, b) => blocksUntilRelease(a, loaded.tipHeight) - blocksUntilRelease(b, loaded.tipHeight));
                    const ready = ordered.filter((lock) => blocksUntilRelease(lock, loaded.tipHeight) === 0 && lock.height > 0).length;
                    const visible = ordered.slice(0, shown);

                    return (
                        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
                            <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-gray-500">
                                {locks.length.toLocaleString('en-US')} stake locks · {ready.toLocaleString('en-US')} ready to release
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[720px] text-left text-sm">
                                    <thead className="text-[11px] uppercase tracking-wider text-gray-500">
                                        <tr>
                                            <th className="px-4 py-2 font-semibold">Lock</th>
                                            <th className="px-4 py-2 font-semibold">Staker</th>
                                            <th className="px-4 py-2 font-semibold">Staked</th>
                                            <th className="px-4 py-2 font-semibold">BadgerCoins</th>
                                            <th className="px-4 py-2 font-semibold">Period</th>
                                            <th className="px-4 py-2 font-semibold">Status</th>
                                            <th className="px-4 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visible.map((lock) => {
                                            const left = blocksUntilRelease(lock, loaded.tipHeight);
                                            const isReady = left === 0 && lock.height > 0;

                                            return (
                                                <tr key={outpointOf(lock)} className="border-t border-white/[0.04]">
                                                    <td className="px-4 py-2.5 font-mono text-xs text-gray-300" title={outpointOf(lock)}>
                                                        {shortHash(lock.transactionHash)}:{lock.outputIndex}
                                                    </td>
                                                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400" title={lock.stakerAddress}>
                                                        {lock.stakerAddress.replace(/^[a-z]+:/, '').slice(0, 10)}…{lock.stakerAddress.slice(-6)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-gray-300" title={formatSatoshis(lock.lockSatoshis)}>
                                                        {formatBch(lock.lockSatoshis)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-gray-300">{lock.rewardTokens.toLocaleString('en-US')}</td>
                                                    <td className="px-4 py-2.5 text-gray-400">{lock.stakeBlocks.toLocaleString('en-US')} blocks</td>
                                                    <td className="px-4 py-2.5">
                                                        {lock.height <= 0 ? (
                                                            <Pill>unconfirmed</Pill>
                                                        ) : isReady ? (
                                                            <Pill tone="emerald">ready</Pill>
                                                        ) : (
                                                            <Pill tone="violet">{left.toLocaleString('en-US')} blocks left</Pill>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <button type="button" className={isReady ? primaryButton : smallButton} disabled={!isReady} onClick={() => build(lock, loaded.tipHeight)}>
                                                            Release
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {visible.length < ordered.length && (
                                <div className="border-t border-white/[0.06] p-3 text-center">
                                    <button type="button" className={smallButton} onClick={() => setShown((count) => count + PAGE_SIZE)}>
                                        Show {Math.min(PAGE_SIZE, ordered.length - visible.length)} more
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                }}
            </CoinsGate>

            <BuildError message={buildError} />

            <div ref={resultRef}>
                {result && (
                    <InvitationResult
                        result={result}
                        network={network}
                        action="release"
                        actionTone="violet"
                        details={[
                            { label: 'Released to', value: <span className="font-mono text-xs">{result.stakerAddress}</span> },
                            { label: 'BCH released', value: formatSatoshis(result.releasedSatoshis) },
                            { label: 'BadgerCoins', value: result.rewardTokens.toLocaleString('en-US') },
                            { label: 'Miner fee', value: formatSatoshis(result.feeSatoshis) },
                        ]}
                        note="Import this in your XO wallet and run the action. It already holds the lock, its unlocking bytecode and the three payouts, so your wallet adds no coins and no signatures; the commits are signed by a throwaway key made for this invitation. If someone else releases the same lock first, this invitation stops working."
                    />
                )}
            </div>
        </Section>
    );
}
