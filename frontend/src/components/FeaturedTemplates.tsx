
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  ArrowUpRight,
  ShieldCheck,
  Sparkles,
  Search,
  RefreshCw,
  AlertCircle,
  Layers3,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Summary } from "../hub/api";
import { TemplateCard } from "./hub/TemplateCard";

const API_URL = import.meta.env.VITE_API_URL || "";

/** A featured template: a registry summary plus the editor's note. */
type Template = Summary & { blurb?: string };

interface SpotlightResponse {
  items?: Template[];
}

function FeaturedTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSpotlight = async (): Promise<void> => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/api/spotlight`);

      if (!response.ok) {
        throw new Error("Unable to load featured templates.");
      }

      const data: SpotlightResponse = await response.json();

      setTemplates(Array.isArray(data.items) ? data.items : []);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while loading templates."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSpotlight();
  }, []);

  const filteredTemplates = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    if (!query) return templates;

    return templates.filter((template) => {
      const name = template.name || "";
      const description = template.description || "";
      const identifier = template.identifier || "";
      const publisher = template.publisherName ?? template.publisher ?? "";

      return (
        publisher.toLowerCase().includes(query) ||
        name.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query) ||
        identifier.toLowerCase().includes(query)
      );
    });
  }, [templates, searchQuery]);

  const handleSearchChange = (
    event: ChangeEvent<HTMLInputElement>
  ): void => {
    setSearchQuery(event.target.value);
  };

  return (
    <section
      id="featured-templates"
      className="relative overflow-hidden px-5 py-24 sm:px-8 lg:px-12 2xl:px-16 3xl:px-20 4xl:px-24 2xl:py-28 3xl:py-32"
    >
      {/* Ambient lighting */}
      <div className="pointer-events-none absolute -left-40 top-20 h-80 w-80 rounded-full bg-violet-600/[0.07] blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 bottom-10 h-80 w-80 rounded-full bg-orange-500/[0.06] blur-[120px]" />

      <div className="relative mx-auto max-w-[1400px] 2xl:max-w-[1600px] 3xl:max-w-[1850px] 4xl:max-w-[2100px]">
        {/* Heading */}
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end 2xl:mb-14 2xl:gap-10 3xl:mb-16">
          <div className="max-w-2xl 2xl:max-w-3xl 3xl:max-w-4xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/[0.06] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-400 2xl:mb-5 2xl:px-4 2xl:py-2.5 2xl:text-xs">
              <Sparkles size={13} />
              The XO ecosystem
            </div>

            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl 2xl:text-6xl 3xl:text-7xl">
              Explore the{" "}
              <span className="bg-gradient-to-r from-orange-300 via-orange-400 to-amber-500 bg-clip-text text-transparent">
                template hub.
              </span>
            </h2>

            <p className="mt-4 max-w-xl text-sm leading-7 text-white/45 sm:text-base 2xl:mt-5 2xl:max-w-2xl 2xl:text-lg 2xl:leading-8 3xl:text-xl">
              Discover reusable XO wallet templates. Inspect their
              structure, automated checks and community feedback
              before deciding whether to use them.
            </p>
          </div>

          <Link
            to="/explore"
            className="group inline-flex w-fit items-center gap-3 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/15 transition-all duration-300 hover:-translate-y-1 hover:bg-orange-400 hover:shadow-orange-500/25 2xl:gap-4 2xl:rounded-2xl 2xl:px-7 2xl:py-4 2xl:text-base"
          >
            Browse all templates

            <ArrowUpRight
              size={17}
              className="transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1"
            />
          </Link>
        </div>

        {/* Search */}
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between 2xl:mb-9 2xl:gap-8">
          <div className="relative w-full max-w-md 2xl:max-w-xl 3xl:max-w-2xl">
            <Search
              size={17}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30"
            />

            <input
              type="search"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search featured templates..."
              aria-label="Search featured templates"
              className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.025] pl-11 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25 focus:border-orange-500/40 focus:ring-2 focus:ring-orange-500/10 2xl:h-14 2xl:rounded-2xl 2xl:pl-12 2xl:text-base"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-white/35 2xl:gap-3 2xl:text-sm">
            <Layers3 size={15} />
            Admin-selected spotlight
          </div>
        </div>

        {/* Count */}
        <div className="mb-4 flex items-center justify-between 2xl:mb-6">
          <p className="text-xs font-medium text-white/40 2xl:text-sm">
            Showing{" "}
            <span className="text-white">
              {loading ? "—" : filteredTemplates.length}
            </span>{" "}
            featured templates
          </p>

          <span className="text-[10px] uppercase tracking-[0.15em] text-white/25 2xl:text-xs">
            XO registry
          </span>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6 3xl:gap-8">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="animate-pulse rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 2xl:rounded-3xl 2xl:p-7 3xl:p-9"
              >
                <div className="h-11 w-11 rounded-xl bg-white/[0.07] 2xl:h-14 2xl:w-14 2xl:rounded-2xl" />
                <div className="mt-6 h-5 w-2/3 rounded bg-white/[0.07] 2xl:mt-8 2xl:h-6" />
                <div className="mt-3 h-3 w-full rounded bg-white/[0.05] 2xl:mt-4 2xl:h-4" />
                <div className="mt-2 h-3 w-4/5 rounded bg-white/[0.05] 2xl:h-4" />
                <div className="mt-7 h-16 rounded-xl bg-white/[0.04] 2xl:mt-9 2xl:h-20" />
                <div className="mt-5 h-8 rounded bg-white/[0.04] 2xl:mt-7 2xl:h-10" />
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] px-6 py-12 text-center 2xl:rounded-3xl 2xl:px-10 2xl:py-16">
            <AlertCircle
              size={26}
              className="mx-auto mb-4 text-red-400"
            />

            <h3 className="text-base font-semibold text-white 2xl:text-xl">
              Couldn't load featured templates
            </h3>

            <p className="mt-2 text-sm text-white/40 2xl:text-base">
              {error}
            </p>

            <button
              type="button"
              onClick={() => void fetchSpotlight()}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-orange-400 2xl:mt-7 2xl:rounded-xl 2xl:px-6 2xl:py-3.5 2xl:text-sm"
            >
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        )}

        {/* Template cards */}
        {!loading && !error && filteredTemplates.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6 3xl:gap-8">
            {filteredTemplates.map((template) => (
              <TemplateCard key={template.identifier} template={template} blurb={template.blurb || undefined} />
            ))}
          </div>
        )}

        {/* Empty spotlight state */}
        {!loading && !error && templates.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center 2xl:rounded-3xl 2xl:px-10 2xl:py-24">
            <Layers3
              size={28}
              className="mx-auto mb-4 text-white/25"
            />

            <h3 className="text-base font-semibold text-white 2xl:text-xl">
              No featured templates yet
            </h3>

            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/40 2xl:mt-3 2xl:max-w-xl 2xl:text-base 2xl:leading-7">
              The XOGrid spotlight is waiting for templates to be
              selected. Explore the registry to discover available
              templates.
            </p>

            <Link
              to="/explore"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-xs font-semibold text-white transition hover:bg-orange-400 2xl:mt-8 2xl:rounded-2xl 2xl:px-7 2xl:py-4 2xl:text-sm"
            >
              Explore templates
              <ArrowUpRight size={15} />
            </Link>
          </div>
        )}

        {/* No search results */}
        {!loading &&
          !error &&
          templates.length > 0 &&
          filteredTemplates.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center 2xl:rounded-3xl 2xl:py-24">
              <Search
                size={25}
                className="mx-auto mb-4 text-white/25"
              />

              <h3 className="text-base font-semibold text-white 2xl:text-xl">
                No templates found
              </h3>

              <p className="mt-2 text-sm text-white/40 2xl:text-base">
                Try another search term.
              </p>

              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mt-5 text-xs font-semibold text-orange-400 transition-colors hover:text-orange-300 2xl:mt-7 2xl:text-sm"
              >
                Clear search
              </button>
            </div>
          )}

        {/* Trust note */}
        <div className="mt-7 flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 sm:items-center sm:p-5 2xl:mt-10 2xl:gap-5 2xl:rounded-2xl 2xl:p-7">
          <ShieldCheck
            size={19}
            className="mt-0.5 shrink-0 text-orange-400 sm:mt-0 2xl:h-6 2xl:w-6"
          />

          <p className="text-[11px] leading-6 text-white/40 sm:text-xs 2xl:text-sm 2xl:leading-7">
            Automated checks and community reviews provide
            information about a template, not a guarantee of safety.
            An unchecked template has not yet received an audit report.
            Always inspect a template and evaluate it against your
            own wallet policy.
          </p>
        </div>
      </div>

    </section>
  );
}

export default FeaturedTemplates;
