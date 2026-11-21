import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Simple or Technical: how much detail a page shows. Simple is the default for everyone. A person's choice is kept
// in this browser; `?view=technical` (or `?view=simple`) in a link wins, so a technical view can be shared.

export type ViewMode = "simple" | "technical";

const STORAGE_KEY = "xogrid.viewMode";

const isMode = (value: unknown): value is ViewMode => value === "simple" || value === "technical";

function stored(): ViewMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);

    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const fromLink = params.get("view");
  const [mode, setModeState] = useState<ViewMode>(() => (isMode(fromLink) ? fromLink : (stored() ?? "simple")));

  const setMode = useCallback(
    (next: ViewMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage blocked: the choice lasts for this visit only.
      }
      // Drop a ?view= from the link, so it does not override the choice just made on reload.
      if (params.has("view")) {
        const rest = new URLSearchParams(params);

        rest.delete("view");
        setParams(rest, { replace: true });
      }
    },
    [params, setParams],
  );

  return [mode, setMode];
}
