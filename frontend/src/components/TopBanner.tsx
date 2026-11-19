import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Presentation, QrCode } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { banner } from "../config/banner";
import DonationQrModal from "./DonationQrModal";

// The required BCH BLAZE 2026 banner: slides, repository and the EMBER2026 donation address.
// It sits in normal page flow at the very top of every page and scrolls away with it.
//
// Anything position:fixed at the top of the screen (the navbar, the Admin header, the Dashboard sidebar, the Docs
// sidebar) would be hidden under it, so the banner publishes how much of it is still visible as the CSS variable
// --banner-offset. Fixed elements use `top: var(--banner-offset, 0px)` and so sit just below the banner, then move to
// the top edge once it has scrolled away.

const OFFSET_VAR = "--banner-offset";

const shortAddress = (address: string): string =>
  address.length > 26 ? `${address.slice(0, 14)}…${address.slice(-8)}` : address;

const iconButtonClass =
  "inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-white/70 transition hover:border-orange-400/40 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400";

const linkClass =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-white/85 transition hover:bg-white/[0.08] hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400";

export default function TopBanner() {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = bar.current;

    if (!element) return;

    const root = document.documentElement;
    const update = () => {
      root.style.setProperty(OFFSET_VAR, `${Math.max(0, element.offsetHeight - window.scrollY)}px`);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    // The banner wraps onto more lines on narrow screens, which changes its height.
    const observer = new ResizeObserver(update);

    observer.observe(element);

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
      root.style.removeProperty(OFFSET_VAR);
    };
  }, []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(banner.emberAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked. The full address is in the title and in the text, so it can still be selected.
    }
  }

  return (
    <div
      ref={bar}
      id="xogrid-banner"
      role="region"
      aria-label="BCH BLAZE 2026 project links"
      className="relative z-[60] border-b border-orange-500/20 bg-[#0a0c14] text-[11px] text-white/70 sm:text-xs"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 md:py-5 sm:justify-between sm:px-8">
        <span className="hidden font-semibold uppercase tracking-[0.16em] text-orange-400 md:inline">
          Built for BCH BLAZE 2026
        </span>

        <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
          {banner.slidesUrl ? (
            <a href={banner.slidesUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <Presentation size={14} className="text-orange-400" />
              Widget Factory slides
              <ExternalLink size={11} className="text-white/40" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 text-white/45">
              <Presentation size={14} />
              Slides: link coming soon
            </span>
          )}

          <a href={banner.startRepoUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <FaGithub size={14} className="text-purple-500" />
            Start GitHub
            <ExternalLink size={11} className="text-white/40" />
          </a>

          <a href={banner.repoUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <FaGithub size={14} className="text-orange-400" />
            GitHub
            <ExternalLink size={11} className="text-white/40" />
          </a>

          <span className="inline-flex items-center gap-1.5 px-2 py-1">
            <span className="text-white/55">EMBER2026 donations:</span>
            <code title={banner.emberAddress} className="font-mono text-orange-200">
              <span className="hidden md:inline">{banner.emberAddress}</span>
              <span className="md:hidden">{shortAddress(banner.emberAddress)}</span>
            </code>
            <button
              type="button"
              onClick={copyAddress}
              aria-label="Copy the EMBER2026 donation address"
              title="Copy address"
              className={iconButtonClass}
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            </button>
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              aria-label="Show the EMBER2026 donation address as a QR code"
              aria-haspopup="dialog"
              title="Show QR code"
              className={iconButtonClass}
            >
              <QrCode size={13} />
            </button>
          </span>
        </div>
      </div>

      <DonationQrModal isOpen={qrOpen} onClose={() => setQrOpen(false)} address={banner.emberAddress} />
    </div>
  );
}
