import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, Zap } from "lucide-react";

import { listTemplates, type Summary } from "../../hub/api";

// The Demo's template chooser. The templates that run live are big cards at the top; every other template in the
// registry is a smaller button underneath that opens a guided walk-through.

export interface LiveTemplate {
  identifier: string;
  name: string;
  blurb: string;
  icon: ReactNode;
}

export default function TemplatePicker({
  selected,
  live,
  onSelect,
}: {
  selected: string;
  live: LiveTemplate[];
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

  const others = useMemo(() => {
    const liveIds = live.map((item) => item.identifier);
    const needle = query.trim().toLowerCase();

    return items
      .filter((item) => !liveIds.includes(item.identifier))
      .filter((item) => !needle || `${item.name} ${item.description}`.toLowerCase().includes(needle));
  }, [items, query, live]);

  return (
    <section aria-label="Choose a template" className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-white">Try it live</h2>
        <p className="mt-1 text-xs text-gray-500">These two run for real on the Bitcoin Cash network, right here in your browser.</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {live.map((item) => {
            const active = selected === item.identifier;

            return (
              <button
                key={item.identifier}
                type="button"
                onClick={() => onSelect(item.identifier)}
                aria-pressed={active}
                className={`group relative flex items-start gap-4 rounded-2xl border p-5 text-left transition ${
                  active
                    ? "border-orange-500/60 bg-orange-500/[0.08] shadow-lg shadow-orange-500/10"
                    : "border-white/10 bg-white/[0.025] hover:border-orange-500/30 hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-300">
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-base font-semibold text-white">{item.name}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                      <Zap size={10} /> Live
                    </span>
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-gray-400">{item.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">More templates</h2>
            <p className="mt-1 text-xs text-gray-500">These open as a guide: what the template does, who does what, and its safety checks.</p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400/40"
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {others.map((item) => (
            <button
              key={item.identifier}
              type="button"
              onClick={() => onSelect(item.identifier)}
              aria-pressed={selected === item.identifier}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                selected === item.identifier
                  ? "border-orange-500/50 bg-orange-500/10 text-orange-200"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-white"
              }`}
            >
              <span className="block max-w-[14rem] truncate">{item.name}</span>
            </button>
          ))}
          {others.length === 0 && !error ? (
            <span className="py-2 text-sm text-gray-600">{items.length === 0 ? "Loading templates..." : "No templates match your search."}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
