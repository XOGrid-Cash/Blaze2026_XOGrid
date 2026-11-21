import { CircleDollarSign, LockKeyhole, type LucideIcon } from "lucide-react";

import { DRIP_MINE_TEMPLATE_IDENTIFIER } from "../hub/run";
import { VOUCHER_TEMPLATE_IDENTIFIER } from "../voucher/core";

// Templates that run live on the Demo page. The Demo page lists them as big cards, and each template's page links to
// its demo. Add a template here once the Demo page can run it.

export interface LiveDemo {
  identifier: string;
  name: string;
  /** One or two plain sentences: what the person will see happen. */
  blurb: string;
  icon: LucideIcon;
}

export const LIVE_DEMOS: LiveDemo[] = [
  {
    identifier: VOUCHER_TEMPLATE_IDENTIFIER,
    name: "Claim-Code Voucher",
    blurb: "Lock some BCH behind a secret code. Share the code and whoever has it can claim the money.",
    icon: LockKeyhole,
  },
  {
    identifier: DRIP_MINE_TEMPLATE_IDENTIFIER,
    name: "Drip Mine",
    blurb: "A shared pot of coins that slowly pays out to miners. Trigger a payout and watch it happen.",
    icon: CircleDollarSign,
  },
];

/** The live demo for this template, or null when it has none. */
export function liveDemo(identifier: string): LiveDemo | null {
  return LIVE_DEMOS.find((demo) => demo.identifier === identifier) ?? null;
}

/** The Demo page, opened on this template. */
export function demoLink(identifier: string): string {
  return `/demo?template=${encodeURIComponent(identifier)}`;
}
