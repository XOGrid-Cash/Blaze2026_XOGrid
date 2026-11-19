import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { anchorId, jumpTo, KIND_LABEL, touchOnly, type RefTarget } from "../../hub/templateRefs";

// The visible parts of template links: the link itself with its hover preview, and the "Back to …" button.
// The index of link targets and the jump behaviour live in hub/templateRefs.ts.

export function BackChip({ label, onDismiss }: { label: string | null; onDismiss: () => void }) {
  if (!label) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <button
        type="button"
        onClick={() => {
          onDismiss();
          window.history.back();
        }}
        className="flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-[#161a28]/95 px-4 py-2 text-sm text-slate-200 shadow-xl shadow-black/40 backdrop-blur hover:border-orange-400/50 hover:text-white"
      >
        <ArrowLeft size={14} className="shrink-0" />
        <span className="truncate">
          Back to <span className="font-semibold">{label}</span>
        </span>
      </button>
    </div>
  );
}

function Preview({ target, anchor, rect, onEnter, onLeave, onGo }: {
  target: RefTarget;
  anchor: string;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onGo: (event: MouseEvent) => void;
}) {
  const width = Math.min(320, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
  const below = rect.bottom + 220 < window.innerHeight || rect.top < 240;
  const style = below ? { left, width, top: rect.bottom + 6 } : { left, width, bottom: window.innerHeight - rect.top + 6 };

  return createPortal(
    <div
      role="tooltip"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="fixed z-50 rounded-xl border border-white/10 bg-[#141826] p-3 font-sans text-xs shadow-2xl shadow-black/50"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-300/80">{KIND_LABEL[target.kind]}</p>
      <p className="mt-1 text-sm font-semibold text-white">{target.name}</p>
      {target.name !== target.id && <p className="font-mono text-[11px] text-slate-500">{target.id}</p>}
      {target.meta && <p className="mt-1 break-all font-mono text-[11px] text-slate-300">{target.meta}</p>}
      {target.description && <p className="mt-2 line-clamp-4 leading-5 text-slate-400">{target.description}</p>}
      <a href={`#${anchor}`} onClick={onGo} className="mt-2 inline-flex items-center gap-1 font-semibold text-orange-300 hover:text-orange-200">
        Go to definition <ArrowRight size={12} />
      </a>
    </div>,
    document.body,
  );
}

/** A link to a part of the template. Renders the children as plain text when the target does not exist. */
export function RefLink({ target, className, children }: { target: RefTarget | undefined; className?: string; children: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const show = useCallback((delay: number) => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => link.current && setRect(link.current.getBoundingClientRect()), delay);
  }, []);
  const hide = useCallback((delay: number) => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setRect(null), delay);
  }, []);

  useEffect(() => {
    if (!rect) return;

    const close = (event: Event) => {
      if (event.type === "pointerdown" && link.current?.contains(event.target as Node)) return;
      if (event.type === "pointerdown" && (event.target as Element).closest?.("[role=tooltip]")) return;
      setRect(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);

    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, [rect]);

  useEffect(() => () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  if (!target) {
    return <span className={className}>{children}</span>;
  }

  const anchor = anchorId(target.kind, target.id);
  const go = (event: MouseEvent) => {
    event.preventDefault();
    setRect(null);
    jumpTo(anchor, link.current);
  };

  return (
    <>
      <a
        ref={link}
        href={`#${anchor}`}
        className={`${className ?? ""} cursor-pointer underline decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-solid`}
        onMouseEnter={() => show(250)}
        onMouseLeave={() => hide(150)}
        onFocus={() => show(0)}
        onBlur={() => hide(150)}
        onClick={(event) => {
          // On a touch screen the first tap shows the preview; its "Go to definition" link jumps.
          if (touchOnly() && !rect) {
            event.preventDefault();
            show(0);
            return;
          }
          go(event);
        }}
      >
        {children}
      </a>
      {rect && <Preview target={target} anchor={anchor} rect={rect} onEnter={() => show(0)} onLeave={() => hide(150)} onGo={go} />}
    </>
  );
}
