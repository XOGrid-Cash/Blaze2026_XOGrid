import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { GripVertical, Keyboard, X } from "lucide-react";

import type { RefKind } from "../../hub/templateRefs";
import { SECTION_KINDS, SECTION_TITLE, SHORTCUTS, useTemplateShortcuts } from "../../hub/templateShortcuts";

function Key({ children }: { children: string }) {
  if (children === "–") {
    return <span className="px-0.5 text-slate-500">–</span>;
  }

  return (
    <kbd className="inline-flex min-w-[1.6rem] justify-center rounded-md border border-white/15 border-b-white/25 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-slate-100">
      {children}
    </kbd>
  );
}

interface Point {
  left: number;
  top: number;
}

const POSITION_KEY = "xogrid.shortcutsCardPosition";
const MARGIN = 8;

function readSavedPosition(): Point | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(POSITION_KEY) ?? "null") as Partial<Point> | null;
    return saved && Number.isFinite(saved.left) && Number.isFinite(saved.top) ? { left: Number(saved.left), top: Number(saved.top) } : null;
  } catch {
    return null;
  }
}

function savePosition(point: Point | null) {
  try {
    if (point) window.localStorage.setItem(POSITION_KEY, JSON.stringify(point));
    else window.localStorage.removeItem(POSITION_KEY);
  } catch {
    // Storage can be blocked; the position then lasts until the page is left.
  }
}

/** Keeps the whole card inside the window (or its top-left corner, when the card is taller than the window). */
function clamp(point: Point, card: HTMLElement): Point {
  const maxLeft = window.innerWidth - card.offsetWidth - MARGIN;
  const maxTop = window.innerHeight - card.offsetHeight - MARGIN;
  return {
    left: Math.round(Math.max(MARGIN, Math.min(point.left, maxLeft))),
    top: Math.round(Math.max(MARGIN, Math.min(point.top, maxTop))),
  };
}

/** Under the button when it is on screen, otherwise the top-right corner, so "?" shows the card wherever the reader is. */
function usualPlace(button: HTMLElement | null, card: HTMLElement): Point {
  const rect = button?.getBoundingClientRect();
  const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight - 200;
  if (!visible) {
    return { left: window.innerWidth - card.offsetWidth - 16, top: 16 };
  }

  // Below the button, or above it when there is only room there.
  const below = rect.bottom + 8;
  const above = rect.top - 8 - card.offsetHeight;
  const fitsBelow = below + card.offsetHeight <= window.innerHeight - MARGIN;
  return { left: rect.right - card.offsetWidth, top: fitsBelow || above < MARGIN ? below : above };
}

/**
 * Where the card sits. The reader can drag it by its title bar, or move it with the arrow keys from the grip button;
 * the spot is remembered in this browser and kept on screen when the window changes size.
 */
function useCardPosition(open: boolean, box: RefObject<HTMLElement | null>, card: RefObject<HTMLElement | null>) {
  const [place, setPlace] = useState<Point | null>(null);
  const [moved, setMoved] = useState(readSavedPosition() !== null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    // Runs before the card is painted, so it never shows at a stale spot. The place depends on the card's measured
    // size, which is only known once it is in the page, so it has to be set here.
    if (!open || !card.current) return;
    const saved = readSavedPosition();
    // eslint-disable-next-line react/set-state-in-effect
    setPlace(clamp(saved ?? usualPlace(box.current, card.current), card.current));
  }, [open, box, card]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPlace((point) => (point && card.current ? clamp(point, card.current) : point));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, card]);

  const moveTo = (point: Point, remember: boolean) => {
    if (!card.current) return;
    const next = clamp(point, card.current);
    setPlace(next);
    if (remember) {
      savePosition(next);
      setMoved(true);
    }
  };

  const reset = () => {
    savePosition(null);
    setMoved(false);
    if (card.current) setPlace(clamp(usualPlace(box.current, card.current), card.current));
  };

  const handleProps = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !place || (event.target as Element).closest("[data-no-drag]")) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, dx: event.clientX - place.left, dy: event.clientY - place.top };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      moveTo({ left: event.clientX - drag.current.dx, top: event.clientY - drag.current.dy }, false);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (place) moveTo(place, true);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (!(event.target as Element).closest("[data-no-drag]")) reset();
    },
  };

  const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const gripKeys = {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step = STEPS[event.key];
      if (!step || !place) return;
      event.preventDefault();
      const distance = event.shiftKey ? 64 : 16;
      moveTo({ left: place.left + step[0] * distance, top: place.top + step[1] * distance }, true);
    },
  };

  return { place, moved, handleProps, gripKeys, reset };
}

/**
 * The keyboard shortcuts for a template's contents: listens for them, and offers a small card that lists them.
 * The button only shows on devices with a mouse or trackpad; the keys work wherever a keyboard is attached.
 */
export function ShortcutsHelp({ sections }: { sections: RefKind[] }) {
  const [open, setOpen] = useState(false);
  const { enabled, setEnabled } = useTemplateShortcuts({ sections, setHelpOpen: setOpen });
  const box = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const toggleId = useId();

  const card = useRef<HTMLDivElement>(null);
  const { place, moved, handleProps, gripKeys, reset } = useCardPosition(open, box, card);
  // The card stays open while the reader works, as a reference beside the page. It closes only with its X button,
  // the Shortcuts button or the "?" key; clicking elsewhere, Esc and "/" leave it open.

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={cardId}
        title="Keyboard shortcuts (?)"
        className={`hidden items-center gap-1.5 rounded-lg border px-2 py-1 text-xs! transition [@media(hover:hover)_and_(pointer:fine)]:inline-flex ${
          open ? "border-orange-400/50 text-white" : "border-white/10 text-slate-400 hover:border-white/20 hover:text-white"
        }`}
      >
        <Keyboard size={14} />
        <span>Shortcuts</span>
      </button>

      {open && (
        <div
          id={cardId}
          role="dialog"
          aria-label="Keyboard shortcuts"
          ref={card}
          style={place ?? { left: 0, top: 0, visibility: "hidden" }}
          className="fixed z-40 max-h-[calc(100vh-1rem)] w-[min(22rem,calc(100vw-1rem))] overflow-auto rounded-xl border border-white/10 bg-[#141826] text-left shadow-2xl shadow-black/50"
        >
          {/* The title bar is the drag handle. Double-click it to put the card back. */}
          <div
            {...handleProps}
            className="flex cursor-grab touch-none select-none items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5 active:cursor-grabbing"
            title="Drag to move. Double-click to put it back."
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                {...gripKeys}
                aria-label="Move the shortcuts card. Use the arrow keys; hold Shift to move further."
                className="-ml-1.5 cursor-grab rounded p-0.5 text-slate-500 hover:text-white active:cursor-grabbing"
              >
                <GripVertical size={14} />
              </button>
              <p className="text-sm font-semibold text-white">Keyboard shortcuts</p>
            </div>
            <button type="button" data-no-drag onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:text-white">
              <X size={14} />
            </button>
          </div>

          <div className="p-4 pt-3">

          <ul className="space-y-2">
            {SHORTCUTS.map((shortcut) => {
              const off = shortcut.optional && !enabled;
              return (
                <li key={shortcut.label} className={`flex items-center justify-between gap-4 text-xs ${off ? "opacity-40" : ""}`}>
                  <span className="text-slate-300">{shortcut.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <Key key={key}>{key}</Key>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>

          <ol className={`mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2 text-[11px] ${enabled ? "" : "opacity-40"}`}>
            {SECTION_KINDS.map((kind, index) => {
              const present = sections.includes(kind);
              return (
                <li key={kind} className={`flex items-center gap-2 ${present ? "text-slate-400" : "text-slate-600"}`} title={present ? undefined : "This template has none"}>
                  <span className="w-3 text-right font-mono">{index + 1}</span>
                  <span className={present ? "" : "line-through"}>{SECTION_TITLE[kind]}</span>
                </li>
              );
            })}
          </ol>

          <div className="mt-3 flex items-start justify-between gap-3 border-t border-white/[0.06] pt-3">
            <label htmlFor={toggleId} className="text-xs">
              <span className="block font-semibold text-slate-200">Single-key shortcuts</span>
              <span className="block leading-5 text-slate-500">
                Turn off if they clash with a screen reader or voice control. <Key>/</Key> and <Key>?</Key> always work.
              </span>
            </label>
            <button
              id={toggleId}
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${enabled ? "bg-orange-500" : "bg-white/15"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? "left-[1.125rem]" : "left-0.5"}`} />
            </button>
          </div>

          {moved && (
            <button type="button" onClick={reset} className="mt-3 text-[11px]! text-slate-500 underline-offset-2 hover:text-white hover:underline">
              Put this card back in its usual place
            </button>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
