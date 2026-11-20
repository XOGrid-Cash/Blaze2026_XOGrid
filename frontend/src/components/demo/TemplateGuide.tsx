import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Copy, ExternalLink, FileJson, Info, Loader2, ShieldCheck, Users } from "lucide-react";

import { getTemplate, type Detail } from "../../hub/api";

// The Demo's view for every template that does not have a live in-browser run: what the template does, who does what,
// and what the automated audit found, all read from the registry.

export default function TemplateGuide({ identifier }: { identifier: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let current = true;

    setDetail(null);
    setError("");
    setActive(0);

    getTemplate(identifier)
      .then((value) => {
        if (current) setDetail(value);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : "Could not load this template.");
      });

    return () => {
      current = false;
    };
  }, [identifier]);

  async function copyIdentifier() {
    try {
      await navigator.clipboard.writeText(identifier);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the identifier is shown in full and can be selected.
    }
  }

  if (error) {
    return <p className="rounded-xl border border-rose-500/20 bg-rose-500/[0.07] p-4 text-sm text-rose-300">{error}</p>;
  }

  if (!detail) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Loading template...
      </p>
    );
  }

  const plain = detail.plainEnglish;
  const steps = plain?.steps ?? [];
  const counts = detail.audit?.counts;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-white">{detail.name}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">{plain?.summary || detail.description}</p>
          </div>
          <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-300">
            {detail.badge}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={copyIdentifier}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-mono text-[11px] text-gray-400 transition hover:border-orange-400/40 hover:text-orange-300"
            title={identifier}
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {identifier.slice(0, 14)}…
          </button>
          <Link
            to={`/t/${identifier}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-gray-300 transition hover:border-orange-400/40 hover:text-orange-300"
          >
            Full template page <ExternalLink size={12} />
          </Link>
          <a
            href={`/api/templates/${encodeURIComponent(identifier)}/raw`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-gray-300 transition hover:border-orange-400/40 hover:text-orange-300"
          >
            <FileJson size={12} /> Raw JSON
          </a>
        </div>
      </section>

      {steps.length > 0 ? (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-white">Walk through it</h3>
          <p className="mt-1 text-xs text-gray-500">Click a step to follow the template from start to finish.</p>

          <ol className="mt-5 space-y-2">
            {steps.map((step, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition ${
                    index === active
                      ? "border-orange-500/30 bg-orange-500/[0.07] text-white"
                      : index < active
                        ? "border-emerald-500/15 bg-emerald-500/[0.04] text-gray-300"
                        : "border-white/[0.06] text-gray-400 hover:border-white/15"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      index < active ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/70"
                    }`}
                  >
                    {index < active ? <Check size={12} /> : index + 1}
                  </span>
                  <span className="leading-6">{step}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex justify-between">
            <button
              type="button"
              disabled={active === 0}
              onClick={() => setActive((value) => Math.max(0, value - 1))}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs text-gray-300 transition hover:border-white/25 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={active >= steps.length - 1}
              onClick={() => setActive((value) => Math.min(steps.length - 1, value + 1))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-orange-400 disabled:opacity-40"
            >
              Next step <ArrowRight size={13} />
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Users size={15} className="text-orange-400" /> Who does what
          </h3>
          {plain && plain.whoDoesWhat.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-400">
              {plain.whoDoesWhat.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : detail.roles.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-400">
              {detail.roles.map((role) => (
                <li key={role.id}>
                  <b className="text-gray-200">{role.name}</b>
                  {role.description ? `: ${role.description}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500">This template does not describe its roles.</p>
          )}
          {plain && plain.youWillNeed.length > 0 ? (
            <>
              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-gray-500">You will need</h4>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-gray-400">
                {plain.youWillNeed.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck size={15} className="text-emerald-400" /> Automated audit
          </h3>
          {counts ? (
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
              {(["pass", "warn", "fail", "skipped"] as const).map((key) => (
                <div key={key} className="rounded-lg border border-white/[0.06] p-2">
                  <p className="text-lg font-semibold text-white">{counts[key]}</p>
                  <p className="text-gray-500">{key}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">This template has not been audited yet.</p>
          )}
          {detail.auditReport ? (
            <ul className="mt-3 space-y-1.5 text-xs text-gray-400">
              {detail.auditReport.results
                .filter((result) => result.status === "warn" || result.status === "fail")
                .slice(0, 4)
                .map((result) => (
                  <li key={result.id}>
                    <b className={result.status === "fail" ? "text-rose-300" : "text-amber-300"}>{result.status}</b> · {result.title}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs leading-5 text-gray-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        Only the Claim-Code Voucher and Drip Mine can be run from this page today. For the other templates, this guide shows
        what they do and what the audit found. To use one, download its JSON and import it into an XO-compatible wallet tool.
      </p>
    </div>
  );
}
