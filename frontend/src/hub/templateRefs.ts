import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { measure, tokenize, type Size, type Token } from "./cashAssembly";
import type { PartFact, TemplateView } from "./templateView";

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

/** Plural labels, for groups such as "Used in: Locking scripts …". */
export const KIND_PLURAL: Record<RefKind, string> = {
  action: "Actions",
  transaction: "Transactions",
  lockingScript: "Locking scripts",
  script: "Scripts",
  constant: "Constants",
  variable: "Variables",
};

/**
 * One text colour per kind, used for every link to that kind, its icon and the names inside script code, so the kind
 * of a link can be told at a glance. Script, constant and variable match the colours the script view always used.
 * Actions are green rather than orange because orange already marks highlights and search matches on this page.
 */
export const KIND_COLOR: Record<RefKind, string> = {
  action: "text-emerald-300",
  transaction: "text-sky-300",
  lockingScript: "text-amber-300",
  script: "text-violet-300",
  constant: "text-cyan-300",
  variable: "text-fuchsia-300",
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

/** Kinds in the order the sections appear, which is also the order search results are grouped in. */
export const KIND_ORDER: RefKind[] = ["action", "transaction", "lockingScript", "script", "constant", "variable"];

/** Kinds whose "Not used" note is worth showing: an unused script or value is often a mistake. Actions are entry points. */
const REPORT_UNUSED = new Set<RefKind>(["script", "constant", "variable"]);

export interface RefIndex {
  get(kind: RefKind, id: string): RefTarget | undefined;
  /** What a name inside CashAssembly points to: a script first, then a constant, then a variable. */
  resolveCode(word: string): RefTarget | undefined;
  scriptSize(id: string): Size | undefined;
  /** Every part of the template, in section order. */
  all(): RefTarget[];
  /** The parts that refer to this one, in section order. */
  usages(kind: RefKind, id: string): RefTarget[];
  /** Whether a "Not used" note should be shown for this part. */
  reportUnused(kind: RefKind): boolean;
}

/** Every name a piece of CashAssembly mentions, including inside pushes and $(…) calculations. */
function namesIn(tokens: Token[], into: string[] = []): string[] {
  for (const token of tokens) {
    if (token.kind === "ref") into.push(token.text);
    if (token.kind === "push" || token.kind === "eval") namesIn(token.children, into);
  }
  return into;
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
    add({
      kind: "lockingScript",
      id: item.id,
      name: item.name,
      description: item.description,
      meta: item.facts.slice(0, 2).map((fact) => fact.code).join(" · ") || null,
    }),
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
  const resolveCode = (word: string) => {
    const base = word.split(".")[0];
    return get("script", word) ?? get("constant", base) ?? get("variable", base);
  };

  // Where each part is used: target key -> the keys of the parts that mention it.
  const usedBy = new Map<string, Set<string>>();
  const use = (target: RefTarget | undefined, from: RefKind, fromId: string) => {
    if (!target || (target.kind === from && target.id === fromId)) return;
    const targetKey = key(target.kind, target.id);
    if (!usedBy.has(targetKey)) usedBy.set(targetKey, new Set());
    usedBy.get(targetKey)?.add(key(from, fromId));
  };
  const useFacts = (facts: PartFact[], from: RefKind, fromId: string) => {
    for (const fact of facts) {
      if (fact.plain) continue;
      const ids = fact.code.split(/\s+/).filter(Boolean);

      if (fact.refers === "expression") namesIn(tokenize(fact.code)).forEach((name) => use(resolveCode(name), from, fromId));
      if (fact.refers === "script" || fact.refers === "lockingScript") use(get(fact.refers, fact.code), from, fromId);
      if (fact.refers === "actions") ids.forEach((id) => use(get("action", id), from, fromId));
      if (fact.refers === "variables") ids.forEach((id) => use(get("variable", id) ?? get("constant", id), from, fromId));
    }
  };
  const inputs = new Map(view.inputs.map((item) => [item.id, item]));
  const outputs = new Map(view.outputs.map((item) => [item.id, item]));

  view.actions.forEach((action) => {
    if (action.transaction) use(get("transaction", action.transaction), "action", action.id);
    action.roles.forEach((role) => role.variables.forEach((id) => use(get("variable", id) ?? get("constant", id), "action", action.id)));
  });
  view.transactions.forEach((transaction) => {
    transaction.inputs.forEach((id) => useFacts(inputs.get(id)?.facts ?? [], "transaction", transaction.id));
    transaction.outputs.forEach((id) => useFacts(outputs.get(id)?.facts ?? [], "transaction", transaction.id));
  });
  view.lockingScripts.forEach((item) => useFacts(item.facts, "lockingScript", item.id));
  view.scripts.forEach((script) => namesIn(tokenize(script.text)).forEach((name) => use(resolveCode(name), "script", script.id)));

  const rank = (target: RefTarget) => KIND_ORDER.indexOf(target.kind);
  const all = [...targets.values()].sort((a, b) => rank(a) - rank(b));

  return {
    get,
    resolveCode,
    scriptSize: (id) => sizes.get(id),
    all: () => all,
    usages: (kind, id) =>
      [...(usedBy.get(key(kind, id)) ?? [])]
        .map((usage) => targets.get(usage))
        .filter((target): target is RefTarget => target !== undefined)
        .sort((a, b) => rank(a) - rank(b)),
    reportUnused: (kind) => REPORT_UNUSED.has(kind),
  };
}

export interface SearchResult {
  target: RefTarget;
  /** Where the query was found, for bolding it. */
  field: "id" | "name" | "description";
  score: number;
}

/** Ranks the parts of a template against a query: exact id, then id or name prefix, then id or name, then description. */
export function searchRefs(index: RefIndex, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return [];
  }

  const results: SearchResult[] = [];

  for (const target of index.all()) {
    const id = target.id.toLowerCase();
    const name = target.name.toLowerCase();
    let result: SearchResult | null = null;

    if (id === needle || name === needle) result = { target, field: id === needle ? "id" : "name", score: 0 };
    else if (id.startsWith(needle)) result = { target, field: "id", score: 1 };
    else if (name.startsWith(needle)) result = { target, field: "name", score: 1 };
    else if (id.includes(needle)) result = { target, field: "id", score: 2 };
    else if (name.includes(needle)) result = { target, field: "name", score: 2 };
    else if (target.description.toLowerCase().includes(needle)) result = { target, field: "description", score: 3 };

    if (result) results.push(result);
  }

  return results.sort((a, b) => a.score - b.score);
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

  // The element itself when it is a section, and every section around it.
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
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

/** Whether the current history entry was made by an in-page jump, so going back stays on this page. */
export function cameFromJump(): boolean {
  return Boolean((window.history.state as { xogridJump?: boolean } | null)?.xogridJump);
}

export function jumpTo(anchor: string, from: Element | null) {
  if (window.location.hash !== `#${anchor}`) {
    window.history.pushState({ ...(window.history.state ?? {}), xogridJump: true }, "", `#${anchor}`);
  }

  revealAnchor(anchor);
  const label = from?.closest<HTMLElement>("[data-ref-label]")?.dataset.refLabel ?? "where you were";
  window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: label }));
}

