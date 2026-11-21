import { Code2, Sparkles } from "lucide-react";

import type { ViewMode } from "../../hub/useViewMode";

const OPTIONS: { mode: ViewMode; label: string; hint: string; icon: typeof Sparkles }[] = [
  { mode: "simple", label: "Simple", hint: "The essentials, in plain words", icon: Sparkles },
  { mode: "technical", label: "Technical", hint: "Everything: identifier, contents, checks", icon: Code2 },
];

/** A two-way switch between the simple and the technical view of a page. */
export function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="How much detail to show" className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {OPTIONS.map(({ mode: option, label, hint, icon: Icon }) => {
        const active = option === mode;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            onClick={() => onChange(option)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              active ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
