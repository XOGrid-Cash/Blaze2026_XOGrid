/**
 * The opening of a description, for a short summary: whole sentences until there are about `min` characters, so a
 * terse first sentence ("An MEV faucet.") brings the next one along.
 */
export function shortSummary(text: string, min = 80): string {
  const sentences = text.trim().match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [text];
  let summary = "";

  for (const sentence of sentences) {
    summary += sentence;
    if (summary.trim().length >= min) {
      break;
    }
  }

  return summary.trim();
}

/** A long identifier shortened for display: the first 8 and last 6 characters. */
export const shortIdentifier = (identifier: string) =>
  identifier.length > 18 ? `${identifier.slice(0, 8)}…${identifier.slice(-6)}` : identifier;
