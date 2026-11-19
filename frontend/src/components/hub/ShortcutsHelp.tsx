import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";

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

/**
 * The keyboard shortcuts for a template's contents: listens for them, and offers a small card that lists them.
 * The button only shows on devices with a mouse or trackpad; the keys work wherever a keyboard is attached.
 */
export function ShortcutsHelp({ sections }: { sections: RefKind[] }) {
  const [open, setOpen] = useState(false);
  const { enabled, setEnabled } = useTemplateShortcuts({ sections, helpOpen: open, setHelpOpen: setOpen });
  const box = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const toggleId = useId();

  // Placed in the viewport: under the button when it is on screen, otherwise in the top-right corner, so "?" shows the
  // card wherever the reader has scrolled to.
  const [place, setPlace] = useState<{ top: number; right: number }>({ top: 16, right: 16 });
  useLayoutEffect(() => {
    if (!open) return;
    const rect = box.current?.getBoundingClientRect();
    const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight - 200;
    setPlace(visible ? { top: rect.bottom + 8, right: Math.max(16, window.innerWidth - rect.right) } : { top: 16, right: 16 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={cardId}
        title="Keyboard shortcuts (?)"
        className={`hidden items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition [@media(hover:hover)_and_(pointer:fine)]:inline-flex ${
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
          style={place}
          className="fixed z-40 max-h-[calc(100vh-2rem)] w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-white/10 bg-[#141826] p-4 text-left shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Keyboard shortcuts</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:text-white">
              <X size={14} />
            </button>
          </div>

          <ul className="mt-3 space-y-2">
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
        </div>
      )}
    </div>
  );
}
