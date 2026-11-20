import { useCategories } from "../../hub/categories";

/**
 * "All" plus one chip per category, with counts. "All" is the whole registry and is the default; choosing a category
 * narrows the list to templates filed under it (a template can be in several).
 */
export function CategoryFilter({ active, onChoose }: { active: string; onChoose: (slug: string) => void }) {
  const list = useCategories();

  if (!list) return null;

  const chip = (selected: boolean) =>
    `explore-filter rounded-full border px-4 py-2 text-sm transition ${
      selected
        ? "border-orange-400/60 bg-orange-500/15 text-white"
        : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-white"
    }`;

  return (
    <div className="mt-5 border-t border-white/[0.06] pt-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-[.15em] text-slate-500">Category</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <button type="button" aria-pressed={active === ""} onClick={() => onChoose("")} className={chip(active === "")}>
          All templates <span className="ml-1 text-xs opacity-60">{list.total}</span>
        </button>
        {list.categories.map((category) => (
          <button
            key={category.slug}
            type="button"
            aria-pressed={active === category.slug}
            onClick={() => onChoose(category.slug)}
            className={chip(active === category.slug)}
          >
            {category.label} <span className="ml-1 text-xs opacity-60">{category.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
