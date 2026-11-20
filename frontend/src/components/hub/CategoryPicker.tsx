import { useCategories } from "../../hub/categories";

/** Choose any number of categories for a template being published. Choosing none is fine. */
export function CategoryPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const list = useCategories();

  if (!list) return null;

  const toggle = (slug: string) => onChange(selected.includes(slug) ? selected.filter((item) => item !== slug) : [...selected, slug]);

  return (
    <div className="mt-6">
      <p className="text-sm font-medium text-white/80">Categories (optional)</p>
      <p className="mt-1 text-xs leading-5 text-white/35">
        Pick every category that fits, so people can find your template. If this template is already published and filed, its categories are not changed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Template categories">
        {list.categories.map((category) => {
          const on = selected.includes(category.slug);

          return (
            <button
              key={category.slug}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(category.slug)}
              className={`rounded-full border px-4 py-2 text-sm transition disabled:opacity-40 ${
                on ? "border-orange-400/60 bg-orange-500/15 text-white" : "border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {on ? "✓ " : ""}
              {category.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
