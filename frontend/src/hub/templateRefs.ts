import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { measure, tokenize, type Size } from "./cashAssembly";
import type { TemplateView } from "./templateView";

// Links between the parts of a template. A link shows a short preview on hover (or on the first tap on a touch
// screen) and, when followed, opens the section that holds the definition, scrolls to it and highlights it. Each jump
// is a history entry, so the browser's Back button returns to where the reader was.

export type RefKind = "action" | "transaction" | "lockingScript" | "script" | "constant" | "variable";

export interface RefTarget {
  kind: RefKind;
  id: string;
  name: string;
  description: string;
  /** A short extra line: a type, a value or a size. */
  meta: string | null;
}

export const KIND_LABEL: Record<RefKind, string> = {
  action: "Action",
  transaction: "Transaction",
  lockingScript: "Locking script",
  script: "Script",
  constant: "Constant",
  variable: "Variable",
};

const KIND_SLUG: Record<RefKind, string> = {
  action: "action",
  transaction: "transaction",
  lockingScript: "locking-script",
  script: "script",
  constant: "constant",
  variable: "variable",
};

export function anchorId(kind: RefKind, id: string): string {
  return `${KIND_SLUG[kind]}-${id}`;
}

export function sizeLabel({ bytes, unknown }: Size): { label: string; title: string } {
  const unit = bytes === 1 ? "byte" : "bytes";
  const names = [...new Set(unknown)];

  if (names.length === 0) {
    return { label: `${bytes.toLocaleString()} ${unit}`, title: "Compiled size of this script" };
  }

  return {
    label: `${bytes.toLocaleString()} ${unit} + ${names.length} ${names.length === 1 ? "value" : "values"}`,
    title: `${bytes.toLocaleString()} ${unit} of fixed code, plus the size of: ${names.join(", ")} (filled in when the transaction is built)`,
  };
}

export interface RefIndex {
  get(kind: RefKind, id: string): RefTarget | undefined;
  /** What a name inside CashAssembly points to: a script first, then a constant, then a variable. */
  resolveCode(word: string): RefTarget | undefined;
  scriptSize(id: string): Size | undefined;
}

export function buildRefIndex(view: TemplateView): RefIndex {
  const targets = new Map<string, RefTarget>();
  const sizes = new Map<string, Size>();
  const key = (kind: RefKind, id: string) => `${kind}:${id}`;
  const add = (target: RefTarget) => targets.set(key(target.kind, target.id), target);
  const sources = Object.fromEntries(view.scripts.map((script) => [script.id, script.text]));

  view.actions.forEach((item) => add({ kind: "action", id: item.id, name: item.name, description: item.description, meta: null }));
  view.transactions.forEach((item) =>
    add({ kind: "transaction", id: item.id, name: item.name, description: item.description, meta: `Spends ${item.inputs.length}, creates ${item.outputs.length}` }),
  );
  view.lockingScripts.forEach((item) =>
    add({ kind: "lockingScript", id: item.id, name: item.name, description: item.description, meta: item.facts.map((fact) => fact.code).join(" · ") || null }),
  );
  view.constants.forEach((item) =>
    add({ kind: "constant", id: item.id, name: item.name, description: item.description, meta: [item.type, item.value].filter(Boolean).join(" = ") || null }),
  );
  view.variables.forEach((item) =>
    add({ kind: "variable", id: item.id, name: item.name, description: item.description, meta: item.type ? `${item.type}, filled in when used` : "Filled in when used" }),
  );
  view.scripts.forEach((script) => {
    const size = measure(tokenize(script.text), sources, new Set([script.id]));
    sizes.set(script.id, size);
    add({ kind: "script", id: script.id, name: script.id, description: "", meta: sizeLabel(size).label });
  });

  const get = (kind: RefKind, id: string) => targets.get(key(kind, id));

  return {
    get,
    resolveCode: (word) => {
      const base = word.split(".")[0];
      return get("script", word) ?? get("constant", base) ?? get("variable", base);
    },
    scriptSize: (id) => sizes.get(id),
  };
}

export const RefContext = createContext<RefIndex | null>(null);

export function useRefs(): RefIndex | null {
  return useContext(RefContext);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const touchOnly = () => window.matchMedia("(hover: none)").matches;

/** Opens every closed section around the element, scrolls it into view and pulses a highlight ring around it. */
export function revealAnchor(anchor: string, smooth = true): boolean {
  const element = document.getElementById(anchor);

  if (!element) {
    return false;
  }

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) {
      parent.open = true;
    }
  }

  const tall = element.getBoundingClientRect().height > window.innerHeight * 0.6;
  element.scrollIntoView({ block: tall ? "start" : "center", behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  element.animate(
    [
      { boxShadow: "0 0 0 6px rgba(251,146,60,.18), 0 0 0 7px rgba(251,146,60,.85)", backgroundColor: "rgba(251,146,60,.08)" },
      { boxShadow: "0 0 0 6px rgba(251,146,60,.18), 0 0 0 7px rgba(251,146,60,.85)", backgroundColor: "rgba(251,146,60,.08)", offset: 0.6 },
      { boxShadow: "0 0 0 6px rgba(251,146,60,0), 0 0 0 7px rgba(251,146,60,0)", backgroundColor: "rgba(251,146,60,0)" },
    ],
    { duration: 2200, easing: "ease-out" },
  );

  return true;
}

/**
 * Follows the address's #anchor when the page opens and when the reader goes Back or Forward, and offers a
 * "Back to …" button for a while after an in-page jump.
 */
function followHash(smooth: boolean) {
  const anchor = decodeURIComponent(window.location.hash.slice(1));
  if (anchor) revealAnchor(anchor, smooth);
}

/** `content` changes when the template's parts change, so a link opened before they rendered is followed once they have. */
export function useRefNavigation(content: unknown): { backLabel: string | null; dismissBack: () => void } {
  const [backLabel, setBackLabel] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Let the page finish laying out first. A timeout rather than an animation frame, which a background tab never runs.
    const timeout = window.setTimeout(() => followHash(false), 50);
    return () => window.clearTimeout(timeout);
  }, [content]);

  useEffect(() => {
    const onJump = (event: Event) => {
      setBackLabel((event as CustomEvent<string>).detail);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setBackLabel(null), 10_000);
    };
    const onPop = () => {
      setBackLabel(null);
      followHash(true);
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener(JUMP_EVENT, onJump);

    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(JUMP_EVENT, onJump);
    };
  }, []);

  return { backLabel, dismissBack: useCallback(() => setBackLabel(null), []) };
}

const JUMP_EVENT = "xogrid:ref-jump";

export function jumpTo(anchor: string, from: Element | null) {
  if (window.location.hash !== `#${anchor}`) {
    window.history.pushState(window.history.state, "", `#${anchor}`);
  }

  revealAnchor(anchor);
  const label = from?.closest<HTMLElement>("[data-ref-label]")?.dataset.refLabel ?? "where you were";
  window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: label }));
}

