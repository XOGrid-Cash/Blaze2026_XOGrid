/**
 * A small, forgiving reader for CashAssembly, the script language in wallet templates. It is only for display: it
 * splits a script into tokens, lays them out as indented lines, and works out how many bytes the script compiles to.
 * Anything it cannot read is kept as plain text rather than thrown away.
 */

export type Token =
  | { kind: "op"; text: string }
  | { kind: "hex"; text: string }
  | { kind: "number"; text: string }
  | { kind: "string"; text: string }
  | { kind: "ref"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "push"; children: Token[] }
  | { kind: "eval"; children: Token[] };

const FLOW_OPEN = new Set(["OP_IF", "OP_NOTIF"]);
const FLOW_MIDDLE = new Set(["OP_ELSE"]);
const FLOW_CLOSE = new Set(["OP_ENDIF"]);

export function isFlowControl(op: string): boolean {
  return FLOW_OPEN.has(op) || FLOW_MIDDLE.has(op) || FLOW_CLOSE.has(op);
}

/** Ops that end a "statement": a check that either passes or fails the spend. */
function endsStatement(op: string): boolean {
  return op.endsWith("VERIFY") || op === "OP_RETURN";
}

function classify(word: string): Token {
  if (/^OP_[A-Z0-9_]+$/i.test(word)) {
    return { kind: "op", text: word };
  }

  if (/^0x[0-9a-f]*$/i.test(word)) {
    return { kind: "hex", text: word };
  }

  if (/^-?\d+$/.test(word)) {
    return { kind: "number", text: word };
  }

  return { kind: "ref", text: word };
}

export function tokenize(source: string): Token[] {
  let index = 0;

  function readUntil(close: string | null): Token[] {
    const tokens: Token[] = [];

    while (index < source.length) {
      const char = source[index];

      if (/\s/.test(char)) {
        index += 1;
      } else if (close && char === close) {
        index += 1;
        return tokens;
      } else if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index);
        const stop = end === -1 ? source.length : end;
        tokens.push({ kind: "comment", text: source.slice(index, stop).trim() });
        index = stop;
      } else if (source.startsWith("/*", index)) {
        const end = source.indexOf("*/", index + 2);
        const stop = end === -1 ? source.length : end + 2;
        tokens.push({ kind: "comment", text: source.slice(index, stop).replace(/\s+/g, " ") });
        index = stop;
      } else if (char === "<") {
        index += 1;
        tokens.push({ kind: "push", children: readUntil(">") });
      } else if (source.startsWith("$(", index)) {
        index += 2;
        tokens.push({ kind: "eval", children: readUntil(")") });
      } else if (char === "'" || char === '"') {
        const end = source.indexOf(char, index + 1);
        const stop = end === -1 ? source.length : end + 1;
        tokens.push({ kind: "string", text: source.slice(index, stop) });
        index = stop;
      } else {
        const match = /^[^\s<>()$'"]+/.exec(source.slice(index));
        const word = match ? match[0] : char;
        tokens.push(classify(word));
        index += word.length;
      }
    }

    return tokens;
  }

  return readUntil(null);
}

export interface Line {
  indent: number;
  tokens: Token[];
}

/** Lays tokens out one statement per line, indenting the branches of OP_IF / OP_NOTIF. */
export function layout(tokens: Token[]): Line[] {
  const lines: Line[] = [];
  let indent = 0;
  let current: Token[] = [];

  const flush = () => {
    if (current.length > 0) {
      lines.push({ indent, tokens: current });
      current = [];
    }
  };

  for (const token of tokens) {
    if (token.kind === "comment") {
      flush();
      lines.push({ indent, tokens: [token] });
    } else if (token.kind === "op" && FLOW_OPEN.has(token.text)) {
      current.push(token);
      flush();
      indent += 1;
    } else if (token.kind === "op" && FLOW_MIDDLE.has(token.text)) {
      flush();
      lines.push({ indent: Math.max(0, indent - 1), tokens: [token] });
    } else if (token.kind === "op" && FLOW_CLOSE.has(token.text)) {
      flush();
      indent = Math.max(0, indent - 1);
      lines.push({ indent, tokens: [token] });
    } else {
      current.push(token);

      if (token.kind === "op" && endsStatement(token.text)) {
        flush();
      }
    }
  }

  flush();
  return lines;
}

/** The fixed bytes a script compiles to, and the names whose size is only known once values are filled in. */
export interface Size {
  bytes: number;
  unknown: string[];
}

function pushPrefix(length: number): number {
  if (length <= 75) return 1;
  if (length <= 0xff) return 2;
  if (length <= 0xffff) return 3;
  return 5;
}

/** Bytes in a minimally encoded VM number. */
function numberBytes(text: string): number[] | null {
  let value: bigint;

  try {
    value = BigInt(text);
  } catch {
    return null;
  }

  if (value === 0n) return [];

  const negative = value < 0n;
  let magnitude = negative ? -value : value;
  const bytes: number[] = [];

  while (magnitude > 0n) {
    bytes.push(Number(magnitude & 0xffn));
    magnitude >>= 8n;
  }

  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(negative ? 0x80 : 0);
  } else if (negative) {
    bytes[bytes.length - 1] |= 0x80;
  }

  return bytes;
}

function hexBytes(text: string): number[] | null {
  const hex = text.slice(2);

  if (hex.length % 2 !== 0) return null;

  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

/** Size of pushing these exact bytes, using the shortest push the VM allows. */
function pushOfBytes(bytes: number[]): number {
  if (bytes.length === 0) return 1; // OP_0
  if (bytes.length === 1 && ((bytes[0] >= 1 && bytes[0] <= 16) || bytes[0] === 0x81)) return 1; // OP_1..OP_16, OP_1NEGATE
  return pushPrefix(bytes.length) + bytes.length;
}

/**
 * Works out the compiled size. References to other scripts in the same template are followed; variables and
 * $(…) calculations are listed as unknown because their size depends on the values used.
 */
export function measure(tokens: Token[], scripts: Record<string, string>, seen: Set<string> = new Set()): Size {
  let bytes = 0;
  const unknown: string[] = [];

  const addRef = (name: string, pushed: boolean) => {
    const body = scripts[name];

    if (body === undefined || seen.has(name)) {
      unknown.push(name);
      return;
    }

    const inner = measure(tokenize(body), scripts, new Set([...seen, name]));
    unknown.push(...inner.unknown);

    if (inner.unknown.length === 0 || !pushed) {
      bytes += pushed ? pushPrefix(inner.bytes) + inner.bytes : inner.bytes;
    } else {
      bytes += inner.bytes;
    }
  };

  for (const token of tokens) {
    switch (token.kind) {
      case "op":
        bytes += 1;
        break;
      case "hex":
        bytes += hexBytes(token.text)?.length ?? 0;
        break;
      case "number":
        bytes += numberBytes(token.text)?.length ?? 0;
        break;
      case "string":
        bytes += new TextEncoder().encode(token.text.slice(1, -1)).length;
        break;
      case "ref":
        addRef(token.text, false);
        break;
      case "comment":
        break;
      case "eval":
        unknown.push("$(…)");
        break;
      case "push": {
        const [only] = token.children;

        if (token.children.length === 1 && only.kind === "number") {
          bytes += pushOfBytes(numberBytes(only.text) ?? []);
        } else if (token.children.length === 1 && only.kind === "hex") {
          bytes += pushOfBytes(hexBytes(only.text) ?? []);
        } else if (token.children.length === 1 && only.kind === "string") {
          bytes += pushOfBytes([...new TextEncoder().encode(only.text.slice(1, -1))]);
        } else if (token.children.length === 1 && only.kind === "ref") {
          addRef(only.text, true);
        } else {
          const inner = measure(token.children, scripts, seen);
          unknown.push(...inner.unknown);
          bytes += inner.unknown.length === 0 ? pushPrefix(inner.bytes) + inner.bytes : inner.bytes;
        }
        break;
      }
    }
  }

  return { bytes, unknown };
}
