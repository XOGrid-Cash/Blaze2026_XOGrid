import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, FileCode2, Play } from "lucide-react";

import type { Detail } from "../../hub/api";
import { shortSummary as summarize } from "../../hub/summary";
import { TRUST } from "../../hub/trust";
import { categoryLabel } from "../../hub/categories";
import type { ViewMode } from "../../hub/useViewMode";
import { demoLink, liveDemo } from "../../config/demos";
import { inviteToolLink } from "../../config/inviteTool";
import { Stars } from "./Stars";
import { TemplateExport } from "./TemplateExport";

const card = "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 sm:p-8 2xl:p-10";
const primaryButton =
  "inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400";
const secondaryButton =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-base font-semibold text-slate-200 transition hover:border-orange-400/40 hover:text-white";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** The top of a template page: what it is, whether to trust it, and the one thing to do next. */
export function TemplateHero({ detail, mode, shortSummary }: { detail: Detail; mode: ViewMode; shortSummary: boolean }) {
  const technical = mode === "technical";
  const demo = detail.removed ? null : liveDemo(detail.identifier);
  const invite = detail.removed ? null : inviteToolLink(detail.identifier);
  const trust = TRUST[detail.badge];
  const TrustIcon = trust.icon;
  const counts = detail.audit?.counts;

  return (
    <section className={card}>
      <div className="flex items-start gap-4 2xl:gap-6">
        <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-orange-400/15 bg-orange-500/[0.08] text-orange-300 sm:flex">
          <FileCode2 size={30} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-violet-300" title={detail.publisherName ? detail.publisher : undefined}>
            by {detail.publisherName ?? detail.publisher}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl 2xl:text-5xl">{detail.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {demo && (
              <Link
                to={demoLink(detail.identifier)}
                className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-300 transition hover:bg-orange-500/20"
              >
                <Play size={12} className="fill-current" />
                Try it live
              </Link>
            )}
            {detail.categories?.map((slug) => (
              <Link
                key={slug}
                to={`/explore?category=${encodeURIComponent(slug)}`}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-400 transition hover:border-orange-400/40 hover:text-white"
              >
                {categoryLabel(slug)}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {detail.removed && (
        <p className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-base text-red-200">
          This template was removed by a moderator{detail.removedReason ? `: ${detail.removedReason}` : "."}
        </p>
      )}

      <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-200">{shortSummary ? summarize(detail.description) : detail.description}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span
          title={technical ? undefined : trust.fine}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${trust.tone}`}
        >
          <TrustIcon size={16} />
          {trust.label}
        </span>
        {detail.openFlags > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3.5 py-1.5 text-sm font-semibold text-amber-300">
            <AlertTriangle size={16} />
            {detail.openFlags === 1 ? "1 open report" : `${detail.openFlags} open reports`}
          </span>
        )}
        <a href="#reviews" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white">
          {detail.averageRating !== null ? (
            <>
              <Stars value={detail.averageRating} />
              {detail.averageRating.toFixed(1)} · {detail.userReviewCount} review{detail.userReviewCount === 1 ? "" : "s"}
            </>
          ) : (
            "No reviews yet"
          )}
        </a>
      </div>

      {technical && (
        <p className="mt-3 text-xs leading-5 text-slate-400">
          {trust.fine}
          {counts && ` Checker ${detail.audit?.checkerVersion}: ${counts.pass} passed, ${counts.warn} warning${counts.warn === 1 ? "" : "s"}, ${counts.fail} failed, ${counts.skipped} skipped.`}{" "}
          Added {when(detail.createdAt)}.
        </p>
      )}

      {!detail.removed && (
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-7">
          {demo ? (
            <Link to={demoLink(detail.identifier)} className={primaryButton}>
              <Play size={18} className="fill-current" />
              Try it now
            </Link>
          ) : null}
          {invite && (
            <a href={invite.href} target="_blank" rel="noopener noreferrer" className={demo ? secondaryButton : primaryButton}>
              Build an invitation
              <ExternalLink size={16} />
            </a>
          )}
          {!demo && !invite && <TemplateExport identifier={detail.identifier} name={detail.name} primary />}
          {invite && (
            <p className="w-full text-sm text-slate-400">
              The invitation lets you {invite.what} from your own XO wallet.
            </p>
          )}
          {!demo && !invite && (
            <p className="w-full text-sm text-slate-400">Import the file into an XO wallet to use this template.</p>
          )}
        </div>
      )}
    </section>
  );
}
