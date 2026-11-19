// Turns the parsed template JSON the registry returns into plain, display-ready data.
// A template is untrusted input from whoever published it, so every value is checked here:
// text is trimmed and length-limited, and a link is only kept when it is a plain https address.

export interface ResourceView {
  name: string;
  description: string;
  /** The link, only when it is a safe https address. Null otherwise. */
  url: string | null;
  /** What the person sees as the destination, for example "github.com". */
  host: string | null;
  /** The address as written, shown as plain text when it is not safe to link. */
  rawUrl: string | null;
}

export interface NamedItem {
  id: string;
  name: string;
  description: string;
}

export interface ActionView extends NamedItem {
  transaction: string | null;
  roles: { id: string; name: string; description: string; variables: string[] }[];
}

export interface TransactionView extends NamedItem {
  inputs: string[];
  outputs: string[];
}

export interface PartView extends NamedItem {
  detail: string | null;
}

export interface ScriptView {
  id: string;
  text: string;
  length: number;
}

export interface ValueView extends NamedItem {
  type: string | null;
  value: string | null;
}

export interface TemplateView {
  resources: ResourceView[];
  actions: ActionView[];
  transactions: TransactionView[];
  inputs: PartView[];
  outputs: PartView[];
  lockingScripts: PartView[];
  scripts: ScriptView[];
  constants: ValueView[];
  variables: ValueView[];
}

const MAX_RESOURCES = 20;
const MAX_NAME = 120;
const MAX_TEXT = 700;
const MAX_ITEMS = 200;

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

/** Shows XO's extended-JSON numbers ("<bigint: 5000n>") as plain numbers. */
export function plainValue(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const bigint = /^<bigint:\s*(-?\d+)n>$/.exec(value);

  return (bigint ? bigint[1] : value).slice(0, 300);
}

/** Returns the address only when it is a plain https link with no embedded login. The audit warns about anything else. */
export function safeExternalUrl(value: unknown): { url: string; host: string } | null {
  if (typeof value !== "string" || value.length > 2000) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());

    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }

    return { url: parsed.href, host: parsed.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/**
 * Templates write amounts as $(<fundSatoshis>) or $(<masterSatoshis> stakeFee OP_ADD). Show what is being filled in:
 * [the variable's name], or [calculated from: a, b] for a small calculation.
 */
export function readable(value: string, variables: Dict = {}): string {
  return value.replace(/\$\(([^)]*)\)/g, (_match, inner: string) => {
    const names = [...new Set((inner.match(/(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((token) => !token.startsWith("OP_")))].map((id) => {
      const variable = variables[id];

      return isDict(variable) && typeof variable.name === "string" ? variable.name.toLowerCase() : id;
    });

    if (names.length === 0) {
      return "[a value]";
    }

    return names.length === 1 ? `[${names[0]}]` : `[calculated from: ${names.join(", ")}]`;
  });
}

function entries(value: unknown): [string, Dict][] {
  if (!isDict(value)) {
    return [];
  }

  return Object.entries(value)
    .filter((entry): entry is [string, Dict] => isDict(entry[1]))
    .slice(0, MAX_ITEMS);
}

function named(id: string, item: Dict, variables: Dict = {}): NamedItem {
  return { id, name: text(item.name, MAX_NAME) || id, description: readable(text(item.description, MAX_TEXT), variables) };
}

function resourcesOf(value: unknown): ResourceView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isDict)
    .slice(0, MAX_RESOURCES)
    .map((item) => {
      const link = safeExternalUrl(item.url);
      const rawUrl = typeof item.url === "string" ? item.url.trim().slice(0, 300) : null;

      return {
        name: text(item.name, MAX_NAME) || link?.host || "Resource",
        description: text(item.description, MAX_TEXT),
        url: link?.url ?? null,
        host: link?.host ?? null,
        rawUrl: link ? null : rawUrl,
      };
    });
}

function actionsOf(value: unknown, variablesById: Dict): ActionView[] {
  return entries(value).map(([id, item]) => ({
    ...named(id, item, variablesById),
    transaction: text(item.transaction, MAX_NAME) || null,
    roles: entries(item.roles).map(([roleId, role]) => {
      const requirements = isDict(role.requirements) ? role.requirements : {};
      const variables = Array.isArray(requirements.variables)
        ? requirements.variables.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_ITEMS)
        : [];

      return {
        id: roleId,
        name: text(role.name, MAX_NAME) || roleId,
        description: readable(text(role.description, MAX_TEXT), variablesById),
        variables,
      };
    }),
  }));
}

function refsOf(value: unknown, key: "input" | "output"): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isDict)
    .map((item) => text(item[key], MAX_NAME))
    .filter((id) => id.length > 0)
    .slice(0, MAX_ITEMS);
}

function partsOf(value: unknown, variablesById: Dict, detailOf: (item: Dict) => string | null): PartView[] {
  return entries(value).map(([id, item]) => ({ ...named(id, item, variablesById), detail: detailOf(item) }));
}

function valuesOf(value: unknown, variablesById: Dict): ValueView[] {
  return entries(value).map(([id, item]) => ({
    ...named(id, item, variablesById),
    type: text(item.type, 60) || null,
    value: plainValue(item.value),
  }));
}

export function viewTemplate(template: unknown): TemplateView {
  const source = isDict(template) ? template : {};
  const variablesById = isDict(source.variables) ? source.variables : {};
  const scripts = isDict(source.scripts)
    ? Object.entries(source.scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .slice(0, MAX_ITEMS)
        .map(([id, body]) => ({ id, text: body, length: body.length }))
    : [];

  return {
    resources: resourcesOf(source.resources),
    actions: actionsOf(source.actions, variablesById),
    transactions: entries(source.transactions).map(([id, item]) => ({
      ...named(id, item, variablesById),
      inputs: refsOf(item.inputs, "input"),
      outputs: refsOf(item.outputs, "output"),
    })),
    inputs: partsOf(source.inputs, variablesById, (item) => {
      const script = text(item.unlockingScript, MAX_NAME);
      const satoshis = plainValue(item.valueSatoshis);

      return [satoshis ? `${satoshis} sats` : "", script ? `unlocks with ${script}` : ""].filter(Boolean).join(" · ") || null;
    }),
    outputs: partsOf(source.outputs, variablesById, (item) => {
      const script = text(item.lockingScript, MAX_NAME);
      const satoshis = plainValue(item.valueSatoshis);

      return [satoshis ? `${satoshis} sats` : "", script ? `locked by ${script}` : ""].filter(Boolean).join(" · ") || null;
    }),
    lockingScripts: partsOf(source.lockingScripts, variablesById, (item) => {
      const type = text(item.lockingType, 40);
      const bytecode = text(item.lockingBytecode, MAX_NAME);

      return [type, bytecode ? `script ${bytecode}` : ""].filter(Boolean).join(" · ") || null;
    }),
    scripts,
    constants: valuesOf(source.constants, variablesById),
    variables: valuesOf(source.variables, variablesById),
  };
}

/** A file name for a downloaded template, such as "drip-mine-346048b2.json". */
export function templateFileName(name: string, identifier: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "template";

  return `${slug}-${identifier.slice(0, 8)}.json`;
}
