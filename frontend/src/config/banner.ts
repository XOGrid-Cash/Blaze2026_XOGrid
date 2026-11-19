// Values for the required top-of-page banner (BCH BLAZE 2026 eligibility).
//
// Each value can be overridden at build time with a VITE_* variable (Vercel project settings, or docker build args).
// The repo link and the EMBER2026 address have real defaults so a deploy without variables still shows them.
// The slides URL has no default: until VITE_SLIDES_URL is set, the banner shows "Slides: link coming soon".

const read = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

// EMBER2026 donations. Must be a token-aware CashTokens address (the part after the colon starts with "z").
export const DEFAULT_EMBER_ADDRESS = "bitcoincash:zqvx6mew37u62g3zvzfwn38y4vfce9dkug7jlkxatw";

export const DEFAULT_START_REPO_URL = "https://github.com/StrungSafe/Blaze2026";

export const DEFAULT_REPO_URL = "https://github.com/XOGrid-Cash/Blaze2026_XOGrid";

export const banner = {
  slidesUrl: read(import.meta.env.VITE_SLIDES_URL),
  startRepoUrl: read(import.meta.env.VITE_START_REPO_URL) || DEFAULT_START_REPO_URL,
  repoUrl: read(import.meta.env.VITE_REPO_URL) || DEFAULT_REPO_URL,
  emberAddress: read(import.meta.env.VITE_EMBER_ADDRESS) || DEFAULT_EMBER_ADDRESS,
};
