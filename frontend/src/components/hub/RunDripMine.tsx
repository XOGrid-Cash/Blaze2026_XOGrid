import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";

import { explorerUrl } from "../../hub/receipts";
import {
  listDripCoins,
  runDripMine,
  type DripCoinView,
  type DripRun,
  type RunNetwork,
} from "../../hub/run";

const NETWORKS: { key: RunNetwork; label: string }[] = [
  { key: "chipnet", label: "Chipnet (test network)" },
  { key: "mainnet", label: "Mainnet (real BCH)" },
];

const coinKey = (coin: { txid: string; index: number }) => `${coin.txid}:${coin.index}`;

export function RunDripMine() {
  const [network, setNetwork] = useState<RunNetwork>("chipnet");
  const [confirmed, setConfirmed] = useState(false);
  const [address, setAddress] = useState("");
  const [coins, setCoins] = useState<DripCoinView[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<string | undefined>();
  const [done, setDone] = useState<DripRun | undefined>();
  const latest = useRef(0);

  const load = useCallback(async (target: RunNetwork) => {
    const request = (latest.current += 1);

    setLoading(true);
    setError("");

    try {
      const listing = await listDripCoins(target);

      if (request === latest.current) {
        setAddress(listing.address);
        setCoins(listing.coins);
      }
    } catch (caught) {
      if (request === latest.current) {
        setCoins(undefined);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (request === latest.current) {
        setLoading(false);
      }
    }
  }, []);

  // The coins load by themselves: nothing to press first.
  useEffect(() => {
    void load(network);
  }, [network, load]);

  const choose = (next: RunNetwork) => {
    setNetwork(next);
    setConfirmed(false);
    setDone(undefined);
    setCoins(undefined);
  };

  const run = async (coin: DripCoinView, anyCoin = false) => {
    setRunning(coinKey(coin));
    setError("");

    try {
      const result = await runDripMine({
        network,
        txid: coin.txid,
        index: coin.index,
        confirmMainnet: confirmed,
        anyCoin,
      });

      setDone(result);
      await load(network);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(undefined);
    }
  };

  const allowed = network === "chipnet" || confirmed;

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0c0e16]/80 p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-white">Run it on-chain</h2>
      <p className="mt-1 text-sm leading-6 text-slate-400">
        Drip Mine is a shared address that slowly releases its coins to miners. Anyone can spend one of its coins, once
        per block, and the payout goes to the miner as the transaction fee. You need no wallet, you pay nothing and you
        receive nothing: this shows the contract working on a real network.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {NETWORKS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => choose(item.key)}
            className={`rounded-xl border px-3 py-2 text-sm transition ${network === item.key ? "border-orange-400/60 bg-orange-500/15 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(network)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {network === "mainnet" && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I understand this spends real BCH from the shared Drip Mine address and pays it to a miner.</span>
        </label>
      )}

      {loading && coins === undefined && (
        <p className="mt-5 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Looking up the coins at the Drip Mine address…
        </p>
      )}

      {coins !== undefined && coins.length === 0 && (
        <p className="mt-5 text-sm leading-6 text-slate-400">
          There are no coins at the Drip Mine address on {network} right now, so there is nothing to run.
        </p>
      )}

      {coins !== undefined && coins.some((coin) => coin.spendable) && (
        <button
          type="button"
          disabled={!allowed || running !== undefined}
          onClick={() => {
            const first = coins.find((coin) => coin.spendable);

            if (first) void run(first, true);
          }}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running !== undefined ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          Run one for me
        </button>
      )}

      {coins !== undefined && coins.length > 0 && (
        <ul className="mt-5 space-y-3">
          {coins.map((coin) => (
            <li key={coinKey(coin)} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {coin.satoshis.toLocaleString()} sats{" "}
                    <span className="font-normal text-slate-400">· {coin.action === "drip" ? "drip" : "terminate"}</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {coin.payoutSatoshis.toLocaleString()} sats go to the miner as the fee
                    {coin.action === "drip"
                      ? `, ${coin.remainderSatoshis.toLocaleString()} sats stay in the Drip Mine.`
                      : ", and the coin ends."}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-slate-400">
                    {coin.txid.slice(0, 12)}…:{coin.index}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!coin.spendable || !allowed || running !== undefined}
                  onClick={() => void run(coin)}
                  className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running === coinKey(coin) ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  Run
                </button>
              </div>
              {!coin.spendable && coin.reason && <p className="mt-2 text-xs text-amber-200">{coin.reason}</p>}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      {done && (
        <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-sm text-emerald-200">
          <CheckCircle2 size={18} className="mb-2" />
          <p className="font-semibold">Sent on {done.network}.</p>
          <p className="mt-1 leading-6">
            The XO engine built this transaction from the Drip Mine template. XOGrid checked it against an independent builder and the contract in the BCH 2026 virtual machine, then
            broadcast it. It can take a moment to show up on the explorer.
          </p>
          <a
            href={explorerUrl(done.network, done.transactionId)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 break-all font-mono text-xs underline"
          >
            {done.transactionId} <ExternalLink size={12} />
          </a>
          <details className="mt-3 text-xs text-emerald-100">
            <summary className="cursor-pointer">Technical details</summary>
            {done.builtBy && (
              <p className="mt-2 leading-5">
                Built by the XO engine ({done.builtBy.engine}) from the Drip Mine template{" "}
                <span className="break-all font-mono">{done.builtBy.templateIdentifier}</span>.
              </p>
            )}
            <p className="mt-2 leading-5">
              {done.action === "drip" ? "Drip" : "Terminate"} of {done.coin.txid}:{done.coin.index} ({done.coin.satoshis}{" "}
              sats). Fee {done.payoutSatoshis} sats, {done.sizeBytes} bytes, one input with sequence number 1.
              {done.coinsSkipped ? ` ${done.coinsSkipped} other coin(s) had already been taken, so the next one was used.` : ""}
            </p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 font-mono">
              {done.transactionHex}
            </pre>
          </details>
        </div>
      )}

      {address && (
        <p className="mt-5 text-xs leading-5 text-slate-400">
          Drip Mine address on {network}: <span className="break-all font-mono">{address}</span>
        </p>
      )}
    </section>
  );
}
