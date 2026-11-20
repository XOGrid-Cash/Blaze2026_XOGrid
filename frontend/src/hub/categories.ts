import { useEffect, useState } from "react";

import { getCategories, type CategoryList } from "./api";

let cached: CategoryList | null = null;

/** The categories and their counts, fetched once per page load. Null while loading or if the registry is unreachable. */
export function useCategories(): CategoryList | null {
  const [value, setValue] = useState<CategoryList | null>(cached);

  useEffect(() => {
    if (cached) return;

    let live = true;

    getCategories()
      .then((list) => {
        cached = list;
        if (live) setValue(list);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  return value;
}

/** A readable name for a category slug, for places that only have the slug. */
export const categoryLabel = (slug: string): string => slug.charAt(0).toUpperCase() + slug.slice(1);
