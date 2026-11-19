import { useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";

import { fetchRawTemplate } from "../../hub/api";
import { templateFileName } from "../../hub/templateView";

type Busy = "copy" | "download" | null;

/** Copy the template JSON to the clipboard, or save it as a file. Both use the exact published text. */
export function TemplateExport({ identifier, name }: { identifier: string; name: string }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function copy() {
    setBusy("copy");
    setNote(null);

    try {
      const raw = await fetchRawTemplate(identifier);

      await navigator.clipboard.writeText(raw);
      setNote({ ok: true, text: "Template JSON copied." });
    } catch (reason) {
      setNote({
        ok: false,
        text:
          reason instanceof DOMException
            ? "Your browser blocked copying. Use Download instead."
            : reason instanceof Error
              ? reason.message
              : "Could not copy the template.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    setNote(null);

    try {
      const raw = await fetchRawTemplate(identifier);
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      const link = document.createElement("a");

      link.href = url;
      link.download = templateFileName(name, identifier);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote({ ok: true, text: `Saved as ${link.download}.` });
    } catch (reason) {
      setNote({ ok: false, text: reason instanceof Error ? reason.message : "Could not download the template." });
    } finally {
      setBusy(null);
    }
  }

  const button =
    "inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white transition hover:border-orange-400/40 hover:text-orange-300 disabled:opacity-50";

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copy} disabled={busy !== null} className={button}>
          {busy === "copy" ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
          Copy Template
        </button>
        <button type="button" onClick={download} disabled={busy !== null} className={button}>
          {busy === "download" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Download Template
        </button>
      </div>
      {note && (
        <p className={`mt-3 flex items-center gap-2 text-xs ${note.ok ? "text-emerald-300" : "text-rose-300"}`} role="status">
          {note.ok && <Check size={14} />}
          {note.text}
        </p>
      )}
    </div>
  );
}
