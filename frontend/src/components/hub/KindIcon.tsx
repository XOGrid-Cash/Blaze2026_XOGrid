import { ArrowLeftRight, Code, Hash, Lock, Variable, Zap, type LucideIcon } from "lucide-react";

import { KIND_COLOR, KIND_LABEL, type RefKind } from "../../hub/templateRefs";

// The icon for each kind of template part. Shown on links, on each part's heading, in search and in the legend, so
// a reader learns which icon means which kind and can tell what a link points to before following it.

const ICON: Record<RefKind, LucideIcon> = {
  action: Zap,
  transaction: ArrowLeftRight,
  lockingScript: Lock,
  script: Code,
  constant: Hash,
  variable: Variable,
};

/** Decorative: whatever it sits beside must say the kind in words too (visibly or for screen readers). */
export function KindIcon({ kind, size = 12, className }: { kind: RefKind; size?: number; className?: string }) {
  const Icon = ICON[kind];
  return <Icon size={size} aria-hidden="true" className={`inline shrink-0 ${KIND_COLOR[kind]} ${className ?? ""}`} />;
}

/** One line naming the icon and colour of each kind this template has. */
export function KindLegend({ kinds }: { kinds: RefKind[] }) {
  if (kinds.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Kinds of links" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-1">
          <KindIcon kind={kind} />
          <span className={KIND_COLOR[kind]}>{KIND_LABEL[kind]}</span>
        </li>
      ))}
    </ul>
  );
}
