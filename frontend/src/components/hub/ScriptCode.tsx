import { Fragment, type ReactNode } from "react";

import { isFlowControl, layout, type Token } from "../../hub/cashAssembly";

export interface ScriptNames {
  /** Script ids in this template, which become links to that script. */
  scripts: Set<string>;
  /** Variable id to its readable name, shown on hover. */
  variables: Map<string, string>;
}

function TokenView({ token, names }: { token: Token; names: ScriptNames }): ReactNode {
  switch (token.kind) {
    case "op":
      if (isFlowControl(token.text)) {
        return <span className="font-semibold text-amber-300">{token.text}</span>;
      }
      return <span className={token.text.endsWith("VERIFY") ? "text-rose-300" : "text-sky-300"}>{token.text}</span>;
    case "hex":
      return (
        <span className="break-all text-emerald-300" title={`${(token.text.length - 2) / 2} bytes`}>
          {token.text}
        </span>
      );
    case "number":
      return <span className="text-orange-300">{token.text}</span>;
    case "string":
      return <span className="text-lime-300">{token.text}</span>;
    case "comment":
      return <span className="italic text-slate-500">{token.text}</span>;
    case "ref":
      if (names.scripts.has(token.text)) {
        return (
          <a href={`#script-${token.text}`} className="text-violet-300 underline decoration-violet-400/40 underline-offset-2 hover:text-violet-200" title="Another script in this template">
            {token.text}
          </a>
        );
      }
      return (
        <span className="text-fuchsia-300" title={names.variables.get(token.text.split(".")[0]) ?? "Filled in when the transaction is built"}>
          {token.text}
        </span>
      );
    case "push":
    case "eval":
      return (
        <span>
          <span className="text-slate-500">{token.kind === "push" ? "<" : "$("}</span>
          <Tokens tokens={token.children} names={names} />
          <span className="text-slate-500">{token.kind === "push" ? ">" : ")"}</span>
        </span>
      );
  }
}

function Tokens({ tokens, names }: { tokens: Token[]; names: ScriptNames }) {
  return tokens.map((token, index) => (
    <Fragment key={index}>
      {index > 0 && " "}
      <TokenView token={token} names={names} />
    </Fragment>
  ));
}

/** A CashAssembly script, laid out one statement per line with OP_IF branches indented and parts coloured by kind. */
export function ScriptCode({ tokens, names }: { tokens: Token[]; names: ScriptNames }) {
  const lines = layout(tokens);
  const gutter = String(lines.length).length;

  return (
    <div className="mt-2 max-h-96 overflow-auto rounded-xl border border-white/[0.06] bg-[#080a10] py-2 font-mono text-xs leading-5 text-slate-300">
      {lines.map((line, index) => (
        <div key={index} className="flex hover:bg-white/[0.03]">
          <span className="shrink-0 select-none px-3 text-right text-slate-600" style={{ width: `${gutter + 2.5}ch` }}>
            {index + 1}
          </span>
          <span className="min-w-0 whitespace-pre-wrap break-words pr-3" style={{ paddingLeft: `${line.indent * 2}ch` }}>
            <Tokens tokens={line.tokens} names={names} />
          </span>
        </div>
      ))}
    </div>
  );
}
