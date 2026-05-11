/**
 * URL search-params helpers for filter state.
 *
 * Lets pages persist filter state in the URL via react-router-dom's
 * useSearchParams. Multi-value fields are encoded as comma-separated
 * lists (e.g. ?site_ids=a,b,c).
 *
 * Pattern copied verbatim from AddaxAI WebUI so the two products
 * encode filters identically and shareable links round-trip.
 */

export type FilterFieldKind = "string" | "string[]" | "date";
export type FilterSchema = Record<string, FilterFieldKind>;

export function filtersFromSearchParams(
  params: URLSearchParams,
  schema: FilterSchema
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, kind] of Object.entries(schema)) {
    const raw = params.get(key);
    if (raw === null || raw === "") continue;
    if (kind === "string[]") {
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) out[key] = parts;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export function filtersToSearchParams(
  values: Record<string, string | string[] | undefined>,
  schema: FilterSchema
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, kind] of Object.entries(schema)) {
    const v = values[key];
    if (v === undefined || v === "") continue;
    if (kind === "string[]") {
      if (Array.isArray(v) && v.length > 0) {
        params.set(key, v.join(","));
      }
    } else if (typeof v === "string") {
      params.set(key, v);
    }
  }
  return params;
}
