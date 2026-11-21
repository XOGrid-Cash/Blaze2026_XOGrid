import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Play, Plus, RotateCcw, Search, X } from "lucide-react";

import { CategoryFilter } from "../components/hub/CategoryFilter";
import { TemplateCard } from "../components/hub/TemplateCard";
import { listTemplates, type Badge, type Summary } from "../hub/api";
import { categoryLabel } from "../hub/categories";
import { LIVE_DEMOS, demoLink } from "../config/demos";

// Every filter lives in the address (/explore?q=coin&category=payment&trust=reviewed&sort=rating), so a filtered
// view can be shared and the back button brings it back.

const TRUST_OPTIONS: { value: "" | Badge; label: string }[] = [
  { value: "", label: "Any trust level" },
  { value: "reviewed", label: "Moderator reviewed" },
  { value: "auto-checked", label: "Passed checks" },
  { value: "unchecked", label: "Not checked" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Top rated" },
  { value: "name", label: "A–Z" },
] as const;

type Sort = (typeof SORT_OPTIONS)[number]["value"];

const isBadge = (value: string): value is Badge => TRUST_OPTIONS.some((option) => option.value === value && value !== "");
const isSort = (value: string): value is Sort => SORT_OPTIONS.some((option) => option.value === value);

const select =
  "rounded-xl border border-white/[0.08] bg-[#080a10] px-3 py-3 text-sm text-slate-300 outline-none transition focus:border-orange-400/50";

function Explore() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const trustParam = params.get("trust") ?? "";
  const trust = isBadge(trustParam) ? trustParam : "";
  const sortParam = params.get("sort") ?? "";
  const sort: Sort = isSort(sortParam) ? sortParam : "newest";
  const query = params.get("q") ?? "";
  // The box updates at once; the address (and the request) follow a moment after typing stops.
  const [search, setSearch] = useState(query);

  const [items, setItems] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Set (or with "" remove) one filter in the address, keeping the others. */
  const setFilter = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }

        return next;
      },
      { replace: true },
    );

  // Keep the box in step when the address changes from outside (back button, a link, Clear filters), but not when
  // the change is our own, a moment behind the typing, which would overwrite what was typed since.
  const pushedQuery = useRef(query);

  useEffect(() => {
    if (query !== pushedQuery.current) {
      pushedQuery.current = query;
      setSearch(query);
    }
  }, [query]);

  useEffect(() => {
    if (search.trim() === query) {
      return;
    }

    const timer = setTimeout(() => {
      pushedQuery.current = search.trim();
      setFilter("q", search.trim());
    }, 250);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    let current = true;

    setLoading(true);
    listTemplates({ query: query || undefined, badge: trust || undefined, category: category || undefined, sort, pageSize: 50 })
      .then((page) => {
        if (current) {
          setItems(page.items);
          setTotal(page.total);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Could not load templates.");
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, [query, trust, category, sort]);

  const filtered = query !== "" || trust !== "" || category !== "";
  const clearFilters = () => {
    setSearch("");
    setParams({}, { replace: true });
  };

  const resultLine = [
    `${total} template${total === 1 ? "" : "s"}`,
    category && `in ${categoryLabel(category)}`,
    query && `matching “${query}”`,
    trust && `· ${TRUST_OPTIONS.find((option) => option.value === trust)?.label.toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="relative min-h-screen bg-[#05070b] text-white">
      <style>{`
        @keyframes exploreFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .explore-fade { animation: exploreFade .35s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .explore-fade { animation: none; }
          .explore-grid * { transition: none !important; transform: none !important; }
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-violet-700/10 blur-[120px]" />
        <div className="absolute -right-40 top-40 h-[380px] w-[380px] rounded-full bg-orange-500/[0.07] blur-[130px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1440px] px-4 pb-20 pt-8 sm:px-8 sm:pt-10 lg:px-12 2xl:max-w-[1800px] 2xl:px-14">
        <header className="explore-fade">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl 2xl:text-5xl">Find a template</h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-slate-400">
            Ready-made Bitcoin Cash contracts for your XO wallet, shared by the community. Open one to see what it does,
            who takes part and how others rated it.
          </p>
        </header>

        <section className="explore-fade mt-6" aria-label="Search and filters">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, what it does or publisher"
                aria-label="Search templates"
                className="w-full rounded-2xl border border-white/[0.08] bg-[#080a10] py-3.5 pl-12 pr-11 text-base text-white outline-none transition placeholder:text-slate-600 focus:border-orange-400/50 [&::-webkit-search-cancel-button]:hidden"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-white"
                >
                  <X size={17} />
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <select value={trust} onChange={(event) => setFilter("trust", event.target.value)} aria-label="Trust level" className={`${select} min-w-0 flex-1 lg:w-56`}>
                {TRUST_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={sort}
                onChange={(event) => setFilter("sort", event.target.value === "newest" ? "" : event.target.value)}
                aria-label="Sort by"
                className={`${select} w-32 shrink-0`}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <CategoryFilter active={category} onChoose={(slug) => setFilter("category", slug)} />
        </section>

        {!filtered && (
          <section className="explore-fade mt-8" aria-label="Try it live">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-orange-300">
              <Play size={14} className="fill-current" />
              New here? Watch one run
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {LIVE_DEMOS.map((demo) => {
                const Icon = demo.icon;

                return (
                  <Link
                    key={demo.identifier}
                    to={demoLink(demo.identifier)}
                    className="group flex min-w-0 items-center gap-4 rounded-2xl border border-orange-400/20 bg-gradient-to-r from-orange-500/[0.10] to-transparent p-4 transition hover:border-orange-400/45"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-300">
                      <Icon size={21} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-white">{demo.name}</span>
                      <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-slate-400">{demo.blurb}</span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-orange-300 sm:flex">
                      Try the demo
                      <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3" aria-live="polite">
          <h2 className="text-lg font-semibold text-white">{loading && items.length === 0 ? "Loading templates…" : resultLine}</h2>
          {filtered && (
            <button type="button" onClick={clearFilters} className="flex items-center gap-2 text-sm text-slate-400 transition hover:text-orange-300">
              <RotateCcw size={15} />
              Clear filters
            </button>
          )}
        </div>

        <div className="mt-4">
          {error ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-6 py-10 text-center text-sm text-rose-200">{error}</div>
          ) : loading && items.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6].map((key) => (
                <div key={key} className="h-64 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <div className="h-5 w-1/2 rounded bg-white/[0.07]" />
                  <div className="mt-2 h-3 w-1/4 rounded bg-white/[0.05]" />
                  <div className="mt-5 h-3 w-full rounded bg-white/[0.05]" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-white/[0.05]" />
                </div>
              ))}
            </div>
          ) : items.length > 0 ? (
            <div
              key={`${query}|${trust}|${category}|${sort}`}
              className={`explore-grid explore-fade grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6 ${loading ? "opacity-60" : ""}`}
            >
              {items.map((item) => (
                <TemplateCard key={item.identifier} template={item} onCategory={(slug) => setFilter("category", slug)} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.12] px-6 py-16 text-center">
              <Search size={26} className="mx-auto text-slate-500" />
              <h3 className="mt-4 text-xl font-semibold text-white">No templates match</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">Try fewer or different words, or clear the filters to see everything.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-orange-400/40 hover:text-white"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        <section className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:flex-row sm:items-center sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Have a template worth sharing?</h2>
            <p className="mt-1 text-sm text-slate-400">Publish it to the registry so others can find, check and review it.</p>
          </div>
          <Link
            to="/publish"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-400"
          >
            <Plus size={16} />
            Publish a template
          </Link>
        </section>

        <footer className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/[0.07] pt-6 text-xs text-slate-600 sm:flex-row">
          <p>© {new Date().getFullYear()} XOGrid. The template registry.</p>
          <div className="flex items-center gap-5">
            <Link to="/policy" className="transition hover:text-slate-300">
              Trust &amp; Policy
            </Link>
            <Link to="/" className="transition hover:text-slate-300">
              Back to home
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

export default Explore;
