import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";

import { finishReview, startReview } from "../../hub/api";
import { publicKeyHex, signWithWallet, type WalletSession } from "../../hub/wallet";
import { useWallet } from "../../hub/WalletContext";
import { RecordOnChain } from "./RecordOnChain";
import { Stars } from "./Stars";

type Phase = "idle" | "connecting" | "signing" | "posting";
type Outcome = "published" | "already";

// Remembered per template so the form stays closed after the page reloads its data (or the person comes back later).
// Storage can be blocked, so every access is wrapped; without it the server still refuses a second review.
const storageKey = (identifier: string) => `xogrid:reviewed:${identifier}`;

function readOutcome(identifier: string): Outcome | null {
  try {
    const value = window.localStorage.getItem(storageKey(identifier));

    return value === "published" || value === "already" ? value : null;
  } catch {
    return null;
  }
}

const idKey = (identifier: string) => `xogrid:review-id:${identifier}`;

function readReviewId(identifier: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(idKey(identifier)));

    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeOutcome(identifier: string, outcome: Outcome, reviewId?: number) {
  try {
    if (reviewId) window.localStorage.setItem(idKey(identifier), String(reviewId));
    window.localStorage.setItem(storageKey(identifier), outcome);
  } catch {
    // Not remembering is fine.
  }
}

/**
 * Wallet-signed review. The server holds the review text while the wallet signs, so the signature can only publish
 * exactly what the user wrote. The wallet signs a message-only transaction that is never broadcast and moves no funds.
 */
export function ReviewForm({ identifier, onPosted }: { identifier: string; onPosted: () => void }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(() => readOutcome(identifier));
  const [reviewId, setReviewId] = useState<number | null>(() => readReviewId(identifier));

  // The wallet is the site-wide connection. If it is not connected yet, the shared connect modal opens and the review
  // continues on its own once the person has connected.
  const { session, connected, modalOpen, openModal } = useWallet();

  const valid = rating >= 1 && body.trim().length >= 3 && body.trim().length <= 1000;

  async function postWith(current: WalletSession) {
    setPhase("signing");

    const publicKey = await publicKeyHex(current);
    const challenge = await startReview(identifier, rating, body.trim(), publicKey);

    if (!challenge.walletSignRequest) {
      throw new Error("The server did not return a signing request.");
    }

    const signed = await signWithWallet(current, challenge.walletSignRequest);

    setPhase("posting");
    const saved = await finishReview(identifier, challenge.nonce, signed);

    writeOutcome(identifier, "published", saved.id);
    setReviewId(saved.id);
    setOutcome("published");
    setPhase("idle");
    onPosted();
  }

  async function submit() {
    setError(null);

    if (!session || !connected) {
      setPhase("connecting");
      openModal();

      return;
    }

    try {
      await postWith(session);
    } catch (reason) {
      fail(reason);
    }
  }

  // Waiting for the wallet: carry on as soon as it connects, or give up if the modal is closed without connecting.
  useEffect(() => {
    if (phase !== "connecting") return;

    if (connected && session) {
      postWith(session).catch(fail);
    } else if (!modalOpen) {
      setPhase("idle");
    }
    // postWith and fail only use state setters and props, so they are safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, connected, session, modalOpen]);

  function fail(reason: unknown) {
    // The server allows one review per wallet per template. If this wallet already has one, close the form
    // instead of leaving a button that can never succeed.
    if (reason instanceof Error && /already reviewed/i.test(reason.message)) {
      writeOutcome(identifier, "already");
      setOutcome("already");
      setPhase("idle");
      onPosted();

      return;
    }

    setError(reason instanceof Error ? reason.message : "Something went wrong.");
    setPhase("idle");
  }

  if (outcome) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5 text-sm text-emerald-200">
          <ShieldCheck size={18} className="mb-2" />
          {outcome === "published"
            ? "Your review was signed by your wallet and published. Thank you."
            : "This wallet has already reviewed this template. There is one review per wallet per template."}
        </div>
        {outcome === "published" && reviewId !== null && (
          <RecordOnChain identifier={identifier} reviewId={reviewId} onChange={onPosted} />
        )}
      </div>
    );
  }

  const busy = phase !== "idle";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0e16]/80 p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-white">Add your review</h3>
      <p className="mt-1 text-sm leading-6 text-slate-400">
        Your wallet signs the review to prove it comes from a real key. Nothing is broadcast and no funds move. One
        review per wallet per template. Afterwards you can choose to record it on-chain too.
      </p>

      <div className="mt-5">
        <Stars value={rating} onPick={setRating} size={26} />
      </div>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={1000}
        rows={4}
        placeholder="What did you use this template for? How did it go?"
        className="mt-4 w-full rounded-2xl border border-white/[0.08] bg-[#080a10] p-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400/50"
      />
      <p className="mt-1 text-right text-xs text-slate-600">{body.trim().length} / 1000</p>

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      <button
        type="button"
        disabled={!valid || busy}
        onClick={submit}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
        {phase === "connecting"
          ? "Connect your wallet..."
          : phase === "signing"
            ? "Approve in your wallet..."
            : phase === "posting"
              ? "Publishing..."
              : "Sign with wallet and publish"}
      </button>
    </div>
  );
}
