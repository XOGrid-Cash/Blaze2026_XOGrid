import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Search, X } from "lucide-react";

import { anchorId, jumpTo, KIND_LABEL, KIND_ORDER, searchRefs, useRefs, type RefTarget, type SearchResult } from "../../hub/templateRefs";
import { FOCUS_SEARCH_EVENT } from "../../hub/templateShortcuts";

const PER_GROUP = 8;

/** The text with the first case-insensitive match of the query in bold. */
function Marked({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());

  if (at === -1 || !query.trim()) {
    return <>{text}</>;
  }

  const end = at + query.trim().length;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-orange-400/25 px-0.5 font-semibold text-orange-100">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/** A short piece of the description around the match. */
function snippet(description: string, query: string): string {
  const at = description.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = Math.max(0, at - 30);
  return `${start > 0 ? "…" : ""}${description.slice(start, start + 110)}${start + 110 < description.length ? "…" : ""}`;
}


/**
 * Finds a part of the template by id, name or description. Results are grouped by kind; choosing one jumps to it.
 * Each result can be expanded to list the parts that use it. The "/" shortcut focuses it.
 */
export function TemplateSearch() {
  const refs = useRefs();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const groups = useMemo(() => {
    const results = refs ? searchRefs(refs, query) : [];
    // Groups follow section order, except that a group with a closer match comes first (an exact id before a partial one).
    return KIND_ORDER.map((kind) => {
      const matches = results.filter((result) => result.target.kind === kind);
      return { kind, total: matches.length, best: matches[0]?.score ?? Infinity, shown: matches.slice(0, PER_GROUP) };
    })
      .filter((group) => group.total > 0)
      .sort((a, b) => a.best - b.best);
  }, [refs, query]);
  const flat = useMemo(() => groups.flatMap((group) => group.shown), [groups]);
  const optionId = (index: number) => `${listId}-option-${index}`;

  // The "/" shortcut (in hub/templateShortcuts.ts) asks for the search to be focused.
  useEffect(() => {
    const onFocus = () => {
      input.current?.focus();
      setOpen(true);
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocus);
  }, []);

  // Close the results when the reader clicks elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!refs) {
    return null;
  }

  const go = (target: RefTarget) => {
    setOpen(false);
    jumpTo(anchorId(target.kind, target.id), box.current);
    // The search bar stays in view while the contents scroll, so the reader can carry on typing.
    input.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (flat.length > 0) {
        setActive((index) => (event.key === "ArrowDown" ? (index + 1) % flat.length : (index - 1 + flat.length) % flat.length));
      }
    } else if (event.key === "Enter" && open && flat[active]) {
      event.preventDefault();
      go(flat[active].target);
    } else if (event.key === "Escape") {
      if (query) setQuery("");
      else input.current?.blur();
      setOpen(false);
    }
  };

  const showList = open && query.trim().length > 0;

  const row = (result: SearchResult) => {
    const index = flat.indexOf(result);
    const { target } = result;
    const key = `${target.kind}:${target.id}`;
    const usages = refs.usages(target.kind, target.id);
    const isExpanded = expanded === key;

    return (
      <li key={key} role="presentation">
        <div className={`flex items-stretch rounded-lg ${index === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}>
          <div
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            onPointerMove={() => setActive(index)}
            onClick={() => go(target)}
            className="min-w-0 flex-1 cursor-pointer px-3 py-2"
          >
            <p className="truncate text-sm text-white">
              <Marked text={target.name} query={result.field === "name" ? query : ""} />
              {target.name !== target.id && (
                <span className="ml-2 font-mono text-xs text-slate-500">
                  <Marked text={target.id} query={result.field === "id" ? query : ""} />
                </span>
              )}
              {target.name === target.id && result.field === "id" && <span className="sr-only">{target.id}</span>}
            </p>
            {result.field === "description" ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                <Marked text={snippet(target.description, query)} query={query} />
              </p>
            ) : (
              target.meta && <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{target.meta}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded(isExpanded ? null : key)}
            disabled={usages.length === 0}
            aria-expanded={isExpanded}
            className="flex shrink-0 items-center gap-1 px-3 text-[11px]! text-slate-400 enabled:hover:text-white disabled:cursor-default disabled:text-slate-600"
            title={usages.length === 0 ? "Nothing in this template refers to it" : "Show where it is used"}
          >
            {usages.length === 0 ? (refs.reportUnused(target.kind) ? "not used" : "") : `used in ${usages.length}`}
            {usages.length > 0 && <ChevronRight size={12} className={`transition ${isExpanded ? "rotate-90" : ""}`} />}
          </button>
        </div>
        {isExpanded && (
          <ul className="mb-1 ml-4 border-l border-white/10 pl-2">
            {usages.map((usage) => (
              <li key={`${usage.kind}:${usage.id}`}>
                <button
                  type="button"
                  onClick={() => go(usage)}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs! text-slate-300 hover:bg-white/[0.05] hover:text-white"
                >
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABEL[usage.kind]}</span>
                  <span className="truncate">{usage.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div ref={box} data-ref-label="search" className="sticky top-3 z-30 mt-5">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-500" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && flat[active] ? optionId(active) : undefined}
          aria-label="Search this template"
          placeholder="Search actions, scripts, variables…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setExpanded(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-xl border border-white/10 bg-[#0b0e17]/95 py-2.5 pl-9 pr-16 text-sm text-white shadow-lg shadow-black/30 backdrop-blur placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-white"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 px-1.5 font-mono text-[11px] text-slate-500 sm:block">/</kbd>
        )}
      </div>

      {showList && (
        <div className="absolute inset-x-0 top-full mt-2 max-h-[min(28rem,70vh)] overflow-auto rounded-xl border border-white/10 bg-[#121624] p-2 shadow-2xl shadow-black/50">
          <ul id={listId} role="listbox" aria-label="Search results">
            {groups.map((group) => (
              <Fragment key={group.kind}>
                <li role="presentation" className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {KIND_LABEL[group.kind]}s ({group.total}){group.total > group.shown.length && ` · showing ${group.shown.length}`}
                </li>
                {group.shown.map(row)}
              </Fragment>
            ))}
          </ul>
          {flat.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">No matches for “{query.trim()}”.</p>}
          {flat.length > 0 && (
            <p className="hidden border-t border-white/[0.06] px-3 pt-2 text-[11px] text-slate-500 sm:block">↑ ↓ to move · Enter to go · Esc to clear</p>
          )}
        </div>
      )}
    </div>
  );
}
