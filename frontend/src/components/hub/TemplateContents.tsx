import { Fragment, useMemo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { tokenize } from "../../hub/cashAssembly";
import type { NamedItem, PartFact, PartView, TemplateView, ValueView } from "../../hub/templateView";
import { InlineCode, ScriptCode } from "./ScriptCode";
import { anchorId, buildRefIndex, RefContext, sizeLabel, useRefNavigation, useRefs, type RefKind } from "../../hub/templateRefs";
import { BackChip, RefLink } from "./RefLink";
import { TemplateSearch } from "./TemplateSearch";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { SECTION_KINDS, sectionId } from "../../hub/templateShortcuts";

const card = "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 sm:p-7 2xl:p-9";
const heading = "text-xs font-semibold uppercase tracking-[.16em] text-slate-500";
const code = "rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-slate-200";
/** Room around a jump target so the highlight ring is not clipped, and space above it when scrolled to the top. */
const target = "scroll-mt-24 rounded-lg";

/** One collapsible block. Uses the browser's own details element, so it works with the keyboard and without scripts. */
function Block({ kind, title, count, open, children }: { kind: RefKind; title: string; count: number; open?: boolean; children: ReactNode }) {
  if (count === 0) {
    return null;
  }

  return (
    <details id={sectionId(kind)} open={open} className="group scroll-mt-24 rounded-2xl border border-white/[0.06] bg-black/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 2xl:p-5 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-white">
          {title} <span className="ml-1 font-normal text-slate-500">({count})</span>
        </span>
        <ChevronDown size={16} className="text-slate-500 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-white/[0.06] p-4 2xl:p-5">{children}</div>
    </details>
  );
}

/** "Used in: …" with a link to each part that refers to this one, or a "Not used" note where that is worth knowing. */
function UsedIn({ kind, id }: { kind: RefKind; id: string }) {
  const refs = useRefs();
  const usages = refs?.usages(kind, id) ?? [];

  if (usages.length === 0) {
    return refs?.reportUnused(kind) ? (
      <p className="text-xs text-amber-300/80" title="Nothing else in this template refers to it">
        Not used anywhere in this template
      </p>
    ) : null;
  }

  return (
    <p className="text-xs leading-5 text-slate-500">
      Used in{" "}
      {usages.map((usage, index) => (
        <Fragment key={`${usage.kind}:${usage.id}`}>
          {index > 0 && ", "}
          <RefLink target={usage} className="text-slate-300">
            {usage.name}
          </RefLink>
        </Fragment>
      ))}
    </p>
  );
}

function Named({ kind, item, extra }: { kind: RefKind; item: NamedItem; extra?: ReactNode }) {
  return (
    <li id={anchorId(kind, item.id)} data-ref-label={item.name} className={`space-y-1 ${target}`}>
      <p className="text-sm font-semibold text-white">
        {item.name} <span className={`${code} ml-1 align-middle`}>{item.id}</span>
      </p>
      {item.description && <p className="text-sm leading-6 text-slate-400">{item.description}</p>}
      {extra}
      <UsedIn kind={kind} id={item.id} />
    </li>
  );
}

/** A labelled fact about an input, output or locking script, with its script or locking script as a link. */
function Fact({ fact }: { fact: PartFact }) {
  const refs = useRefs();
  let value: ReactNode;

  if (fact.plain) {
    value = <span className="font-mono text-xs text-slate-300">{fact.code}</span>;
  } else if (fact.refers === "expression") {
    value = <InlineCode text={fact.code} />;
  } else if (fact.refers === "actions" || fact.refers === "variables") {
    value = fact.code.split(/\s+/).map((id, index) => {
      const linked = fact.refers === "actions" ? refs?.get("action", id) : (refs?.get("variable", id) ?? refs?.get("constant", id));
      return (
        <Fragment key={id}>
          {index > 0 && ", "}
          <RefLink target={linked} className={`font-mono text-xs ${fact.refers === "actions" ? "text-slate-200" : "text-fuchsia-300"}`}>
            {linked?.kind === "action" ? linked.name : id}
          </RefLink>
        </Fragment>
      );
    });
  } else {
    value = (
      <RefLink target={refs?.get(fact.refers, fact.code)} className="font-mono text-xs text-violet-300">
        {fact.code}
      </RefLink>
    );
  }

  return (
    <span className="block text-xs text-slate-500">
      {fact.label}: {value}
    </span>
  );
}

function Facts({ facts }: { facts: PartFact[] }) {
  return facts.map((fact) => <Fact key={fact.label} fact={fact} />);
}

function Parts({ kind, items }: { kind: RefKind; items: PartView[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <Named key={item.id} kind={kind} item={item} extra={item.facts.length > 0 && <div className="space-y-0.5">{<Facts facts={item.facts} />}</div>} />
      ))}
    </ul>
  );
}

function Values({ kind, items }: { kind: RefKind; items: ValueView[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <Named
          key={item.id}
          kind={kind}
          item={item}
          extra={
            (item.type || item.value) && (
              <p className="font-mono text-xs text-slate-500">
                {item.type}
                {item.type && item.value ? " · " : ""}
                {item.value && <span className="break-all text-slate-300">{item.value}</span>}
              </p>
            )
          }
        />
      ))}
    </ul>
  );
}

function ScriptList({ view }: { view: TemplateView }) {
  const refs = useRefs();

  return (
    <ul className="space-y-5">
      {view.scripts.map((script) => {
        const size = refs?.scriptSize(script.id);
        const label = size && sizeLabel(size);

        return (
          <li key={script.id} id={anchorId("script", script.id)} data-ref-label={script.id} className={target}>
            <p className="flex items-center justify-between gap-3 text-sm font-semibold text-white">
              <span className={code}>{script.id}</span>
              {label && (
                <span className="cursor-help text-xs font-normal text-slate-500" title={label.title}>
                  {label.label}
                </span>
              )}
            </p>
            <ScriptCode tokens={tokenize(script.text)} />
            <div className="mt-1.5">
              <UsedIn kind="script" id={script.id} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PartLine({ index, id, part }: { index: number; id: string; part: PartView | undefined }) {
  return (
    <div className="mt-1 text-xs text-slate-300">
      {index}. {part?.name ?? id}
      {part && <Facts facts={part.facts} />}
    </div>
  );
}

/**
 * What the template actually contains, for someone deciding whether to trust it: the actions people can take, the
 * transactions they build, and the scripts that decide what the coins can do. Names that point at another part of
 * the template are links to it.
 */
export function TemplateContents({ view }: { view: TemplateView }) {
  const refs = useMemo(() => buildRefIndex(view), [view]);
  const { backLabel, dismissBack } = useRefNavigation(refs);
  const inputs = useMemo(() => new Map(view.inputs.map((item) => [item.id, item])), [view]);
  const outputs = useMemo(() => new Map(view.outputs.map((item) => [item.id, item])), [view]);
  const sections = useMemo(() => {
    const counts: Record<RefKind, number> = {
      action: view.actions.length,
      transaction: view.transactions.length,
      lockingScript: view.lockingScripts.length,
      script: view.scripts.length,
      constant: view.constants.length,
      variable: view.variables.length,
    };
    return SECTION_KINDS.filter((kind) => counts[kind] > 0);
  }, [view]);

  const total =
    view.actions.length +
    view.transactions.length +
    view.lockingScripts.length +
    view.scripts.length +
    view.constants.length +
    view.variables.length;

  if (total === 0) {
    return null;
  }

  return (
    <RefContext value={refs}>
      <section className={card} data-template-contents>
        <div className="flex items-center justify-between gap-3">
          <p className={heading}>Template contents</p>
          <ShortcutsHelp sections={sections} />
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Everything below comes from the template file itself. The scripts are the rules the coins follow, so read them
          before you use a template with real money. Underlined names link to where they are defined.
        </p>

        <TemplateSearch />

        <div className="mt-4 space-y-3">
          <Block kind="action" title="Actions" count={view.actions.length}>
            <ul className="space-y-5">
              {view.actions.map((action) => (
                <Named
                  key={action.id}
                  kind="action"
                  item={action}
                  extra={
                    <div className="space-y-2 pt-1">
                      {action.transaction && (
                        <p className="text-xs text-slate-500">
                          Builds transaction{" "}
                          <RefLink target={refs.get("transaction", action.transaction)} className={code}>
                            {action.transaction}
                          </RefLink>
                        </p>
                      )}
                      {action.roles.map((role) => (
                        <div key={role.id} className="border-l-2 border-violet-400/30 pl-3">
                          <p className="text-xs font-semibold text-slate-200">{role.name}</p>
                          {role.description && <p className="text-xs leading-5 text-slate-400">{role.description}</p>}
                          {role.variables.length > 0 && (
                            <p className="mt-1 text-xs text-slate-500">
                              Provides:{" "}
                              {role.variables.map((variable) => (
                                <RefLink key={variable} target={refs.get("variable", variable)} className={`${code} mr-1 inline-block`}>
                                  {variable}
                                </RefLink>
                              ))}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  }
                />
              ))}
            </ul>
          </Block>

          <Block kind="transaction" title="Transactions" count={view.transactions.length}>
            <ul className="space-y-5">
              {view.transactions.map((transaction) => (
                <Named
                  key={transaction.id}
                  kind="transaction"
                  item={transaction}
                  extra={
                    <div className="grid gap-3 pt-1 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Spends</p>
                        {transaction.inputs.length === 0 && <p className="text-xs text-slate-500">Nothing from the contract.</p>}
                        {transaction.inputs.map((id, index) => (
                          <PartLine key={`${id}-${index}`} index={index} id={id} part={inputs.get(id)} />
                        ))}
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Creates</p>
                        {transaction.outputs.length === 0 && <p className="text-xs text-slate-500">No outputs.</p>}
                        {transaction.outputs.map((id, index) => (
                          <PartLine key={`${id}-${index}`} index={index} id={id} part={outputs.get(id)} />
                        ))}
                      </div>
                    </div>
                  }
                />
              ))}
            </ul>
          </Block>

          <Block kind="lockingScript" title="Locking scripts" count={view.lockingScripts.length}>
            <Parts kind="lockingScript" items={view.lockingScripts} />
          </Block>

          <Block kind="script" title="Scripts (CashAssembly)" count={view.scripts.length}>
            <ScriptList view={view} />
          </Block>

          <Block kind="constant" title="Constants" count={view.constants.length}>
            <Values kind="constant" items={view.constants} />
          </Block>

          <Block kind="variable" title="Variables" count={view.variables.length}>
            <Values kind="variable" items={view.variables} />
          </Block>
        </div>
      </section>
      <BackChip label={backLabel} onDismiss={dismissBack} />
    </RefContext>
  );
}
