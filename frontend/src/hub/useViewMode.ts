import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Simple or Technical: how much detail a page shows. Every template opens in Simple, so a first-time visitor always
// gets the plain-English view. Switching to Technical lasts for that page only. `?view=technical` in a link opens the
// technical view, so one can be shared.

export type ViewMode = "simple" | "technical";

const isMode = (value: unknown): value is ViewMode => value === "simple" || value === "technical";

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const fromLink = params.get("view");
  const [mode, setModeState] = useState<ViewMode>(() => (isMode(fromLink) ? fromLink : "simple"));

  const setMode = useCallback(
    (next: ViewMode) => {
      setModeState(next);
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
