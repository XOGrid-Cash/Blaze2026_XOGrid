import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";

import { getSigning, subscribeSigning, type SigningRequest } from "../hub/signing";
import { useWallet } from "../hub/WalletContext";

const SLOW_AFTER_SECONDS = 25;

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Prompt({ request }: { request: SigningRequest }) {
  const { walletName } = useWallet();
  const wallet = walletName || "your wallet";
  const [seconds, setSeconds] = useState(0);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Starts counting from when this request began, even if the prompt mounts a moment later.
  useEffect(() => {
    const tick = () => setSeconds(Math.floor((Date.now() - request.startedAt) / 1000));

    tick();

    const timer = window.setInterval(tick, 1000);

    return () => window.clearInterval(timer);
  }, [request.startedAt]);

  // Put the keyboard on Cancel, give focus back afterwards, and let Escape cancel the wait.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    cancelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") request.cancel();
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [request]);

  const isTransaction = request.kind === "transaction";

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#05070b]/85 px-4 backdrop-blur-md">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signing-title"
        aria-describedby="signing-body"
        className="w-full max-w-md rounded-3xl border border-white/[0.1] bg-[#0a0d13] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.5)] sm:p-8"
      >
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-500/10 text-orange-300">
            <Smartphone size={24} />
          </span>
          <div>
            <h2 id="signing-title" className="text-xl font-bold text-white">
              Approve in your wallet
            </h2>
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-400" aria-live="polite">
              <Loader2 size={13} className="animate-spin text-orange-300" />
              Waiting for {wallet} · {clock(seconds)}
            </p>
          </div>
        </div>

        <p id="signing-body" className="mt-5 text-sm leading-6 text-slate-300">
          {isTransaction
            ? `Open ${wallet} and check the transaction. Approve it only if the amounts and addresses are what you expect.`
            : `Open ${wallet} and approve the signing request. It only proves you control this wallet.`}
        </p>

        <ol className="mt-4 space-y-2 text-sm text-slate-400">
          <li>1. Open {wallet}.</li>
          <li>2. Find the request waiting for you.</li>
          <li>3. Review it, then approve.</li>
        </ol>

        <div className="mt-5 flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <p className="text-xs leading-5 text-slate-400">
            {isTransaction
              ? "Approving signs a real transaction and moves funds. XOGrid never sees your keys."
              : "Nothing is broadcast and no funds move. XOGrid never sees your keys."}
          </p>
        </div>

        {seconds >= SLOW_AFTER_SECONDS && (
          <p className="mt-4 text-xs leading-5 text-amber-300" role="status">
            Nothing in {wallet}? Keep it open on its home screen. If the request is gone, cancel and try again.
          </p>
        )}

        <button
          ref={cancelRef}
          type="button"
          onClick={request.cancel}
          className="mt-6 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:border-orange-400/40 hover:text-orange-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Mount once, inside the wallet provider. Shows while the wallet has been asked to sign and has not yet answered. */
export default function SigningPrompt() {
  const request = useSyncExternalStore(subscribeSigning, getSigning, getSigning);

  return request ? <Prompt key={request.id} request={request} /> : null;
}
