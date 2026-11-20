import { useEffect, useMemo, useState } from "react";
import { Search, Zap } from "lucide-react";

import { listTemplates, type Summary } from "../../hub/api";

// A searchable strip of registry templates for the Demo. The templates that run live (the Claim-Code Voucher, then
// Drip Mine) are pinned first.

export default function TemplatePicker({
  selected,
  liveIdentifiers,
  onSelect,
}: {
  selected: string;
  liveIdentifiers: string[];
  onSelect: (identifier: string) => void;
}) {
  const [items, setItems] = useState<Summary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;

    listTemplates({ sort: "newest", pageSize: 50 })
      .then((result) => {
        if (current) setItems(result.items);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : "Could not load templates.");
      });

    return () => {
      current = false;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle))
      : items;

    const rank = (identifier: string) => {
      const position = liveIdentifiers.indexOf(identifier);

      return position < 0 ? liveIdentifiers.length : position;
    };

    return [...matching].sort((a, b) => rank(a.identifier) - rank(b.identifier));
  }, [items, query, liveIdentifiers]);

  return (
    <section className="relative z-10 border-b border-white/[0.07] bg-[#05070B]/90 px-4 py-4 backdrop-blur sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">Try a template</p>
            <p className="mt-1 text-xs text-gray-500">Pick anything from the registry. The voucher and Drip Mine run live; the rest open as guided walk-throughs.</p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search templates..."
              aria-label="Search templates"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-8 pr-3 text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400/40"
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {shown.map((item) => {
            const live = liveIdentifiers.includes(item.identifier);

            return (
              <button
                key={item.identifier}
                type="button"
                onClick={() => onSelect(item.identifier)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                  selected === item.identifier
                    ? "border-orange-500/40 bg-orange-500/10 text-orange-200"
                    : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
                }`}
              >
                {live ? <Zap size={12} className="text-amber-400" /> : null}
                <span className="max-w-[12rem] truncate">{item.name}</span>
                {live ? (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">live</span>
                ) : null}
              </button>
            );
          })}
          {shown.length === 0 && !error ? <span className="py-2 text-xs text-gray-600">No templates match.</span> : null}
        </div>
      </div>
    </section>
  );
}
