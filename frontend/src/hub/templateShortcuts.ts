import { useEffect, useState } from "react";

import { cameFromJump, jumpTo, type RefKind } from "./templateRefs";

// Keyboard shortcuts on a template's page. Every key is a single key with no Ctrl, Cmd or Alt, and none fire while
// the reader is typing in a field. Single-letter keys can clash with screen readers and voice control, so they can be
// turned off; "/" and "?" always work, so search and this help stay reachable.

/** The sections of Template contents in order, which is also their number key. */
export const SECTION_KINDS: RefKind[] = ["action", "transaction", "lockingScript", "script", "constant", "variable"];

export const SECTION_TITLE: Record<RefKind, string> = {
  action: "Actions",
  transaction: "Transactions",
  lockingScript: "Locking scripts",
  script: "Scripts",
  constant: "Constants",
  variable: "Variables",
};

export function sectionId(kind: RefKind): string {
  return `section-${kind}`;
}

export interface Shortcut {
  keys: string[];
  label: string;
  /** False for keys that keep working when single-key shortcuts are off. */
  optional: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ["/"], label: "Search this template", optional: false },
  { keys: ["?"], label: "Show or hide these shortcuts", optional: false },
  { keys: ["e"], label: "Expand all sections", optional: true },
  { keys: ["c"], label: "Collapse all sections", optional: true },
  { keys: ["1", "–", "6"], label: "Go to a section", optional: true },
  { keys: ["b"], label: "Back to where you were before the last jump", optional: true },
  { keys: ["Esc"], label: "Close this help, or clear the search", optional: false },
];

/** Sent to the search box to focus it. */
export const FOCUS_SEARCH_EVENT = "xogrid:focus-search";

const STORAGE_KEY = "xogrid.singleKeyShortcuts";

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be blocked; the setting then lasts until the page is left.
  }
}

function isTyping(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function setAllSections(root: string, open: boolean) {
  document.querySelectorAll<HTMLDetailsElement>(`${root} details`).forEach((section) => {
    section.open = open;
  });
}

export const CONTENTS_ROOT = "[data-template-contents]";

/**
 * Listens for the shortcuts while a template's contents are on screen. `sections` are the kinds this template has,
 * so a number key for a missing section does nothing.
 */
export function useTemplateShortcuts({ sections, helpOpen, setHelpOpen }: {
  sections: RefKind[];
  helpOpen: boolean;
  setHelpOpen: (open: boolean | ((open: boolean) => boolean)) => void;
}): { enabled: boolean; setEnabled: (enabled: boolean) => void } {
  const [enabled, setEnabledState] = useState(readEnabled);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;

      if (event.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }

      if (isTyping(document.activeElement)) return;

      const handled = (() => {
        if (event.key === "?") {
          setHelpOpen((open) => !open);
          return true;
        }
        if (event.key === "/") {
          setHelpOpen(false);
          window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
          return true;
        }
        if (!enabled) return false;

        const key = event.key.toLowerCase();
        if (key === "e" || key === "c") {
          setAllSections(CONTENTS_ROOT, key === "e");
          return true;
        }
        if (key === "b") {
          if (cameFromJump()) window.history.back();
          return true;
        }
        const number = Number(event.key);
        if (Number.isInteger(number) && number >= 1 && number <= SECTION_KINDS.length) {
          const kind = SECTION_KINDS[number - 1];
          if (sections.includes(kind)) jumpTo(sectionId(kind), null);
          return true;
        }
        return false;
      })();

      if (handled) event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, helpOpen, sections, setHelpOpen]);

  return {
    enabled,
    setEnabled: (value) => {
      setEnabledState(value);
      writeEnabled(value);
    },
  };
}

