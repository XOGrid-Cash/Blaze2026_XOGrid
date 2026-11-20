import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

/** The template page for an identifier. */
export const templatePath = (id: string) => `/t/${encodeURIComponent(id)}`;

/**
 * Makes a whole template card open the template. Pass the returned handler to the card's onClick and onAuxClick.
 *
 * Clicks on the card's own controls (links, buttons), on anything marked `data-card-ignore` (such as the identifier
 * box, so it can be selected and copied), or that finish a text selection are left alone. Ctrl/Cmd-click and
 * middle-click open the template in a new tab, like a normal link.
 */
export function useTemplateCardClick() {
  const navigate = useNavigate();

  return (event: MouseEvent<HTMLElement>, id: string) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, [data-card-ignore]")) return;
    if (window.getSelection()?.toString()) return;
    const path = templatePath(id);
    if (event.button === 1 || event.ctrlKey || event.metaKey) {
      window.open(path, "_blank", "noopener");
      return;
    }
    if (event.button === 0) navigate(path);
  };
}
