import { ExternalLink, BookMarked } from "lucide-react";

import type { ResourceView } from "../../hub/templateView";

const card = "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 sm:p-7 2xl:p-9";
const heading = "text-xs font-semibold uppercase tracking-[.16em] text-slate-500";

/** The sources and credits a template lists in its own "resources" field. Links open in a new tab. */
export function TemplateResources({ resources }: { resources: ResourceView[] }) {
  if (resources.length === 0) {
    return null;
  }

  return (
    <section className={card}>
      <div className="flex items-center gap-2">
        <BookMarked size={16} className="text-violet-300" />
        <p className={heading}>Sources and credits</p>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        Written by the template's publisher. Check these sources yourself; XOGrid does not vouch for them.
      </p>

      <ul className="mt-5 space-y-4 2xl:space-y-5">
        {resources.map((resource, index) => (
          <li key={`${index}-${resource.name}`} className="rounded-2xl border border-white/[0.06] bg-black/20 p-4 2xl:p-5">
            {resource.url ? (
              <a
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-2 text-sm font-semibold text-orange-400 hover:text-orange-300"
              >
                {resource.name}
                <ExternalLink size={14} />
              </a>
            ) : (
              <p className="text-sm font-semibold text-white">{resource.name}</p>
            )}

            {resource.description && <p className="mt-2 text-sm leading-6 text-slate-300">{resource.description}</p>}

            {resource.host ? (
              <p className="mt-2 font-mono text-xs text-slate-500">{resource.host}</p>
            ) : (
              resource.rawUrl && (
                <p className="mt-2 break-all font-mono text-xs text-slate-500">
                  {resource.rawUrl} (not linked: only https addresses are linked)
                </p>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
