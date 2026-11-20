import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Flag,
  FileCode2,
  Copy,
  Users,
} from "lucide-react";

import xogridlogo from "../assets/images/xogridlogo.png";
import { flagTemplate, getTemplate, listReviews, type CheckResult } from "../hub/api";
import { useLoad } from "../hub/useLoad";
import { ReviewForm } from "../components/hub/ReviewForm";
import { explorerUrl } from "../hub/receipts";
import { categoryLabel } from "../hub/categories";
import { Stars } from "../components/hub/Stars";
import { TemplateContents } from "../components/hub/TemplateContents";
import { TemplateExport } from "../components/hub/TemplateExport";
import { inviteToolLink } from "../config/inviteTool";
import { TemplateResources } from "../components/hub/TemplateResources";
import { viewTemplate } from "../hub/templateView";

const badgeLabel = { unchecked: "Unchecked", "auto-checked": "Auto-checked", reviewed: "Reviewed" } as const;
const badgeStyle = {
  unchecked: "text-slate-300 bg-slate-400/10 border-slate-400/20",
  "auto-checked": "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  reviewed: "text-violet-300 bg-violet-400/10 border-violet-400/20",
} as const;
const badgeHint = {
  unchecked: "No checks have been recorded for this template.",
  "auto-checked": "Automated checks found no failure. This is not a safety claim.",
  reviewed: "A moderator reviewed this exact template.",
} as const;

const checkIcon = (status: CheckResult["status"]) =>
  status === "pass" ? (
    <CheckCircle2 size={17} className="text-emerald-300" />
  ) : status === "warn" ? (
    <AlertTriangle size={17} className="text-amber-300" />
  ) : status === "fail" ? (
    <XCircle size={17} className="text-rose-300" />
  ) : (
    <MinusCircle size={17} className="text-slate-500" />
  );

const card = "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 sm:p-7 2xl:p-9";
const heading = "text-xs font-semibold uppercase tracking-[.16em] text-slate-500";
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function TemplateDetail() {
  const { identifier = "" } = useParams();
  const template = useLoad(() => getTemplate(identifier), [identifier]);
  const reviews = useLoad(() => listReviews(identifier), [identifier]);
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagNote, setFlagNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const detail = template.data;
  const view = useMemo(() => viewTemplate(detail?.template), [detail?.template]);

  async function sendFlag() {
    try {
      await flagTemplate(identifier, flagReason.trim());
      setFlagNote("Thank you. Moderators will look at this report.");
      setFlagging(false);
      setFlagReason("");
      template.reload();
    } catch (reason) {
      setFlagNote(reason instanceof Error ? reason.message : "Could not send the report.");
    }
  }

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 2xl:max-w-375 2xl:px-10 2xl:py-10">
        <header className="mb-10 flex items-center justify-between 2xl:mb-14">
          <Link to="/" className="flex items-center gap-3">
            <img src={xogridlogo} alt="XOGrid" className="" style={{ width: '12rem' }} />
          </Link>
          <Link to="/explore" className="flex items-center gap-2 text-slate-400 transition hover:text-white text-lg">
            <ArrowLeft strokeWidth={1} size={28} />
            All templates
          </Link>
        </header>

        {template.loading && !detail && <p className="text-slate-400">Loading template...</p>}
        {template.error && (
          <div className={card}>
            <p className="text-rose-300">{template.error}</p>
            <Link to="/explore" className="mt-4 inline-block text-sm text-orange-400">
              Back to the registry
            </Link>
          </div>
        )}

        {detail && (
          <div className="space-y-6 2xl:space-y-8">
            <section className={card}>
              <div className="flex flex-wrap items-start justify-between gap-4 2xl:gap-8">
                <div className="flex items-center gap-4 2xl:gap-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-400/15 bg-orange-500/[0.08] text-orange-300 2xl:h-16 2xl:w-16">
                    <FileCode2 size={26} />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[.15em] text-violet-300">{detail.publisher}</p>
                    <h1 className="text-3xl font-bold tracking-tight 2xl:text-4xl">{detail.name}</h1>
                    {detail.categories?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {detail.categories.map((slug) => (
                          <Link
                            key={slug}
                            to={`/explore?category=${encodeURIComponent(slug)}`}
                            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-orange-400/40 hover:text-white"
                          >
                            {categoryLabel(slug)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  title={badgeHint[detail.badge]}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${badgeStyle[detail.badge]}`}
                >
                  {badgeLabel[detail.badge]}
                </span>
              </div>

              {detail.removed && (
                <p className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
                  Removed by a moderator{detail.removedReason ? `: ${detail.removedReason}` : "."}
                </p>
              )}

              <p className="mt-5 text-slate-300 2xl:mt-7 2xl:text-base">{detail.description}</p>

              <div className="mt-6 flex flex-wrap items-center gap-5 text-sm text-slate-400 2xl:mt-8 2xl:gap-8">
                {detail.averageRating !== null ? (
                  <span className="flex items-center gap-2">
                    <Stars value={detail.averageRating} />
                    {detail.averageRating.toFixed(1)} from {detail.userReviewCount} review
                    {detail.userReviewCount === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span>No community reviews yet</span>
                )}
                <span>Added {when(detail.createdAt)}</span>
                {detail.openFlags > 0 && <span className="text-rose-300">{detail.openFlags} open flag(s)</span>}
              </div>

              <div className="mt-6 rounded-2xl border border-white/[0.06] bg-black/20 p-4 2xl:mt-8 2xl:p-6">
                <p className={heading}>Template identifier</p>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p className="break-all font-mono text-sm text-slate-300">{detail.identifier}</p>
                  <button
                    type="button"
                    aria-label="Copy identifier"
                    onClick={() => {
                      void navigator.clipboard?.writeText(detail.identifier);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="shrink-0 text-slate-500 transition hover:text-white"
                  >
                    {copied ? <CheckCircle2 size={16} className="text-emerald-300" /> : <Copy size={16} />}
                  </button>
                </div>
                {!detail.removed && (
                  <div className="mt-4 space-y-3">
                    <TemplateExport identifier={detail.identifier} name={detail.name} />
                    {inviteToolLink(detail.identifier) && (
                      <p className="text-sm text-slate-400">
                        Want to use it?{" "}
                        <a
                          href={inviteToolLink(detail.identifier)?.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-orange-400 hover:text-orange-300"
                        >
                          Build an invitation
                        </a>{" "}
                        to {inviteToolLink(detail.identifier)?.what}, ready to import in your XO wallet.
                      </p>
                    )}
                    <a
                      href={`/api/templates/${detail.identifier}/raw`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm font-semibold text-orange-400 hover:text-orange-300"
                    >
                      Open the template JSON
                    </a>
                  </div>
                )}
              </div>
            </section>

            {detail.plainEnglish && (
              <section className={card}>
                <p className={heading}>What this template does</p>
                <p className="mt-3 text-slate-200">{detail.plainEnglish.summary}</p>

                {detail.plainEnglish.steps.length > 0 && (
                  <>
                    <h3 className="mt-6 text-sm font-semibold text-white">Step by step</h3>
                    <ol className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
                      {detail.plainEnglish.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </>
                )}

                {detail.plainEnglish.whoDoesWhat.length > 0 && (
                  <>
                    <h3 className="mt-6 text-sm font-semibold text-white">Who does what</h3>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
                      {detail.plainEnglish.whoDoesWhat.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}

                {detail.plainEnglish.youWillNeed.length > 0 && (
                  <>
                    <h3 className="mt-6 text-sm font-semibold text-white">What you provide</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
                      {detail.plainEnglish.youWillNeed.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            {!detail.removed && <TemplateResources resources={view.resources} />}

            {!detail.removed && <TemplateContents view={view} />}

            {detail.auditReport && (
              <section className={card}>
                <p className={heading}>Automated checks (version {detail.auditReport.checkerVersion})</p>
                <ul className="mt-4 space-y-3 2xl:mt-6 2xl:space-y-4">
                  {detail.auditReport.results.map((check) => (
                    <li key={check.id} className="flex gap-3">
                      <span className="mt-0.5">{checkIcon(check.status)}</span>
                      <div className="max-w-full break-all md:break-normal">
                        <p className="text-sm font-semibold text-white">{check.title}</p>
                        <p className="text-sm text-slate-400">{check.message}</p>
                        {check.details?.map((line) => (
                          <p key={line} className="font-mono text-xs text-slate-500">
                            {line}
                          </p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-slate-500">Passing the checks is not a safety claim.</p>
              </section>
            )}

            {detail.reviews.length > 0 && (
              <section className={card}>
                <p className={heading}>Moderator reviews</p>
                <ul className="mt-4 space-y-4 2xl:mt-6 2xl:space-y-6">
                  {detail.reviews.map((review) => (
                    <li key={review.id} className="border-l-2 border-violet-400/40 pl-4">
                      <p className="text-sm text-slate-200">{review.note}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {review.reviewerLabel ?? review.reviewerAddress} · {when(review.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className={card}>
              <div className="flex items-center justify-between gap-3">
                <p className={heading}>Community reviews</p>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <Users size={14} />
                  Signed by wallets
                </span>
              </div>

              {reviews.data && reviews.data.stats.count > 0 && (
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-4xl font-bold">{reviews.data.stats.average?.toFixed(1)}</span>
                  <div>
                    <Stars value={reviews.data.stats.average ?? 0} size={18} />
                    <p className="text-xs text-slate-500">{reviews.data.stats.count} reviews</p>
                  </div>
                </div>
              )}

              {reviews.error && <p className="mt-4 text-sm text-rose-300">{reviews.error}</p>}
              {reviews.data && reviews.data.items.length === 0 && (
                <p className="mt-4 text-sm text-slate-400">No reviews yet. Be the first.</p>
              )}

              <ul className="mt-5 space-y-5 2xl:mt-7 2xl:space-y-6">
                {reviews.data?.items.map((review) => (
                  <li key={review.id} className="rounded-2xl border border-white/[0.06] bg-black/20 p-4 2xl:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <Stars value={review.rating} />
                      <span className="text-xs text-slate-500">{when(review.createdAt)}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{review.body}</p>
                    <p className="mt-2 font-mono text-xs text-slate-500" title={review.reviewerAddress}>
                      {review.reviewer}
                    </p>
                    {review.receipt && (
                      <p className="mt-1 text-xs">
                        {review.receipt.status === "confirmed" ? (
                          <a
                            href={explorerUrl(review.receipt.network, review.receipt.txid)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-300 underline"
                            title="A public receipt on Bitcoin Cash ties this key, rating and text fingerprint to the template."
                          >
                            Recorded on-chain ({review.receipt.network === "mainnet" ? "mainnet" : "chipnet"})
                          </a>
                        ) : (
                          <span className="text-amber-300">On-chain receipt pending</span>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-xs leading-5 text-slate-500">
                A review proves a wallet signed it, not that the person used the template. Anyone can create a new wallet.
              </p>
            </section>

            {!detail.removed && (
              <ReviewForm
                identifier={detail.identifier}
                onPosted={() => {
                  reviews.reload();
                  template.reload();
                }}
              />
            )}

            {!detail.removed && (
              <section className={card}>
                <div className="flex items-center justify-between gap-3">
                  <p className={heading}>Report this template</p>
                  {!flagging && (
                    <button
                      type="button"
                      onClick={() => setFlagging(true)}
                      className="flex items-center gap-2 text-sm text-slate-400 transition hover:text-orange-300"
                    >
                      <Flag size={15} />
                      Report
                    </button>
                  )}
                </div>

                {flagging && (
                  <div className="mt-4">
                    <textarea
                      value={flagReason}
                      onChange={(event) => setFlagReason(event.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="What is wrong with this template?"
                      className="w-full rounded-2xl border border-white/[0.08] bg-[#080a10] p-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400/50"
                    />
                    <div className="mt-3 flex gap-3">
                      <button
                        type="button"
                        disabled={flagReason.trim().length < 3}
                        onClick={sendFlag}
                        className="rounded-xl bg-rose-500/80 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-40"
                      >
                        Send report
                      </button>
                      <button type="button" onClick={() => setFlagging(false)} className="text-sm text-slate-400">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {flagNote && <p className="mt-3 text-sm text-slate-300">{flagNote}</p>}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default TemplateDetail;