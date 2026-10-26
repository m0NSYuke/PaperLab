import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";

let cached: Promise<Record<string, string>> | null = null;

/** Display names of concept cards by slug, loaded once per page; falls back to the slug. */
export function useConceptNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    cached ??= api<{ concepts: { slug: string; name: string }[] }>("/api/concepts")
      .then((r) => Object.fromEntries(r.concepts.map((c) => [c.slug, c.name])))
      .catch(() => ((cached = null), {}));
    void cached.then(setNames);
  }, []);
  return useCallback((slug: string) => names[slug] || slug.replaceAll("-", " "), [names]);
}
