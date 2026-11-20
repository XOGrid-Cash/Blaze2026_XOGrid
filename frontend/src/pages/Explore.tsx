import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  Layers3,
  ShieldCheck,
  Clock3,
  X,
  FileCode2,
  Sparkles,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

import { CategoryFilter } from "../components/hub/CategoryFilter";
import { listTemplates, type Badge, type Summary } from "../hub/api";
import { categoryLabel } from "../hub/categories";
import { templatePath, useTemplateCardClick } from "../hub/useTemplateCardClick";

const trustStatuses = ["All statuses", "Unchecked", "Auto-checked", "Reviewed"];

const badgeFromLabel: Record<string, Badge> = {
  Unchecked: "unchecked",
  "Auto-checked": "auto-checked",
  Reviewed: "reviewed",
};

const badgeLabel: Record<Badge, string> = {
  unchecked: "Unchecked",
  "auto-checked": "Auto-checked",
  reviewed: "Reviewed",
};

const sortFromLabel: Record<string, "newest" | "name" | "rating"> = {
  recent: "newest",
  name: "name",
  rating: "rating",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const badgeStyles: Record<string, string> = {
  Unchecked: "text-slate-300 bg-slate-400/10 border-slate-400/20",
  "Auto-checked":
    "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  Reviewed: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  Flagged: "text-rose-300 bg-rose-400/10 border-rose-400/20",
  Removed: "text-red-300 bg-red-400/10 border-red-400/20",
};

function Explore() {
  const [search, setSearch] = useState("");
  const [activeStatus, setActiveStatus] = useState("All statuses");
  const [sortBy, setSortBy] = useState("recent");
  // The category lives in the address (/explore?category=payment), so a filtered view can be shared and the back button works.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") ?? "";
  const chooseCategory = (slug: string) => setSearchParams(slug ? { category: slug } : {}, { replace: true });
  const openTemplateFromCard = useTemplateCardClick();
  const [items, setItems] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live data from the XOGrid registry.
  // Search is debounced so typing does not send a request on every keystroke.
  useEffect(() => {
    let current = true;

    const timer = setTimeout(() => {
      setLoading(true);

      listTemplates({
        query: search.trim() || undefined,
        badge: badgeFromLabel[activeStatus],
        category: activeCategory || undefined,
        sort: sortFromLabel[sortBy],
        pageSize: 50,
      })
        .then((page) => {
          if (current) {
            setItems(page.items);
            setTotal(page.total);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (current) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not load templates."
            );
          }
        })
        .finally(() => {
          if (current) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [search, activeStatus, sortBy, activeCategory]);

  const filteredTemplates = items.map((item) => ({
    id: item.identifier,
    name: item.name,
    category: item.publisher,
    badge: badgeLabel[item.badge],
    updated: formatDate(item.createdAt),
    rating: item.averageRating,
    reviews: item.userReviewCount,
    categories: item.categories ?? [],
  }));

  const clearFilters = () => {
    setSearch("");
    setActiveStatus("All statuses");
    setSortBy("recent");
    chooseCategory("");
  };

  const hasActiveFilters =
    search !== "" ||
    activeStatus !== "All statuses" ||
    sortBy !== "recent" ||
    activeCategory !== "";

  return (
    <main className="explore-page relative min-h-screen overflow-hidden bg-[#05070b] text-white">
      <style>{`
        @keyframes exploreFadeUp {
          from {
            opacity: 0;
            transform: translateY(35px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes exploreFloat {
          0%, 100% {
            transform: translate3d(0, 0, 0) rotate(0deg);
          }
          50% {
            transform: translate3d(0, -22px, 0) rotate(5deg);
          }
        }

        @keyframes exploreGlow {
          0%, 100% {
            opacity: .25;
            transform: scale(1);
          }
          50% {
            opacity: .55;
            transform: scale(1.15);
          }
        }

        @keyframes exploreShimmer {
          from { transform: translateX(-130%); }
          to { transform: translateX(250%); }
        }

        @keyframes explorePulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(167,139,250,.25);
          }
          50% {
            box-shadow: 0 0 0 9px rgba(167,139,250,0);
          }
        }

        @keyframes exploreOrbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .explore-enter {
          animation: exploreFadeUp .8s cubic-bezier(.2,.7,.2,1) both;
        }

        .explore-glow {
          animation: exploreGlow 8s ease-in-out infinite;
        }

        .explore-float {
          animation: exploreFloat 8s ease-in-out infinite;
        }

        .explore-orbit {
          animation: exploreOrbit 25s linear infinite;
        }

        .explore-card {
          opacity: 0;
          animation: exploreFadeUp .7s cubic-bezier(.2,.7,.2,1) forwards;
          transition:
            transform .4s cubic-bezier(.2,.7,.2,1),
            border-color .4s ease,
            box-shadow .4s ease,
            background .4s ease;
        }

        .explore-card:hover {
          transform: translateY(-9px);
          border-color: rgba(168,85,247,.42);
          box-shadow:
            0 25px 70px rgba(0,0,0,.35),
            0 0 35px rgba(139,92,246,.10);
        }

        .explore-card-icon {
          transition:
            transform .4s cubic-bezier(.2,.7,.2,1),
            background .4s ease,
            border-color .4s ease;
        }

        .explore-card:hover .explore-card-icon {
          transform: rotate(-8deg) scale(1.1);
          background: rgba(249,115,22,.15);
          border-color: rgba(249,115,22,.3);
        }

        .explore-card:hover .explore-card-arrow {
          transform: translate(4px,-4px);
          color: #fdba74;
        }

        .explore-card-arrow {
          transition: transform .3s ease, color .3s ease;
        }

        .explore-shimmer {
          position: relative;
          isolation: isolate;
          overflow: hidden;
        }

        .explore-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          width: 45%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,.18),
            transparent
          );
          transform: translateX(-130%);
        }

        .explore-shimmer:hover::after {
          animation: exploreShimmer .8s ease;
        }

        .explore-filter {
          transition:
            transform .25s ease,
            border-color .25s ease,
            background .25s ease,
            color .25s ease;
        }

        .explore-filter:hover {
          transform: translateY(-3px);
          border-color: rgba(249,115,22,.4);
        }

        .explore-input {
          transition:
            border-color .3s ease,
            box-shadow .3s ease,
            background .3s ease;
        }

        .explore-input:focus {
          border-color: rgba(167,139,250,.55);
          box-shadow:
            0 0 0 3px rgba(139,92,246,.12),
            0 0 30px rgba(139,92,246,.08);
        }

        .explore-bottom-cta {
          transition: border-color .35s ease, transform .35s ease;
        }

        .explore-bottom-cta:hover {
          border-color: rgba(167,139,250,.35);
        }

        @media (prefers-reduced-motion: reduce) {
          .explore-page *,
          .explore-page *::before,
          .explore-page *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: .01ms !important;
          }

          .explore-card {
            opacity: 1;
          }
        }
      `}</style>

      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="explore-glow absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-violet-700/15 blur-[120px]" />

        <div
          className="explore-glow absolute -right-40 top-40 h-[420px] w-[420px] rounded-full bg-orange-500/10 blur-[130px]"
          style={{ animationDelay: "2s" }}
        />

        <div className="absolute bottom-0 left-1/3 h-[300px] w-[500px] rounded-full bg-purple-600/[0.06] blur-[120px]" />

        <div className="explore-orbit absolute left-[15%] top-[30%] hidden h-[500px] w-[500px] rounded-full border border-violet-400/[0.035] lg:block" />

        <div className="explore-orbit absolute right-[8%] top-[55%] hidden h-[350px] w-[350px] rounded-full border border-orange-400/[0.035] lg:block" />
      </div>

      <div className="relative z-10">

        {/* Main content */}
        <div className="mx-auto max-w-[1440px] px-5 pb-24 pt-12 sm:px-8 sm:pt-16 lg:px-12 2xl:max-w-[1800px] 2xl:px-14 2xl:pb-28 2xl:pt-20">
          {/* Hero */}
          <section className="explore-enter relative mb-12 2xl:mb-16">
            <div className="absolute -right-4 top-0 hidden opacity-20 lg:block">
              <div className="explore-float flex h-40 w-40 items-center justify-center rounded-[36px] border border-violet-400/20 bg-violet-500/[0.04]">
                <FileCode2
                  size={80}
                  strokeWidth={1}
                  className="text-violet-300"
                />
              </div>
            </div>

            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/[0.08] px-3 py-1.5 text-xs font-medium tracking-wide text-violet-300">
              <Sparkles size={13} />
              THE COMMUNITY TEMPLATE REGISTRY
            </div>

            <p className="mb-3 text-sm font-medium uppercase tracking-[.2em] text-orange-400">
              Discover · Explore · Build
            </p>

            <h1 className="max-w-3xl text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-6xl 2xl:max-w-4xl 2xl:text-7xl">
              Explore the
              <span className="block bg-gradient-to-r from-violet-300 via-purple-300 to-orange-300 bg-clip-text text-transparent">
                template ecosystem.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg 2xl:max-w-3xl 2xl:text-xl 2xl:leading-8">
              Discover reusable wallet templates, inspect their identifiers,
              and understand their trust status before integrating them into
              your workflow.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-slate-400">
              <span className="flex items-center gap-2">
                <Layers3 size={16} className="text-violet-300" />
                Community templates
              </span>

              <span className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-300" />
                Transparent trust status
              </span>
            </div>
          </section>

          {/* Search and filters */}
          <section
            className="explore-enter mb-10 rounded-3xl border border-white/[0.08] bg-[#0c0e16]/80 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-7 2xl:mb-12 2xl:p-9"
            style={{ animationDelay: ".12s" }}
          >
            <div className="flex flex-col gap-4 lg:flex-row 2xl:gap-6">
              <div className="relative flex-1">
                <Search
                  size={19}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                />

                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by template name or description..."
                  className="explore-input w-full rounded-2xl border border-white/[0.08] bg-[#080a10] py-4 pl-12 pr-12 text-sm text-white outline-none placeholder:text-slate-600"
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

              <div className="flex items-center gap-2">
                <SlidersHorizontal
                  size={17}
                  className="shrink-0 text-slate-500"
                />

                <select
                  value={activeStatus}
                  onChange={(event) => setActiveStatus(event.target.value)}
                  className="min-w-0 flex-1 rounded-2xl border border-white/[0.08] bg-[#080a10] px-4 py-4 text-sm text-slate-300 outline-none transition focus:border-violet-400/50 sm:min-w-[175px]"
                >
                  {trustStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="rounded-2xl border border-white/[0.08] bg-[#080a10] px-4 py-4 text-sm text-slate-300 outline-none transition focus:border-violet-400/50"
                aria-label="Sort templates"
              >
                <option value="recent">Recently updated</option>
                <option value="rating">Top rated</option>
                <option value="name">Name: A to Z</option>
              </select>
            </div>

            <CategoryFilter active={activeCategory} onChoose={chooseCategory} />
          </section>

          {/* Results heading */}
          <section
            className="explore-enter mb-6 2xl:mb-8"
            style={{ animationDelay: ".2s" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">REGISTRY COLLECTION</p>

                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">
                  Explore templates
                  <span className="ml-3 text-sm font-normal text-slate-500">
                    {total} found
                  </span>
                </h2>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-2 text-sm text-slate-400 transition hover:text-orange-300"
                >
                  <RotateCcw size={15} />
                  Clear filters
                </button>
              )}
            </div>
          </section>

          {/* Template cards */}
          {error ? (
            <div className="explore-enter rounded-3xl border border-rose-400/20 bg-rose-500/10 px-6 py-10 text-center text-sm text-rose-200">
              {error}
            </div>
          ) : loading && filteredTemplates.length === 0 ? (
            <p className="py-16 text-center text-slate-400">
              Loading templates...
            </p>
          ) : filteredTemplates.length > 0 ? (
            <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:gap-7">
              {filteredTemplates.map((template, index) => (
                <article
                  key={template.id}
                  className="explore-card group relative cursor-pointer overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 2xl:p-8"
                  style={{ animationDelay: `${index * 120}ms` }}
                  onClick={(event) => openTemplateFromCard(event, template.id)}
                  onAuxClick={(event) => openTemplateFromCard(event, template.id)}
                >
                  <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-500/[0.07] blur-3xl transition duration-500 group-hover:bg-violet-500/[0.15]" />

                  <div className="relative">
                    <div className="mb-7 flex items-start justify-between">
                      <div className="explore-card-icon flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-400/15 bg-orange-500/[0.08] text-orange-300">
                        <FileCode2 size={22} />
                      </div>

                      <span
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                          badgeStyles[template.badge] || badgeStyles.Unchecked
                        }`}
                      >
                        {template.badge}
                      </span>
                    </div>

                    <p className="mb-2 text-xs font-medium uppercase tracking-[.15em] text-violet-300">
                      {template.category}
                    </p>

                    <h3 className="text-xl font-semibold text-white transition group-hover:text-violet-200 2xl:text-2xl">
                      <Link
                        to={templatePath(template.id)}
                        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
                      >
                        {template.name}
                      </Link>
                    </h3>

                    <p className="mt-2 text-xs text-slate-500">
                      {template.rating !== null
                        ? `${template.rating.toFixed(1)} / 5 from ${
                            template.reviews
                          } review${template.reviews === 1 ? "" : "s"}`
                        : "No reviews yet"}
                    </p>

                    {template.categories.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {template.categories.map((slug) => (
                          <button
                            key={slug}
                            type="button"
                            onClick={() => chooseCategory(slug)}
                            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-orange-400/40 hover:text-white"
                          >
                            {categoryLabel(slug)}
                          </button>
                        ))}
                      </div>
                    )}

                    <div
                      data-card-ignore
                      className="mt-7 cursor-text rounded-2xl border border-white/[0.06] bg-black/20 p-4 2xl:mt-8 2xl:p-5"
                    >
                      <p className="mb-1 select-none text-[10px] font-semibold uppercase tracking-[.15em] text-slate-500">
                        Template identifier
                      </p>

                      <p
                        className="select-all break-all font-mono text-sm text-slate-300"
                        title="Click to select, then copy"
                      >
                        {template.id}
                      </p>
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-5 2xl:mt-6 2xl:pt-6">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Clock3 size={14} />
                        Added {template.updated}
                      </div>

                      <ArrowUpRight
                        size={18}
                        aria-hidden="true"
                        className="explore-card-arrow text-orange-400"
                      />
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <div className="explore-enter rounded-3xl border border-dashed border-white/[0.12] bg-[#0c0e16]/60 px-6 py-20 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
                <Search size={27} />
              </div>

              <h3 className="mt-6 text-xl font-semibold text-white">
                No templates found
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                We couldn't find a template matching your search or filters.
                Try a different keyword or clear your filters.
              </p>

              <button
                type="button"
                onClick={clearFilters}
                className="mt-7 rounded-xl bg-violet-500/15 px-5 py-3 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/25"
              >
                Clear all filters
              </button>
            </div>
          )}

          {/* Bottom CTA */}
          <section className="explore-bottom-cta explore-enter relative mt-16 overflow-hidden rounded-3xl border border-violet-400/15 bg-gradient-to-br from-violet-500/[0.12] via-[#111322] to-orange-500/[0.07] p-7 sm:p-10 2xl:mt-20 2xl:p-12">
            <div className="explore-glow pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-500/10 blur-[80px]" />

            <div className="relative flex flex-col items-start justify-between gap-7 md:flex-row md:items-center">
              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-orange-300">
                  <Sparkles size={16} />
                  CONTRIBUTE TO THE ECOSYSTEM
                </div>

                <h2 className="max-w-xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  Have a template worth sharing?
                </h2>

                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  Publish your template, generate its unique identifier, and
                  make it discoverable by the community.
                </p>
              </div>

              <Link
                to="/publish"
                className="explore-shimmer inline-flex shrink-0 items-center gap-2 rounded-xl bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-orange-500/15 transition hover:-translate-y-1 hover:bg-orange-400"
              >
                Publish a template
                <ArrowRight size={17} />
              </Link>
            </div>
          </section>

          {/* Footer */}
          <footer className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/[0.07] pt-7 text-xs text-slate-600 sm:flex-row">
            <p>
              © {new Date().getFullYear()} XOGrid. The template registry.
            </p>

            <div className="flex items-center gap-5">
              <Link
                to="/policy"
                className="transition hover:text-slate-300"
              >
                Trust &amp; Policy
              </Link>

              <Link
                to="/"
                className="transition hover:text-slate-300"
              >
                Back to home
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}

export default Explore;