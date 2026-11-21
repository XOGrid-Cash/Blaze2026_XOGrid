import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  ChevronDown,
  Code2,
  Flag,
  Copy,
  PenLine,
  Users,
} from "lucide-react";

import xogridlogo from "../assets/images/xogridlogo.png";
import { flagTemplate, getTemplate, listReviews, type CheckResult, type Detail, type PlainEnglish } from "../hub/api";
import { useLoad } from "../hub/useLoad";
import { useViewMode, type ViewMode } from "../hub/useViewMode";
import { ReviewForm } from "../components/hub/ReviewForm";
import { explorerUrl } from "../hub/receipts";
import { Stars } from "../components/hub/Stars";
import { TemplateContents } from "../components/hub/TemplateContents";
import { TemplateExport } from "../components/hub/TemplateExport";
import { TemplateResources } from "../components/hub/TemplateResources";
import { TemplateHero } from "../components/hub/TemplateHero";
import { ViewModeToggle } from "../components/hub/ViewModeToggle";
import { demoLink, liveDemo } from "../config/demos";
import { viewTemplate } from "../hub/templateView";

const checkIcon = (status: CheckResult["status"]) =>
  status === "pass" ? (
    <CheckCircle2 size={17} className="text-emerald-300" />
  ) : status === "warn" ? (
    <AlertTriangle size={17} className="text-amber-300" />
  ) : status === "fail" ? (
    <XCircle size={17} className="text-rose-300" />
  ) : (
    <MinusCircle size={17} className="text-slate-400" />
  );

const card = "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 sm:p-8 2xl:p-10";
const label = "text-xs font-semibold uppercase tracking-[.16em] text-slate-400";
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** A section title: big and plain. */
function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-2xl font-bold tracking-tight text-white">{children}</h2>
      {aside}
    </div>
  );
}

/** "Fund the Drip Mine (Funder): Send …" → title, role and text. Lines that do not fit that shape stay whole. */
function splitStep(step: string): { title: string | null; role: string | null; text: string } {
  // The cards are numbered already, so drop a "1. " the text starts with.
  const unnumbered = step.replace(/^\d+\.\s*/, "");
  const match = /^(.+?) \(([^)]+)\): (.+)$/s.exec(unnumbered);

  return match ? { title: match[1], role: match[2], text: match[3] } : { title: null, role: null, text: unnumbered };
}

/** "Funder: Sends …" or "coin value - The value …" → name and text. */
function splitNamed(line: string, separator: string): { name: string | null; text: string } {
  const at = line.indexOf(separator);

  return at > 0 && at < 60 ? { name: line.slice(0, at), text: line.slice(at + separator.length) } : { name: null, text: line };
}

function HowItWorks({ plain, technical }: { plain: PlainEnglish; technical: boolean }) {
  const [more, setMore] = useState(false);
  const showMore = technical || more;
  const hasMore = plain.whoDoesWhat.length > 0 || plain.youWillNeed.length > 0;
  const body = technical ? "text-sm leading-6" : "text-base leading-7";

  return (
    <section id="how" className={`${card} scroll-mt-24`}>
      <SectionTitle>How it works</SectionTitle>
      <p className={`mt-3 max-w-3xl text-slate-300 ${body}`}>{plain.summary}</p>

      {plain.steps.length > 0 && (
        <ol className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plain.steps.map((step, index) => {
            const { title, role, text } = splitStep(step);

            return (
              <li key={step} className="flex gap-4 rounded-2xl border border-white/[0.06] bg-black/20 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500 text-lg font-bold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  {title && <p className="text-base font-semibold text-white">{title}</p>}
                  {role && (
                    <span className="mt-1 inline-block rounded-full bg-violet-400/10 px-2.5 py-0.5 text-xs font-semibold text-violet-300">
                      {role}
                    </span>
                  )}
                  <p className={`mt-2 text-slate-300 ${technical ? "text-sm leading-6" : "text-[15px] leading-6"}`}>{text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && !showMore && (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-400 hover:text-orange-300"
        >
          Who takes part, and what you'll need
          <ChevronDown size={16} />
        </button>
      )}

      {hasMore && showMore && (
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          {plain.whoDoesWhat.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-white">Who takes part</h3>
              <ul className="mt-3 space-y-3">
                {plain.whoDoesWhat.map((line) => {
                  const { name, text } = splitNamed(line, ": ");

                  return (
                    <li key={line} className={`text-slate-300 ${body}`}>
                      {name && <span className="mr-2 rounded-full bg-violet-400/10 px-2.5 py-0.5 text-sm font-semibold text-violet-300">{name}</span>}
                      {text}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {plain.youWillNeed.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-white">What you'll need</h3>
              <ul className="mt-3 space-y-3">
                {plain.youWillNeed.map((line) => {
                  const { name, text } = splitNamed(line, " - ");

                  return (
                    <li key={line} className={`flex gap-3 text-slate-300 ${body}`}>
                      <CheckCircle2 size={18} className="mt-1 shrink-0 text-orange-400" />
                      <span>
                        {name && <span className="font-semibold text-white">{name}: </span>}
                        {text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DemoCard({ identifier }: { identifier: string }) {
  const demo = liveDemo(identifier);

  if (!demo) {
    return null;
  }

  const Icon = demo.icon;

  return (
    <section
      id="demo"
      className="scroll-mt-24 rounded-3xl border border-orange-400/20 bg-gradient-to-br from-orange-500/[0.12] via-[#121522] to-[#0a0c13] p-6 sm:p-8 2xl:p-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-300">
            <Icon size={26} />
          </span>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">See it in action</h2>
            <p className="mt-2 max-w-xl text-base leading-7 text-slate-300">{demo.blurb}</p>
          </div>
        </div>
        <Link
          to={demoLink(identifier)}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400"
        >
          Try it out
          <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}

function Reviews({ detail, onPosted, reviews }: { detail: Detail; onPosted: () => void; reviews: ReturnType<typeof useReviews> }) {
  const [writing, setWriting] = useState(false);
  const count = reviews.data?.stats.count ?? 0;

  return (
    <section id="reviews" className={`${card} scroll-mt-24`}>
      <SectionTitle
        aside={
          !detail.removed &&
          !writing && (
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-orange-400/40 hover:text-white"
            >
              <PenLine size={15} />
              Write a review
            </button>
          )
        }
      >
        Reviews
      </SectionTitle>

      {detail.reviews.length > 0 && (
        <div className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-5">
          <p className={`${label} text-violet-300`}>From the moderators</p>
          <ul className="mt-3 space-y-4">
            {detail.reviews.map((review) => (
              <li key={review.id}>
                <p className="text-base leading-7 text-slate-200">{review.note}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {review.reviewerLabel ?? review.reviewerAddress} · {when(review.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {writing && (
        <div className="mt-6">
          <ReviewForm identifier={detail.identifier} onPosted={onPosted} />
        </div>
      )}

      {count > 0 && (
        <div className="mt-6 flex items-center gap-3">
          <span className="text-4xl font-bold">{reviews.data?.stats.average?.toFixed(1)}</span>
          <div>
            <Stars value={reviews.data?.stats.average ?? 0} size={18} />
            <p className="text-xs text-slate-400">
              {count} review{count === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}

      {reviews.error && <p className="mt-4 text-sm text-rose-300">{reviews.error}</p>}
      {reviews.data && reviews.data.items.length === 0 && (
        <p className="mt-4 text-base text-slate-400">No reviews yet. Tried it? Be the first to say how it went.</p>
      )}

      {(reviews.data?.items.length ?? 0) > 0 && (
        <ul className="mt-6 space-y-4">
          {reviews.data?.items.map((review) => (
            <li key={review.id} className="rounded-2xl border border-white/[0.06] bg-black/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <Stars value={review.rating} />
                <span className="text-xs text-slate-400">{when(review.createdAt)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-slate-200">{review.body}</p>
              <p className={`mt-2 text-xs text-slate-400 ${review.reviewerName ? "font-medium" : "font-mono"}`} title={review.reviewerAddress}>
                {review.reviewerName ?? review.reviewer}
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
      )}

      <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-400">
        <Users size={14} className="mt-0.5 shrink-0" />
        Every review is signed by a wallet. That proves a wallet wrote it, not that the person used the template.
      </p>
    </section>
  );
}

function ChecksSummary({ results }: { results: CheckResult[] }) {
  const count = (status: CheckResult["status"]) => results.filter((check) => check.status === status).length;
  const parts = [
    [count("pass"), "passed", "text-emerald-300"],
    [count("warn"), count("warn") === 1 ? "warning" : "warnings", "text-amber-300"],
    [count("fail"), "failed", "text-rose-300"],
    [count("skipped"), "skipped", "text-slate-400"],
  ] as const;

  return (
    <p className="mt-2 text-sm">
      {parts
        .filter(([n]) => n > 0)
        .map(([n, word, tone], index) => (
          <span key={word} className={tone}>
            {index > 0 && <span className="text-slate-600"> · </span>}
            {n} {word}
          </span>
        ))}
    </p>
  );
}

function Technical({ detail, mode, onShow }: { detail: Detail; mode: ViewMode; onShow: () => void }) {
  const view = useMemo(() => viewTemplate(detail.template), [detail.template]);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  if (mode === "simple" && !open) {
    return (
      <section id="technical" className={`${card} scroll-mt-24`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Code2 size={22} className="mt-1 shrink-0 text-slate-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Technical details</h2>
              <p className="mt-1 text-sm text-slate-400">The template file, its full contents and the automated checks. For developers and reviewers.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-orange-400/40 hover:text-white"
            >
              Show
              <ChevronDown size={15} />
            </button>
            <button type="button" onClick={onShow} className="text-sm text-slate-400 underline-offset-4 transition hover:text-white hover:underline">
              Always show
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div id="technical" className="scroll-mt-24 space-y-6 2xl:space-y-8">
      <div className="px-1">
        <h2 className="text-2xl font-bold tracking-tight text-white">Technical details</h2>
        <p className="mt-1 text-sm text-slate-400">For developers and reviewers: the template file, sources, full contents and the automated checks.</p>
      </div>

      {!detail.removed && (
        <section className={card}>
          <p className={label}>Template identifier</p>
          <div className="mt-2 flex items-start justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
            <p className="break-all font-mono text-sm text-slate-300">{detail.identifier}</p>
            <button
              type="button"
              aria-label="Copy identifier"
              onClick={() => {
                void navigator.clipboard?.writeText(detail.identifier);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 text-slate-400 transition hover:text-white"
            >
              {copied ? <CheckCircle2 size={16} className="text-emerald-300" /> : <Copy size={16} />}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Added {when(detail.createdAt)}. Publisher: <span className="break-all font-mono">{detail.publisher}</span></p>
          <div className="mt-5 flex flex-wrap items-start gap-4">
            <TemplateExport identifier={detail.identifier} name={detail.name} />
            <a
              href={`/api/templates/${detail.identifier}/raw`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center py-2 text-sm font-semibold text-orange-400 hover:text-orange-300"
            >
              Open the template JSON
            </a>
          </div>
        </section>
      )}

      {detail.auditReport && (
        <section className={card}>
          <p className={label}>Automated checks (version {detail.auditReport.checkerVersion})</p>
          <ChecksSummary results={detail.auditReport.results} />
          <ul className="mt-5 space-y-3 2xl:space-y-4">
            {detail.auditReport.results.map((check) => (
              <li key={check.id} className="flex gap-3">
                <span className="mt-0.5">{checkIcon(check.status)}</span>
                <div className="max-w-full break-all md:break-normal">
                  <p className="text-sm font-semibold text-white">{check.title}</p>
                  <p className="text-sm text-slate-400">{check.message}</p>
                  {check.details?.map((line) => (
                    <p key={line} className="font-mono text-xs text-slate-400">
                      {line}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400">Passing the checks is not a safety claim.</p>
        </section>
      )}

      {!detail.removed && <TemplateResources resources={view.resources} />}

      {!detail.removed && <TemplateContents view={view} />}
    </div>
  );
}

function ReportLink({ identifier, onSent }: { identifier: string; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    try {
      await flagTemplate(identifier, reason.trim());
      setNote("Thank you. Moderators will look at this report.");
      setOpen(false);
      setReason("");
      onSent();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not send the report.");
    }
  }

  return (
    <div className="px-1">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-orange-300">
          <Flag size={14} />
          Report a problem with this template
        </button>
      )}
      {open && (
        <div className={card}>
          <p className="text-lg font-semibold text-white">Report a problem</p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="What is wrong with this template?"
            className="mt-3 w-full rounded-2xl border border-white/[0.08] bg-[#080a10] p-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400/50"
          />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={reason.trim().length < 3}
              onClick={send}
              className="rounded-xl bg-rose-500/80 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-40"
            >
              Send report
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-400">
              Cancel
            </button>
          </div>
        </div>
      )}
      {note && <p className="mt-3 text-sm text-slate-300">{note}</p>}
    </div>
  );
}

function useReviews(identifier: string) {
  return useLoad(() => listReviews(identifier), [identifier]);
}

function TemplateDetail() {
  const { identifier = "" } = useParams();
  const template = useLoad(() => getTemplate(identifier), [identifier]);
  const reviews = useReviews(identifier);
  const [mode, setMode] = useViewMode();
  const technical = mode === "technical";

  const detail = template.data;
  const demo = detail && !detail.removed ? liveDemo(detail.identifier) : null;

  const sections = detail
    ? [
        detail.plainEnglish && { href: "#how", text: "How it works" },
        demo && { href: "#demo", text: "Demo" },
        { href: "#reviews", text: `Reviews${reviews.data ? ` (${reviews.data.stats.count})` : ""}` },
        { href: "#technical", text: "Technical details" },
      ].filter((item): item is { href: string; text: string } => Boolean(item))
    : [];

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 2xl:max-w-375 2xl:px-10 2xl:py-10">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 2xl:mb-12">
          <Link to="/" className="flex items-center">
            <img src={xogridlogo} alt="XOGrid" className="w-36 sm:w-48" />
          </Link>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <ViewModeToggle mode={mode} onChange={setMode} />
            <Link to="/explore" className="flex items-center gap-2 text-base text-slate-400 transition hover:text-white">
              <ArrowLeft strokeWidth={1.5} size={22} />
              All templates
            </Link>
          </div>
        </header>

        {template.loading && !detail && <p className="text-slate-400">Loading template...</p>}
        {template.error && (
          <div className={card}>
            <p className="text-rose-300">{template.error}</p>
            <button type="button" onClick={template.reload} className="mr-5 mt-4 text-sm font-semibold text-orange-400">
              Try again
            </button>
            <Link to="/explore" className="mt-4 inline-block text-sm text-orange-400">
              Back to the registry
            </Link>
          </div>
        )}

        {detail && (
          <div className="space-y-6 2xl:space-y-8">
            {technical && (
              <nav
                aria-label="On this page"
                className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/[0.06] bg-[#05070b]/90 px-5 py-3 text-sm backdrop-blur sm:mx-0 sm:rounded-2xl sm:border"
              >
                {sections.map((section) => (
                  <a key={section.href} href={section.href} className="font-semibold text-slate-300 transition hover:text-orange-300">
                    {section.text}
                  </a>
                ))}
              </nav>
            )}

            <TemplateHero detail={detail} mode={mode} shortSummary={Boolean(detail.plainEnglish)} />

            {detail.plainEnglish && <HowItWorks plain={detail.plainEnglish} technical={technical} />}

            {demo && <DemoCard identifier={detail.identifier} />}

            <Reviews
              detail={detail}
              reviews={reviews}
              onPosted={() => {
                reviews.reload();
                template.reload();
              }}
            />

            <Technical detail={detail} mode={mode} onShow={() => setMode("technical")} />

            {!detail.removed && <ReportLink identifier={detail.identifier} onSent={template.reload} />}

          </div>
        )}
      </div>
    </main>
  );
}

export default TemplateDetail;
