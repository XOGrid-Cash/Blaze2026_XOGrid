import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Copy, Play } from "lucide-react";

import type { Summary } from "../../hub/api";
import { categoryLabel } from "../../hub/categories";
import { shortIdentifier, shortSummary } from "../../hub/summary";
import { TRUST } from "../../hub/trust";
import { templatePath, useTemplateCardClick } from "../../hub/useTemplateCardClick";
import { demoLink, liveDemo } from "../../config/demos";
import { Stars } from "./Stars";

const addedOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * One template in a grid: what it is and does first, then trust and rating, then a quiet technical line (short
 * identifier with a copy button, date added). The whole card opens the template; its own links and buttons do not.
 *
 * `onCategory` makes the category chips filter in place (Explore); without it they link to the filtered Explore page.
 * `blurb` is an editor's note, shown on featured templates.
 */
export function TemplateCard({
  template,
  blurb,
  onCategory,
}: {
  template: Summary;
  blurb?: string;
  onCategory?: (slug: string) => void;
}) {
  const open = useTemplateCardClick();
  const [copied, setCopied] = useState(false);
  const trust = TRUST[template.badge];
  const TrustIcon = trust.icon;
  const demo = liveDemo(template.identifier);
  const counts = template.audit?.counts;
  const trustHint = counts
    ? `${trust.fine} Checks: ${counts.pass} passed, ${counts.warn} warning${counts.warn === 1 ? "" : "s"}, ${counts.fail} failed.`
    : trust.fine;
  const chip =
    "rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-400 transition hover:border-orange-400/40 hover:text-white";

  async function copy() {
    try {
      await navigator.clipboard.writeText(template.identifier);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the full identifier is on the template page.
    }
  }

  return (
    <article
      onClick={(event) => open(event, template.identifier)}
      onAuxClick={(event) => open(event, template.identifier)}
      className="group flex h-full cursor-pointer flex-col rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-orange-400/35 hover:shadow-[0_16px_40px_rgba(0,0,0,0.3)] 2xl:p-6"
    >
      <h3 className="text-xl font-semibold leading-snug text-white transition group-hover:text-orange-200">
        <Link to={templatePath(template.identifier)} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70">
          {template.name}
        </Link>
      </h3>
      <p className="mt-0.5 text-sm text-slate-500" title={template.publisherName ? template.publisher : undefined}>
        by {template.publisherName ?? template.publisher}
      </p>

      <p className="mt-3 line-clamp-2 text-[15px] leading-6 text-slate-300">{shortSummary(template.description)}</p>

      {blurb && <p className="mt-3 border-l-2 border-orange-500/40 pl-3 text-sm italic leading-6 text-slate-400">{blurb}</p>}

      {(demo || template.categories.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {demo && (
            <Link
              to={demoLink(template.identifier)}
              className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-300 transition hover:bg-orange-500/20"
            >
              <Play size={11} className="fill-current" />
              Live demo
            </Link>
          )}
          {template.categories.map((slug) =>
            onCategory ? (
              <button key={slug} type="button" onClick={() => onCategory(slug)} className={chip}>
                {categoryLabel(slug)}
              </button>
            ) : (
              <Link key={slug} to={`/explore?category=${encodeURIComponent(slug)}`} className={chip}>
                {categoryLabel(slug)}
              </Link>
            ),
          )}
        </div>
      )}

      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm text-slate-400">
            {template.averageRating !== null ? (
              <>
                <Stars value={template.averageRating} size={14} />
                <span>
                  {template.averageRating.toFixed(1)} ({template.userReviewCount})
                </span>
              </>
            ) : (
              "No reviews yet"
            )}
          </span>
          <span className="flex items-center gap-1.5">
            {template.openFlags > 0 && (
              <span
                title="Open reports from users, waiting for a moderator"
                className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-300"
              >
                <AlertTriangle size={12} />
                {template.openFlags} {template.openFlags === 1 ? "report" : "reports"}
              </span>
            )}
            <span title={trustHint} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${trust.tone}`}>
              <TrustIcon size={12} />
              {trust.short}
            </span>
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3 font-mono text-xs text-slate-500">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate" title={template.identifier}>
              {shortIdentifier(template.identifier)}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy template identifier"
              title="Copy the full identifier"
              className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
            >
              {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
            </button>
          </span>
          <span className="shrink-0 font-sans">Added {addedOn(template.createdAt)}</span>
        </div>
      </div>
    </article>
  );
}
