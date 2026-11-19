import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Check, Copy, X } from "lucide-react";

// QR code for the EMBER2026 donation address, opened from the top banner.
// Rendered into document.body so the banner's stacking context (z-[60]) can't put it under the navbar.

interface DonationQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
}

export default function DonationQrModal({ isOpen, onClose, address }: DonationQrModalProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    QRCode.toDataURL(address, {
      width: 440,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#080A12", light: "#FFFFFF" },
    })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, address]);

  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked. The address is shown in full below the QR code, so it can still be selected.
    }
  }

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#05070b]/85 px-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-qr-title"
        className="relative w-full max-w-[340px] rounded-[18px] border border-orange-500/25 bg-[#080A12] p-5 text-center shadow-[0_20px_65px_rgba(0,0,0,0.6)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close donation QR code"
          autoFocus
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-400 transition hover:border-orange-500/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <X size={16} />
        </button>

        <h2 id="donation-qr-title" className="text-lg font-bold text-white">
          EMBER2026 donations
        </h2>
        <p className="mt-1 text-xs text-slate-400">Scan with a CashTokens-aware Bitcoin Cash wallet.</p>

        <div className="mx-auto mt-4 flex h-[236px] w-[236px] items-center justify-center rounded-xl bg-white p-2">
          {qr && (
            <img
              src={qr}
              alt="QR code of the EMBER2026 donation address"
              width={220}
              height={220}
              className="h-[220px] w-[220px]"
            />
          )}
        </div>

        <code className="mt-4 block break-all font-mono text-[11px] leading-5 text-orange-200">{address}</code>

        <button
          type="button"
          onClick={copyAddress}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-orange-500/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied ? "Address copied" : "Copy address"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
