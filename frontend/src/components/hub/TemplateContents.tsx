import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import type { NamedItem, PartView, TemplateView, ValueView } from "../../hub/templateView";

const card = "rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#121522] to-[#0a0c13] p-6 sm:p-7 2xl:p-9";
const heading = "text-xs font-semibold uppercase tracking-[.16em] text-slate-500";
const code = "rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-slate-200";

/** One collapsible block. Uses the browser's own details element, so it works with the keyboard and without scripts. */
function Block({ title, count, open, children }: { title: string; count: number; open?: boolean; children: ReactNode }) {
  if (count === 0) {
    return null;
  }

  return (
    <details open={open} className="group rounded-2xl border border-white/[0.06] bg-black/20">
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

function Named({ item, extra }: { item: NamedItem; extra?: ReactNode }) {
  return (
    <li className="space-y-1">
      <p className="text-sm font-semibold text-white">
        {item.name} <span className={`${code} ml-1 align-middle`}>{item.id}</span>
      </p>
      {item.description && <p className="text-sm leading-6 text-slate-400">{item.description}</p>}
      {extra}
    </li>
  );
}

function Parts({ items }: { items: PartView[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <Named key={item.id} item={item} extra={item.detail && <p className="font-mono text-xs text-slate-500">{item.detail}</p>} />
      ))}
    </ul>
  );
}

function Values({ items }: { items: ValueView[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <Named
          key={item.id}
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

/**
 * What the template actually contains, for someone deciding whether to trust it: the actions people can take, the
 * transactions they build, and the scripts that decide what the coins can do.
 */
export function TemplateContents({ view }: { view: TemplateView }) {
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
    <section className={card}>
      <p className={heading}>Template contents</p>
      <p className="mt-3 text-sm text-slate-400">
        Everything below comes from the template file itself. The scripts are the rules the coins follow, so read them
        before you use a template with real money.
      </p>

      <div className="mt-5 space-y-3">
        <Block title="Actions" count={view.actions.length} open>
          <ul className="space-y-5">
            {view.actions.map((action) => (
              <Named
                key={action.id}
                item={action}
                extra={
                  <div className="space-y-2 pt-1">
                    {action.transaction && (
                      <p className="text-xs text-slate-500">
                        Builds transaction <span className={code}>{action.transaction}</span>
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
                              <span key={variable} className={`${code} mr-1 inline-block`}>
                                {variable}
                              </span>
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

        <Block title="Transactions" count={view.transactions.length}>
          <ul className="space-y-5">
            {view.transactions.map((transaction) => {
              const inputs = new Map(view.inputs.map((item) => [item.id, item]));
              const outputs = new Map(view.outputs.map((item) => [item.id, item]));

              return (
                <Named
                  key={transaction.id}
                  item={transaction}
                  extra={
                    <div className="grid gap-3 pt-1 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Spends</p>
                        {transaction.inputs.length === 0 && <p className="text-xs text-slate-500">Nothing from the contract.</p>}
                        {transaction.inputs.map((id, index) => (
                          <p key={`${id}-${index}`} className="mt-1 text-xs text-slate-300">
                            {index}. {inputs.get(id)?.name ?? id}
                            {inputs.get(id)?.detail && <span className="block font-mono text-slate-500">{inputs.get(id)?.detail}</span>}
                          </p>
                        ))}
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Creates</p>
                        {transaction.outputs.length === 0 && <p className="text-xs text-slate-500">No outputs.</p>}
                        {transaction.outputs.map((id, index) => (
                          <p key={`${id}-${index}`} className="mt-1 text-xs text-slate-300">
                            {index}. {outputs.get(id)?.name ?? id}
                            {outputs.get(id)?.detail && <span className="block font-mono text-slate-500">{outputs.get(id)?.detail}</span>}
                          </p>
                        ))}
                      </div>
                    </div>
                  }
                />
              );
            })}
          </ul>
        </Block>

        <Block title="Locking scripts" count={view.lockingScripts.length}>
          <Parts items={view.lockingScripts} />
        </Block>

        <Block title="Scripts (CashAssembly)" count={view.scripts.length}>
          <ul className="space-y-5">
            {view.scripts.map((script) => (
              <li key={script.id}>
                <p className="flex items-center justify-between gap-3 text-sm font-semibold text-white">
                  <span className={code}>{script.id}</span>
                  <span className="text-xs font-normal text-slate-500">{script.length.toLocaleString()} characters</span>
                </p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/[0.06] bg-[#080a10] p-3 font-mono text-xs leading-5 text-slate-300">
                  {script.text}
                </pre>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Constants" count={view.constants.length}>
          <Values items={view.constants} />
        </Block>

        <Block title="Variables" count={view.variables.length}>
          <Values items={view.variables} />
        </Block>
      </div>
    </section>
  );
}
