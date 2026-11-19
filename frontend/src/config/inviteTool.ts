// The invitation tool (templates/web, deployed separately) can build a ready XO invitation for some templates.
// The registry's template page links to it. Override the address at build time with VITE_INVITE_TOOL_URL.

const DEFAULT_INVITE_TOOL_URL = "https://xogrid-invite.vercel.app";

const configured = (import.meta.env.VITE_INVITE_TOOL_URL as string | undefined)?.trim();

export const INVITE_TOOL_URL = (configured || DEFAULT_INVITE_TOOL_URL).replace(/\/+$/, "");

/** Template identifier to the tool's page for it (the tool picks a template by its URL hash). */
const TOOL_PAGES: Record<string, { page: string; what: string }> = {
  "346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185": { page: "drip-mine", what: "drip a Drip Mine coin" },
  "1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0": { page: "token-burner", what: "burn coins at the TokenBurner address" },
  "991a7bbd2337748e5537850eef69fe34b88b5ad29b3d8de26a1156df2b4c66e7": { page: "badgers-stake", what: "release a finished stake" },
};

/** Where to build an invitation for this template, or null when the tool has no page for it. */
export function inviteToolLink(identifier: string): { href: string; what: string } | null {
  const entry = TOOL_PAGES[identifier];

  return entry ? { href: `${INVITE_TOOL_URL}/#${entry.page}`, what: entry.what } : null;
}
