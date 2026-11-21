import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Copy, Download, ExternalLink, FileJson, Loader2, Play, RefreshCw, Wallet } from "lucide-react";

import { explorerUrl } from "../../hub/receipts";
import {
  listDripCoins,
  prepareDripInvitation,
  runDripMine,
  type DripCoinView,
  type DripInvitation,
  type DripRun,
  type RunNetwork,
} from "../../hub/run";

const NETWORKS: { key: RunNetwork; label: string; hint: string }[] = [
  { key: "chipnet", label: "Practice mode", hint: "Test network, no real money" },
  { key: "mainnet", label: "Real BCH", hint: "Main network, real coins" },
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
  const [preparing, setPreparing] = useState<string | undefined>();
  const [invite, setInvite] = useState<DripInvitation | undefined>();
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
    setInvite(undefined);
    setCoins(undefined);
  };

  // Builds an invitation for the user's own wallet. Nothing is broadcast, so no mainnet confirmation is needed.
  const getInvitation = async (coin: DripCoinView) => {
    setPreparing(coinKey(coin));
    setError("");
    setDone(undefined);

    try {
      setInvite(await prepareDripInvitation({ network, txid: coin.txid, index: coin.index }));
    } catch (caught) {
      setInvite(undefined);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPreparing(undefined);
    }
  };

  const run = async (coin: DripCoinView, anyCoin = false) => {
    setRunning(coinKey(coin));
    setError("");
    setInvite(undefined);

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
  const hasSpendable = coins !== undefined && coins.some((coin) => coin.spendable);
  const busy = running !== undefined || preparing !== undefined;

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0D1117]/90 p-5 shadow-2xl shadow-black/20 sm:p-7">
      <h2 className="text-xl font-semibold tracking-tight text-white">Run Drip Mine live</h2>
      <p className="mt-2 text-sm leading-6 text-gray-400">
        Drip Mine is a shared pot of coins that slowly pays out to miners. Anyone can trigger one payout per block. You
        need no wallet, it costs you nothing and you receive nothing: this simply shows the contract working on a real
        network.
      </p>

      <div className="mt-6">
        <p className="text-sm font-medium text-gray-200">Where do you want to run it?</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {NETWORKS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => choose(item.key)}
              aria-pressed={network === item.key}
              className={`rounded-xl border p-4 text-left transition ${
                network === item.key
                  ? "border-orange-500/60 bg-orange-500/[0.08]"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <span className="block text-sm font-semibold text-white">{item.label}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {network === "mainnet" && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 h-4 w-4 accent-orange-500"
          />
          <span>I understand this uses real BCH from the shared Drip Mine pot and pays it to a miner.</span>
        </label>
      )}

      {loading && coins === undefined && (
        <p className="mt-6 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin text-orange-400" /> Looking for coins in the Drip Mine...
        </p>
      )}

      {coins !== undefined && coins.length === 0 && (
        <p className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm leading-6 text-gray-400">
          The Drip Mine has no coins on {network === "chipnet" ? "the practice network" : "the main network"} right now, so
          there is nothing to run.
        </p>
      )}

      {hasSpendable && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!allowed || busy}
            onClick={() => {
              const first = coins?.find((coin) => coin.spendable);

              if (first) void run(first, true);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running !== undefined ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {running !== undefined ? "Running..." : "Run one for me"}
          </button>
          {network === "mainnet" && !confirmed ? (
            <span className="text-xs text-gray-500">Tick the box above to enable this.</span>
          ) : (
            <span className="text-xs text-gray-500">Picks a coin for you and sends the payout.</span>
          )}
        </div>
      )}

      {hasSpendable && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-gray-500">
          <Wallet size={14} className="mt-0.5 shrink-0 text-gray-400" />
          Rather run it from your own XO wallet? Press "Copy invitation" on a coin below. XOGrid builds and checks the
          invitation but sends nothing; your wallet imports it and broadcasts the spend.
        </p>
      )}

      {error && (
        <p className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/[0.07] p-4 text-sm leading-6 text-rose-300">{error}</p>
      )}

      {invite && <InvitationPanel key={invite.invitationIdentifier} invite={invite} />}

      {done && (
        <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-sm text-emerald-200">
          <div className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 size={20} /> Done. Your payout was sent on {done.network === "mainnet" ? "the main network" : "the practice network"}.
          </div>
          <p className="mt-2 leading-6">
            XOGrid built this transaction with the XO engine from the Drip Mine template, checked it against an
            independent builder and the contract in the BCH 2026 virtual machine, then broadcast it. It can take a moment
            to show up on the explorer.
          </p>
          <a
            href={explorerUrl(done.network, done.transactionId)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 px-3 py-2 text-xs font-semibold transition hover:bg-emerald-400/10"
          >
            View on the explorer <ExternalLink size={12} />
          </a>
          <p className="mt-3 break-all font-mono text-xs text-emerald-100/80">{done.transactionId}</p>
          <p className="mt-3 text-xs leading-5 text-emerald-100/80">
            {done.action === "drip" ? "Drip" : "Final payout"} of the coin {done.coin.txid.slice(0, 12)}…:{done.coin.index} (
            {done.coin.satoshis.toLocaleString()} sats). Fee {done.payoutSatoshis.toLocaleString()} sats, {done.sizeBytes} bytes.
            {done.coinsSkipped ? ` ${done.coinsSkipped} other coin(s) had already been taken, so the next one was used.` : ""}
          </p>
          <details className="mt-3 text-xs text-emerald-100">
            <summary className="cursor-pointer font-medium">Show the raw transaction</summary>
            {done.builtBy && (
              <p className="mt-2 leading-5">
                Built by the XO engine ({done.builtBy.engine}) from the Drip Mine template{" "}
                <span className="break-all font-mono">{done.builtBy.templateIdentifier}</span>.
              </p>
            )}
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 font-mono">
              {done.transactionHex}
            </pre>
          </details>
        </div>
      )}

      {coins !== undefined && coins.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">Coins in the Drip Mine</h3>
            <button
              type="button"
              onClick={() => void load(network)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition hover:text-white disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <ul className="mt-3 space-y-3">
            {coins.map((coin) => (
              <li key={coinKey(coin)} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">
                      {coin.satoshis.toLocaleString()} sats{" "}
                      <span className="font-normal text-gray-500">· {coin.action === "drip" ? "regular payout" : "final payout"}</span>
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-400">
                      {coin.payoutSatoshis.toLocaleString()} sats go to the miner as the fee
                      {coin.action === "drip"
                        ? `, ${coin.remainderSatoshis.toLocaleString()} sats stay in the pot.`
                        : ", and the coin ends."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!coin.spendable || busy}
                      onClick={() => void getInvitation(coin)}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {preparing === coinKey(coin) ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
                      Copy invitation
                    </button>
                    <button
                      type="button"
                      disabled={!coin.spendable || !allowed || busy}
                      onClick={() => void run(coin)}
                      className="inline-flex items-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-2.5 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {running === coinKey(coin) ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                      Run this one
                    </button>
                  </div>
                </div>
                {!coin.spendable && coin.reason && <p className="mt-2 text-xs text-amber-200">{coin.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {address && (
        <p className="mt-6 text-xs leading-5 text-gray-500">
          Drip Mine address on {network === "chipnet" ? "the practice network" : "the main network"}:{" "}
          <span className="break-all font-mono">{address}</span>
        </p>
      )}
    </section>
  );
}

const prettyJson = (serialized: string): string => {
  try {
    return JSON.stringify(JSON.parse(serialized), null, 2);
  } catch {
    return serialized;
  }
};

const timeLeft = (expiresAt: Date, now: number): string => {
  const minutes = Math.max(0, Math.round((expiresAt.getTime() - now) / 60_000));

  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
};

/** A ready XO invitation for one coin: copy or download it, then import it into an XO wallet. Nothing was broadcast. */
function InvitationPanel({ invite }: { invite: DripInvitation }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = new Date(invite.expiresAt);
  const expired = expiresAt.getTime() <= now;
  const mainnet = invite.network === "mainnet";

  // The panel is keyed by the invitation, so a new invitation starts it fresh; this only keeps the countdown moving.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);

    return () => window.clearInterval(timer);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.invitation);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopyFailed(true);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([invite.invitation], { type: "application/json" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `drip-mine-${invite.network}-${invite.coin.txid.slice(0, 12)}-${invite.coin.index}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-500/[0.06] p-5 text-sm text-sky-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Wallet size={20} className="text-sky-300" /> Your invitation is ready
          </div>
          <p className="mt-1 text-xs text-sky-200/80">
            For {mainnet ? "the main network (real BCH)" : "the practice network"} · {invite.action === "drip" ? "drip" : "final payout"} · not broadcast
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={expired}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy invitation"}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={expired}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-400/30 px-4 py-2.5 text-sm font-semibold transition hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={15} /> Download .json
          </button>
        </div>
      </div>

      {copyFailed && (
        <p className="mt-3 text-xs text-amber-200">Your browser blocked the clipboard. Use Download, or copy the JSON below by hand.</p>
      )}

      <p className="mt-4 leading-6">
        Import this into your XO wallet. The wallet builds the spend and broadcasts it itself: XOGrid has sent nothing. The
        coin needs no signature from you and you receive nothing; {invite.payoutSatoshis.toLocaleString()} sats go to the
        miner as the fee.
      </p>
      <p className="mt-2 text-xs leading-5 text-sky-200/80">
        The coin is shared, so anyone can spend it first. If your wallet says the inputs are missing, refresh the list and
        get a new invitation. {expired ? (
          <span className="font-semibold text-amber-200">This invitation has expired: get a new one.</span>
        ) : (
          <>Import it before {expiresAt.toLocaleString()} (in {timeLeft(expiresAt, now)}).</>
        )}
      </p>

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-sky-200/60">Coin</dt>
          <dd className="truncate font-mono" title={`${invite.coin.txid}:${invite.coin.index}`}>
            {invite.coin.txid.slice(0, 12)}…:{invite.coin.index} ({invite.coin.satoshis.toLocaleString()} sats)
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sky-200/60">Transaction your wallet will build</dt>
          <dd className="truncate font-mono" title={invite.transactionId}>
            {invite.transactionId}
          </dd>
        </div>
      </dl>

      <details className="mt-4 text-xs">
        <summary className="flex cursor-pointer items-center gap-2 font-medium">
          <FileJson size={14} /> Show the invitation JSON
        </summary>
        {invite.builtBy && (
          <p className="mt-2 leading-5 text-sky-200/80">
            Built by the XO engine ({invite.builtBy.engine}) from the Drip Mine template, checked against an independent
            builder and the BCH 2026 virtual machine. Its commits are signed by a throwaway key that holds nothing.
          </p>
        )}
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-sky-100/90">{prettyJson(invite.invitation)}</pre>
      </details>
    </div>
  );
}
