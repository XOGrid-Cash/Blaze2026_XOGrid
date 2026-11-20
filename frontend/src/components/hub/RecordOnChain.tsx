import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Link2, Loader2 } from "lucide-react";

import {
  broadcastReceipt,
  checkReceipt,
  getReceiptSettings,
  prepareReceipt,
  type ReceiptNetwork,
  type ReceiptSettings,
  type ReceiptStatus,
} from "../../hub/api";
import { explorerUrl, networkLabel } from "../../hub/receipts";
import { publicKeyHex, signWithWallet } from "../../hub/wallet";
import { useWallet } from "../../hub/WalletContext";

type Phase = "idle" | "preparing" | "signing" | "sending";

const POLL_MS = 20_000;
const MAX_POLLS = 90;

/**
 * Optional second step after a review is published: record it on Bitcoin Cash as a receipt. XOGrid builds the
 * transaction, the wallet signs it, and XOGrid checks the signature before sending it. The review is already published
 * whatever happens here. This step has not been verified with every wallet.
 */
export function RecordOnChain({ identifier, reviewId, onChange }: { identifier: string; reviewId: number; onChange: () => void }) {
  const { session, connected, openModal } = useWallet();
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [network, setNetwork] = useState<ReceiptNetwork>("chipnet");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ReceiptStatus | null>(null);
  const [already, setAlready] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    let live = true;

    getReceiptSettings()
      .then((value) => {
        if (!live) return;
        setSettings(value);

        if (!value.networks.chipnet && value.networks.mainnet) setNetwork("mainnet");
      })
      .catch(() => live && setSettings(null));

    return () => {
      live = false;
    };
  }, []);

  // While the receipt is pending, ask the server to look again until it confirms.
  useEffect(() => {
    if (!status || status.status !== "pending") return;

    polls.current = 0;

    const timer = window.setInterval(async () => {
      polls.current += 1;

      try {
        const next = await checkReceipt(identifier, reviewId, status.network, status.txid);

        if (next.status === "confirmed") {
          setStatus(next);
          onChange();
        }
      } catch {
        // Not visible yet or the server is busy: try again on the next tick.
      }

      if (polls.current >= MAX_POLLS) window.clearInterval(timer);
    }, POLL_MS);

    return () => window.clearInterval(timer);
    // onChange only reloads data and is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.txid, status?.status]);

  if (!settings?.enabled) return null;

  const available = (Object.keys(settings.networks) as ReceiptNetwork[]).filter((key) => settings.networks[key]);
  const busy = phase !== "idle";

  async function record() {
    setError(null);

    if (!session || !connected) {
      openModal();
      setError("Connect your wallet, then press the button again.");

      return;
    }

    try {
      setPhase("preparing");

      const publicKey = await publicKeyHex(session);
      const prepared = await prepareReceipt(identifier, reviewId, network, publicKey);

      setPhase("signing");

      const signed = await signWithWallet(session, prepared.walletSignRequest, "transaction");

      setPhase("sending");
      setStatus(await broadcastReceipt(identifier, reviewId, network, signed));
      onChange();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Something went wrong.";

      if (/already recorded/i.test(message)) setAlready(true);
      else setError(message);
    } finally {
      setPhase("idle");
    }
  }

  if (already) {
    return (
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-sm text-emerald-200">
        <CheckCircle2 size={18} className="mb-2" />
        This review is already recorded on-chain.
      </div>
    );
  }

  if (status) {
    const confirmed = status.status === "confirmed";

    return (
      <div className={`rounded-2xl border p-5 text-sm ${confirmed ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
        {confirmed ? <CheckCircle2 size={18} className="mb-2" /> : <Clock size={18} className="mb-2" />}
        <p>
          {confirmed
            ? `Recorded on-chain (${networkLabel(status.network)}).`
            : `Sent on ${networkLabel(status.network)}. Waiting for the first confirmation, usually about ten minutes. You can leave this page: the review shows "pending" until it confirms.`}
        </p>
        <a href={explorerUrl(status.network, status.txid)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-mono text-xs underline">
          {status.txid.slice(0, 12)}...{status.txid.slice(-8)} <ExternalLink size={12} />
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0e16]/80 p-5 sm:p-6">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
        <Link2 size={18} /> Also record it on-chain (optional)
      </h3>
      <p className="mt-1 text-sm leading-6 text-slate-400">
        Your review is already published. This adds a public receipt on Bitcoin Cash that ties your key, the rating and a
        fingerprint of your text to this template. The text itself stays on XOGrid.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {available.map((key) => (
          <button
            key={key}
            type="button"
            disabled={busy}
            onClick={() => setNetwork(key)}
            className={`rounded-xl border px-3 py-2 text-sm transition ${network === key ? "border-orange-400/60 bg-orange-500/15 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
          >
            {networkLabel(key)}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-1 text-xs leading-5 text-slate-500">
        <li>
          Cost: {settings.paymentSatoshis} sats to the XOGrid review address plus a network fee of about 500 sats.{" "}
          {network === "mainnet" ? "This is real money." : "Chipnet coins have no value."}
        </li>
        <li>Needs a coin on your wallet&apos;s first receive address. Your wallet shows the exact amounts before you approve.</li>
        <li>This step has not been verified with every wallet. If it fails, your review stays published.</li>
      </ul>

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={record}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
        {phase === "preparing" ? "Preparing..." : phase === "signing" ? "Approve in your wallet..." : phase === "sending" ? "Checking and sending..." : "Record on-chain"}
      </button>
    </div>
  );
}
