import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  FileJson,
  Fingerprint,
  Layers3,
  Loader2,
  ShieldAlert,
  UploadCloud,
  X,
  AlertCircle,
  Sparkles,
  Code2,
  FileCheck2,
  Zap,
  RotateCcw,
} from "lucide-react";

import { CategoryPicker } from "../components/hub/CategoryPicker";
import { publishTemplate } from "../hub/api";
import { useWallet } from "../hub/WalletContext";

const MAX_FILE_SIZE = 256 * 1024;

interface PublishResult {
  identifier: string;
  created: boolean;
  badge: string;
}

const publishingSteps = [
  {
    number: "01",
    title: "Validate your JSON",
    description: "Check the structure and confirm your template is valid.",
    icon: FileCheck2,
  },
  {
    number: "02",
    title: "Generate an identity",
    description: "Create a content-based identifier for your template.",
    icon: Fingerprint,
  },
  {
    number: "03",
    title: "Register on XOGrid",
    description: "Submit your template to the registry.",
    icon: Layers3,
  },
];

function Publish() {
  const { address } = useWallet();
  const [jsonText, setJsonText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<PublishResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [jsonValid, setJsonValid] = useState<boolean>(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [publisherName, setPublisherName] = useState<string>("");

  const [dragging, setDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Counts drag enters and leaves, because moving over a child element fires "leave" on the zone itself.
  const dragDepth = useRef(0);

  const byteSize = new TextEncoder().encode(jsonText).length;

  const sizePercentage = Math.min(
    (byteSize / MAX_FILE_SIZE) * 100,
    100
  );

  const clearMessages = () => {
    setError("");
    setResult(null);
    setCopied(false);
  };

  const validateJSON = (value: string) => {
    if (!value.trim()) {
      setJsonValid(false);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(value);

      setJsonValid(
        parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
      );
    } catch {
      setJsonValid(false);
    }
  };

  const handleTextChange = (
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    const value = event.target.value;

    setJsonText(value);
    setFileName("");
    clearMessages();
    validateJSON(value);
  };

  // One path for a picked file and a dropped file, so both get exactly the same checks.
  const loadFile = async (file: File): Promise<void> => {
    clearMessages();

    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Please select a valid JSON file.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("This file exceeds the 256 KB upload limit.");
      return;
    }

    try {
      const text = await file.text();

      setJsonText(text);
      setFileName(file.name);
      validateJSON(text);
    } catch {
      setError("We couldn't read this file. Please try another one.");
    }
  };

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (file) {
      await loadFile(file);
    }

    // Lets the same file be chosen again after it was removed or rejected.
    event.target.value = "";
  };

  const carriesFiles = (event: { dataTransfer: DataTransfer | null }) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const handleDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    if (!carriesFiles(event)) return;

    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (!carriesFiles(event)) return;

    // Without this the browser refuses the drop.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (!carriesFiles(event)) return;

    dragDepth.current = Math.max(0, dragDepth.current - 1);

    if (dragDepth.current === 0) {
      setDragging(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    if (!carriesFiles(event)) return;

    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);

    const files = Array.from(event.dataTransfer.files);

    if (files.length === 0) return;

    if (files.length > 1) {
      clearMessages();
      setError("Please drop one file at a time.");
      return;
    }

    await loadFile(files[0]);
  };

  // A file dropped outside the upload area would make the browser open it and leave this page, losing what was typed.
  // Refuse those drops, and show that only the upload area accepts a file.
  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;

      event.preventDefault();

      const inside = event.target instanceof Element && event.target.closest("[data-drop-zone]");

      if (event.type === "dragover" && event.dataTransfer && !inside) {
        event.dataTransfer.dropEffect = "none";
      }
    };

    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);

    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  const handleRemoveFile = () => {
    setJsonText("");
    setFileName("");
    setJsonValid(false);
    clearMessages();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFormatJSON = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      const formatted = JSON.stringify(parsed, null, 2);

      setJsonText(formatted);

      setJsonValid(
        parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
      );

      clearMessages();
    } catch {
      setError(
        "The JSON cannot be formatted because its syntax is invalid."
      );
    }
  };

  const handleClearEditor = () => {
    setJsonText("");
    setFileName("");
    setJsonValid(false);
    clearMessages();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePublish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearMessages();

    if (!jsonText.trim()) {
      setError("Add your template JSON before publishing.");
      return;
    }

    if (byteSize > MAX_FILE_SIZE) {
      setError("Your template exceeds the 256 KB size limit.");
      return;
    }

    let parsedTemplate: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(jsonText);

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        setJsonValid(false);
        setError("Your template must be a valid JSON object.");
        return;
      }

      parsedTemplate = parsed as Record<string, unknown>;
    } catch {
      setJsonValid(false);
      setError("Invalid JSON. Check your syntax and try again.");
      return;
    }

    setJsonValid(true);
    setLoading(true);

    try {
      // The API returns PublishResponse directly.
      // It does not return a { data, status } wrapper.
      const response = await publishTemplate(parsedTemplate, address || undefined, categories, publisherName.trim() || undefined);

      if (!response.identifier) {
        throw new Error(
          "The server did not return a valid template identifier."
        );
      }

      if (typeof response.created !== "boolean") {
        throw new Error(
          "The server response is missing the template creation status."
        );
      }

      setResult({
        identifier: response.identifier,
        created: response.created,
        badge: response.badge || "unchecked",
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Something went wrong while publishing. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.identifier) return;

    try {
      await navigator.clipboard.writeText(result.identifier);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Unable to copy the identifier. Please copy it manually."
      );
    }
  };

  const detailUrl = result
    ? `/t/${encodeURIComponent(result.identifier)}`
    : "";

  return (
    <main className="publish-page relative min-h-screen overflow-hidden bg-[#05070b] px-4 pb-20 pt-28 text-white sm:px-6 2xl:px-10 2xl:pb-28 2xl:pt-32">
      {/* BACKGROUND */}
      <div className="publish-background pointer-events-none absolute inset-0 overflow-hidden">
        <div className="publish-glow publish-glow-one absolute -left-48 -top-40 h-[550px] w-[550px] rounded-full bg-violet-600/[0.15] blur-[150px]" />

        <div className="publish-glow publish-glow-two absolute -right-48 top-[420px] h-[500px] w-[500px] rounded-full bg-orange-500/[0.08] blur-[150px]" />

        <div className="absolute -bottom-72 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-violet-600/[0.07] blur-[160px]" />

        <div className="publish-grid absolute inset-0 opacity-[0.035]" />

        <div className="absolute left-1/2 top-24 h-px w-[75%] -translate-x-1/2 bg-gradient-to-r from-transparent via-violet-400/25 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl 2xl:max-w-[1600px]">
        {/* BACK NAVIGATION */}
        <div className="publish-entrance mb-12 2xl:mb-16">
          <Link
            to="/"
            className="group inline-flex items-center gap-2 text-sm font-medium text-white/45 transition-colors duration-300 hover:text-orange-400"
          >
            <ArrowLeft
              size={17}
              className="transition-transform duration-300 group-hover:-translate-x-1"
            />
            Back to home
          </Link>
        </div>

        {/* HERO */}
        <section className="publish-entrance relative mb-12 2xl:mb-16">
          <div className="absolute -left-12 -top-16 h-44 w-44 rounded-full bg-violet-500/[0.10] blur-[70px]" />

          <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end 2xl:gap-16">
            <div className="max-w-2xl 2xl:max-w-4xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-4 py-2 text-xs font-semibold text-violet-300">
                <Sparkles size={14} />
                XOGrid Registry
                <span className="h-1 w-1 rounded-full bg-orange-400" />
                Open publishing
              </div>

              <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl 2xl:text-7xl">
                Bring your
                <br />
                <span className="publish-gradient-text">
                  template to life.
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-sm leading-7 text-white/45 sm:text-base 2xl:max-w-3xl 2xl:text-lg 2xl:leading-8">
                Publish your XO wallet template to the registry. Give it a
                unique identity and make its available checks and community
                feedback easier to discover.
              </p>
            </div>

            <div className="publish-hero-card relative hidden min-w-[210px] overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.025] p-5 lg:block 2xl:min-w-[260px] 2xl:p-7">
              <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-500/10 blur-2xl" />

              <div className="relative">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-400/[0.08] text-orange-300">
                  <Fingerprint size={20} />
                </div>

                <p className="text-xs text-white/35">Registry identity</p>
                <p className="mt-1 text-lg font-bold">Unique by design.</p>

                <div className="mt-4 flex items-center gap-2 text-[11px] text-emerald-300/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Content-addressed
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 2xl:mt-10 2xl:gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-xs text-white/50">
              <Fingerprint size={14} className="text-violet-300" />
              Content-addressed ID
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-xs text-white/50">
              <ShieldAlert size={14} className="text-orange-300" />
              Transparent checks
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-xs text-white/50">
              <Code2 size={14} className="text-emerald-300" />
              JSON templates
            </div>
          </div>
        </section>

        {/* SUCCESS STATE */}
        {result ? (
          <section className="publish-card overflow-hidden rounded-3xl border border-emerald-400/20 bg-[#0a0e12]/90 shadow-[0_25px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
            <div className="border-b border-white/[0.07] p-6 sm:p-9 2xl:p-12">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300">
                <CheckCircle2 size={30} />
              </div>

              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                {result.created
                  ? "Publication successful"
                  : "Existing registry entry"}
              </p>

              <h2 className="mt-3 text-2xl font-bold sm:text-3xl 2xl:text-4xl">
                {result.created
                  ? "Your template is registered."
                  : "This template already exists."}
              </h2>

              <p className="mt-3 max-w-xl text-sm leading-7 text-white/45 2xl:text-base">
                {result.created
                  ? "The registry accepted your template and returned its unique identifier."
                  : "XOGrid found an existing entry for this template. Its identifier is available below."}
              </p>
            </div>

            <div className="p-6 sm:p-9 2xl:p-12">
              <label className="text-xs font-semibold uppercase tracking-wider text-white/35">
                Server-generated template identifier
              </label>

              <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-white/[0.09] bg-black/30 p-4 sm:flex-row sm:items-center 2xl:p-6">
                <code className="min-w-0 flex-1 break-all text-sm leading-6 text-violet-300">
                  {result.identifier}
                </code>

                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold transition duration-300 hover:border-orange-400/40 hover:bg-orange-400/10 hover:text-orange-300"
                >
                  {copied ? <Check size={16} /> : <Clipboard size={16} />}
                  {copied ? "Copied" : "Copy ID"}
                </button>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to={detailUrl}
                  className="group inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-black transition duration-300 hover:-translate-y-0.5 hover:bg-orange-400"
                >
                  View template
                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </Link>

                <button
                  type="button"
                  onClick={handleClearEditor}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white/65 transition duration-300 hover:border-violet-400/30 hover:bg-violet-400/[0.07] hover:text-white"
                >
                  <RotateCcw size={15} />
                  Publish another
                </button>
              </div>

              <div className="mt-8 flex gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.045] p-4 2xl:p-5">
                <ShieldAlert
                  size={19}
                  className="mt-0.5 shrink-0 text-amber-300"
                />
                <p className="text-xs leading-6 text-white/45">
                  Registration does not mean a template is safe or
                  independently verified. Review its audit results, flags,
                  and community feedback before relying on it.
                </p>
              </div>
            </div>
          </section>
        ) : (
          <form
            onSubmit={handlePublish}
            className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8"
          >
            {/* EDITOR PANEL */}
            <section className="publish-card min-w-0 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#0a0d13]/85 shadow-[0_25px_100px_rgba(0,0,0,0.25)] backdrop-blur-xl">
              {/* PANEL HEADER */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-7 2xl:px-10 2xl:py-7">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300">
                    <FileJson size={21} />
                  </div>

                  <div>
                    <h2 className="font-bold">Template editor</h2>
                    <p className="mt-1 text-xs text-white/35">
                      Upload or paste your JSON file
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      jsonValid ? "bg-emerald-400" : "bg-white/25"
                    }`}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                    {jsonValid ? "Valid JSON" : "Awaiting JSON"}
                  </span>
                </div>
              </div>

              <div className="p-5 sm:p-7 2xl:p-10">
                {/* UPLOAD AREA */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="peer sr-only"
                  id="template-json-file"
                />

                <label
                  htmlFor="template-json-file"
                  data-drop-zone
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`publish-upload group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed px-5 py-9 text-center transition-all duration-300 peer-focus-visible:border-orange-400/70 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400/40 sm:py-11 2xl:py-14 ${
                    dragging
                      ? "border-orange-400/70 bg-orange-400/[0.09]"
                      : "border-violet-400/25 bg-violet-400/[0.035] hover:border-orange-400/45 hover:bg-orange-400/[0.035]"
                  }`}
                >
                  <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-violet-500/[0.08] blur-3xl transition duration-500 group-hover:bg-orange-500/[0.10]" />

                  <span className="publish-upload-icon relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10 text-violet-300 transition-all duration-300 group-hover:scale-110 group-hover:border-orange-400/30 group-hover:bg-orange-400/10 group-hover:text-orange-300">
                    <UploadCloud size={25} />
                  </span>

                  <span className="relative text-sm font-semibold text-white/80 transition-colors group-hover:text-orange-300">
                    {dragging ? "Release to load this file" : "Drop your JSON file here or browse"}
                  </span>

                  <span className="relative mt-2 text-xs text-white/35">
                    JSON format only · Maximum file size 256 KB
                  </span>
                </label>

                {/* SELECTED FILE */}
                {fileName && (
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-violet-400/15 bg-violet-400/[0.04] p-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300">
                      <FileJson size={18} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white/80">
                        {fileName}
                      </p>
                      <p className="mt-1 text-[10px] text-white/35">
                        {byteSize.toLocaleString()} bytes
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      aria-label="Remove selected file"
                      className="rounded-lg p-2 text-white/40 transition hover:bg-white/10 hover:text-orange-400"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {/* EDITOR TOOLBAR */}
                <div className="mb-3 mt-7 flex flex-wrap items-center justify-between gap-3 2xl:mb-4 2xl:mt-9">
                  <label
                    htmlFor="template-json"
                    className="flex items-center gap-2 text-xs font-semibold text-white/65"
                  >
                    <Code2 size={15} className="text-violet-300" />
                    JSON source
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleFormatJSON}
                      disabled={!jsonText.trim()}
                      className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] font-medium text-white/45 transition hover:border-violet-400/30 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Format JSON
                    </button>

                    <button
                      type="button"
                      onClick={handleClearEditor}
                      disabled={!jsonText}
                      className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] font-medium text-white/45 transition hover:border-red-400/30 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* EDITOR */}
                <div className="publish-editor relative overflow-hidden rounded-2xl border border-white/[0.09] bg-[#07090e] transition duration-300 focus-within:border-violet-400/35 focus-within:shadow-[0_0_35px_rgba(139,92,246,0.07)]">
                  <div className="flex h-11 items-center justify-between border-b border-white/[0.06] px-4">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-400/70" />
                      <span className="h-2 w-2 rounded-full bg-amber-400/70" />
                      <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
                    </div>

                    <span className="text-[10px] font-medium tracking-wider text-white/25">
                      TEMPLATE.JSON
                    </span>
                  </div>

                  <textarea
                    id="template-json"
                    value={jsonText}
                    onChange={handleTextChange}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder={`{
  "name": "My XO Template",
  "description": "Describe your template",
  "version": "1.0.0"
}`}
                    className="min-h-[350px] w-full resize-y bg-transparent p-5 font-mono text-xs leading-7 text-violet-200 outline-none placeholder:text-white/20 sm:text-sm 2xl:min-h-[460px] 2xl:p-7 2xl:text-base 2xl:leading-8"
                  />
                </div>

                {/* SIZE METER */}
                <div className="mt-4 2xl:mt-5">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-white/35">Template size</span>

                    <span
                      className={`tabular-nums ${
                        byteSize > MAX_FILE_SIZE
                          ? "text-red-300"
                          : "text-white/45"
                      }`}
                    >
                      {byteSize.toLocaleString()} /{" "}
                      {MAX_FILE_SIZE.toLocaleString()} bytes
                    </span>
                  </div>

                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className={`publish-size-bar h-full rounded-full transition-all duration-300 ${
                        byteSize > MAX_FILE_SIZE
                          ? "bg-red-400"
                          : "bg-gradient-to-r from-violet-500 to-orange-400"
                      }`}
                      style={{ width: `${sizePercentage}%` }}
                    />
                  </div>
                </div>

                <div className="mt-6">
                  <label htmlFor="publisher-name" className="text-sm font-medium text-white/80">
                    Your name (optional)
                  </label>
                  <p className="mt-1 text-xs leading-5 text-white/35">
                    Shown as the publisher of this template. Leave it empty to show your wallet address. If this template is already published, its publisher name is not changed.
                  </p>
                  <input
                    id="publisher-name"
                    type="text"
                    value={publisherName}
                    maxLength={40}
                    disabled={loading}
                    autoComplete="off"
                    placeholder="For example: Ada Lovelace"
                    onChange={(event) => setPublisherName(event.target.value)}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-orange-400/50 disabled:opacity-40"
                  />
                </div>
                <CategoryPicker selected={categories} onChange={setCategories} disabled={loading} />

                {/* VALIDATION ERROR */}
                {error && (
                  <div
                    role="alert"
                    className="publish-error mt-5 flex gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-300"
                  >
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <span className="leading-6">{error}</span>
                  </div>
                )}

                {/* SUBMIT */}
                <button
                  type="submit"
                  disabled={
                    loading ||
                    !jsonText.trim() ||
                    byteSize > MAX_FILE_SIZE
                  }
                  className="publish-submit group relative mt-7 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-orange-500 px-6 py-4 text-sm font-bold text-black shadow-[0_8px_35px_rgba(249,115,22,0.13)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-orange-400 hover:shadow-[0_12px_40px_rgba(249,115,22,0.22)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 2xl:mt-9 2xl:py-5 2xl:text-base"
                >
                  <span className="publish-button-shine absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                  <span className="relative flex items-center gap-2">
                    {loading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Publishing template...
                      </>
                    ) : (
                      <>
                        Publish to XOGrid
                        <ArrowRight
                          size={17}
                          className="transition-transform duration-300 group-hover:translate-x-1"
                        />
                      </>
                    )}
                  </span>
                </button>

                <p className="mt-4 text-center text-[11px] leading-5 text-white/30">
                  Never share private keys or wallet recovery phrases in a
                  template.
                </p>
              </div>
            </section>

            {/* RIGHT SIDEBAR */}
            <aside className="space-y-5 2xl:space-y-7">
              {/* PUBLISHING STEPS */}
              <section className="publish-card relative overflow-hidden rounded-3xl border border-white/[0.09] bg-[#0a0d13]/85 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.2)] backdrop-blur-xl sm:p-6 2xl:p-8">
                <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-violet-500/[0.08] blur-3xl" />

                <div className="relative">
                  <div className="mb-8 flex items-center gap-3 2xl:mb-10">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/10 text-violet-300">
                      <Zap size={20} />
                    </div>

                    <div>
                      <h3 className="font-bold">Publishing process</h3>
                      <p className="mt-1 text-xs text-white/35">
                        From JSON to registry
                      </p>
                    </div>
                  </div>

                  <div className="relative ml-3">
                    <div className="absolute bottom-8 left-[10px] top-8 w-px bg-gradient-to-b from-violet-400/50 via-white/10 to-orange-400/30" />

                    <div className="space-y-8 2xl:space-y-10">
                      {publishingSteps.map((step, index) => {
                        const StepIcon = step.icon;

                        return (
                          <div
                            key={step.number}
                            className="publish-step group relative flex gap-4 2xl:gap-5"
                            style={{
                              animationDelay: `${index * 120}ms`,
                            }}
                          >
                            <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-[#100e1b] text-violet-300 transition-all duration-300 group-hover:scale-110 group-hover:border-orange-400/60 group-hover:bg-orange-400/10 group-hover:text-orange-300">
                              <StepIcon size={13} />
                            </div>

                            <div className="min-w-0 flex-1 pb-1">
                              <div className="mb-2 flex items-center gap-2">
                                <span className="text-[10px] font-bold tracking-[0.15em] text-orange-400">
                                  {step.number}
                                </span>
                                <span className="h-px w-5 bg-white/10 transition-colors group-hover:bg-orange-400/40" />
                              </div>

                              <h4 className="text-sm font-semibold text-white/85 transition-colors group-hover:text-orange-300">
                                {step.title}
                              </h4>

                              <p className="mt-2 text-xs leading-6 text-white/40">
                                {step.description}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              {/* IDENTITY CARD */}
              <section className="publish-info-card group relative overflow-hidden rounded-3xl border border-violet-400/15 bg-violet-400/[0.035] p-5 transition-all duration-300 hover:border-violet-400/30 sm:p-6 2xl:p-8">
                <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-violet-500/[0.09] blur-3xl transition duration-500 group-hover:bg-orange-500/[0.08]" />

                <div className="relative">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/10 text-violet-300 transition duration-300 group-hover:rotate-6 group-hover:text-orange-300">
                    <Fingerprint size={20} />
                  </div>

                  <h3 className="text-sm font-bold">
                    One template. One identity.
                  </h3>

                  <p className="mt-3 text-xs leading-6 text-white/45">
                    XOGrid uses the canonical template content to generate a
                    content-addressed identifier. Changes to the content
                    produce a different identity.
                  </p>
                </div>
              </section>

              {/* IMPORTANT NOTICE */}
              <section className="relative overflow-hidden rounded-3xl border border-amber-400/15 bg-amber-400/[0.035] p-5 sm:p-6 2xl:p-8">
                <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-amber-400/[0.07] blur-3xl" />

                <div className="relative">
                  <div className="flex items-center gap-2 text-amber-300">
                    <ShieldAlert size={17} />
                    <h3 className="text-sm font-bold">A note on trust</h3>
                  </div>

                  <p className="mt-3 text-xs leading-6 text-white/45">
                    Publishing does not certify a template as safe. Automated
                    checks and community reviews are separate registry
                    features. Always inspect the available information before
                    using a template.
                  </p>
                </div>
              </section>

              {/* HELP LINK */}
              <Link
                to="/policy"
                className="group flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-all duration-300 hover:border-violet-400/20 hover:bg-violet-400/[0.04] 2xl:p-5"
              >
                <div>
                  <p className="text-xs font-semibold text-white/70">
                    Need help publishing?
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">
                    Read the XOGrid trust and policy guide.
                  </p>
                </div>

                <ArrowRight
                  size={17}
                  className="text-white/35 transition-all duration-300 group-hover:translate-x-1 group-hover:text-orange-300"
                />
              </Link>
            </aside>
          </form>
        )}
      </div>

      {/* ANIMATIONS */}
      <style>{`
        .publish-page {
          isolation: isolate;
        }

        .publish-grid {
          background-image:
            linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: linear-gradient(to bottom, black, transparent 85%);
          -webkit-mask-image: linear-gradient(to bottom, black, transparent 85%);
        }

        .publish-glow {
          will-change: transform;
        }

        .publish-glow-one {
          animation: publishGlowOne 18s ease-in-out infinite alternate;
        }

        .publish-glow-two {
          animation: publishGlowTwo 22s ease-in-out infinite alternate;
        }

        .publish-gradient-text {
          background: linear-gradient(
            100deg,
            #fb923c 0%,
            #f97316 45%,
            #fcd34d 100%
          );
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
          background-size: 200% auto;
          animation: gradientShift 6s ease-in-out infinite alternate;
        }

        .publish-entrance {
          animation: publishFadeUp 0.75s cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }

        .publish-card {
          animation: publishFadeUp 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }

        .publish-card:nth-of-type(2) {
          animation-delay: 0.12s;
        }

        .publish-hero-card {
          animation: publishFloat 5s ease-in-out infinite;
        }

        .publish-step {
          animation: publishFadeUp 0.65s ease-out both;
        }

        .publish-upload-icon {
          animation: uploadFloat 3.5s ease-in-out infinite;
        }

        .publish-submit:not(:disabled):hover .publish-button-shine {
          animation: buttonShine 0.8s ease;
        }

        .publish-info-card:hover {
          transform: translateY(-3px);
        }

        .publish-size-bar {
          transition: width 0.3s ease, background-color 0.3s ease;
        }

        .publish-error {
          animation: publishShake 0.35s ease-out;
        }

        @keyframes publishFadeUp {
          from {
            opacity: 0;
            transform: translateY(22px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes publishGlowOne {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(35px, 28px, 0);
          }
        }

        @keyframes publishGlowTwo {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-35px, 30px, 0);
          }
        }

        @keyframes publishFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-9px);
          }
        }

        @keyframes uploadFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }

        @keyframes gradientShift {
          from {
            background-position: 0% center;
          }
          to {
            background-position: 100% center;
          }
        }

        @keyframes buttonShine {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(100%);
          }
        }

        @keyframes publishShake {
          0%, 100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-3px);
          }
          75% {
            transform: translateX(3px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .publish-page *,
          .publish-page *::before,
          .publish-page *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </main>
  );
}

export default Publish;