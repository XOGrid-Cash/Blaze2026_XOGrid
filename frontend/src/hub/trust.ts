import { BadgeCheck, MinusCircle, ShieldCheck, type LucideIcon } from "lucide-react";

import type { Badge } from "./api";

// What each trust badge means: a plain label, a shorter one for cards, and the careful wording for tooltips.

export const TRUST: Record<Badge, { label: string; short: string; fine: string; icon: LucideIcon; tone: string }> = {
  unchecked: {
    label: "Not checked yet",
    short: "Not checked",
    fine: "No automated checks or moderator reviews have been recorded for this template.",
    icon: MinusCircle,
    tone: "text-slate-300 border-slate-400/20 bg-slate-400/10",
  },
  "auto-checked": {
    label: "Passed automatic checks",
    short: "Checked",
    fine: "Automated checks found no problems. That is not a promise that it is safe.",
    icon: ShieldCheck,
    tone: "text-emerald-300 border-emerald-400/20 bg-emerald-400/10",
  },
  reviewed: {
    label: "Reviewed by a moderator",
    short: "Reviewed",
    fine: "A moderator reviewed this exact template.",
    icon: BadgeCheck,
    tone: "text-violet-300 border-violet-400/20 bg-violet-400/10",
  },
};
