import { Fragment, type ReactNode } from "react";

import { isFlowControl, layout, tokenize, type Token } from "../../hub/cashAssembly";
import { useRefs } from "../../hub/templateRefs";
import { RefLink } from "./RefLink";

const REF_COLOUR = { script: "text-violet-300", constant: "text-cyan-300", variable: "text-fuchsia-300" } as const;

function NameView({ text }: { text: string }) {
  const target = useRefs()?.resolveCode(text);
  const colour = target && target.kind in REF_COLOUR ? REF_COLOUR[target.kind as keyof typeof REF_COLOUR] : "text-fuchsia-300";

  return (
    <RefLink target={target} className={colour}>
      {text}
    </RefLink>
  );
}

function TokenView({ token }: { token: Token }): ReactNode {
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
      return <NameView text={token.text} />;
    case "push":
    case "eval":
      return (
        <span>
          <span className="text-slate-500">{token.kind === "push" ? "<" : "$("}</span>
          <Tokens tokens={token.children} />
          <span className="text-slate-500">{token.kind === "push" ? ">" : ")"}</span>
        </span>
      );
  }
}

function Tokens({ tokens }: { tokens: Token[] }) {
  return tokens.map((token, index) => (
    <Fragment key={index}>
      {index > 0 && " "}
      <TokenView token={token} />
    </Fragment>
  ));
}

/** A short CashAssembly expression on one line, for amounts and script names. */
export function InlineCode({ text }: { text: string }) {
  return (
    <span className="break-words font-mono text-xs text-slate-300">
      <Tokens tokens={tokenize(text)} />
    </span>
  );
}

/** A CashAssembly script, laid out one statement per line with OP_IF branches indented and parts coloured by kind. */
export function ScriptCode({ tokens }: { tokens: Token[] }) {
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
            <Tokens tokens={line.tokens} />
          </span>
        </div>
      ))}
    </div>
  );
}
