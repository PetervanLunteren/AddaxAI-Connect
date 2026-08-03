/**
 * Column visibility preferences, shared by the cameras and sites tables.
 *
 * Each table declares its columns once (single source of truth for order,
 * labels, defaults) and gets typed load/save helpers persisting per browser
 * via localStorage under its own key. Load falls back to the defaults on a
 * missing key, parse failure, or any stale ID that no longer exists (e.g. a
 * column ship-deleted between releases). Always-visible columns are merged
 * in so the user cannot end up with an unidentifiable table even if the
 * saved list is corrupted, and order is reasserted to match the spec.
 */

export interface ColumnDef<C extends string> {
  id: C;
  label: string;
  defaultVisible: boolean;
  sortable: boolean;
  // Columns the user cannot hide, so a row stays identifiable no matter
  // what gets toggled.
  alwaysVisible?: boolean;
}

export interface ColumnPrefs<C extends string> {
  columns: ColumnDef<C>[];
  defaults: C[];
  load: () => C[];
  save: (ids: C[]) => void;
}

export function makeColumnPrefs<C extends string>(
  storageKey: string,
  columns: ColumnDef<C>[],
): ColumnPrefs<C> {
  const defaults = columns.filter((c) => c.defaultVisible).map((c) => c.id);
  const allIds = new Set<string>(columns.map((c) => c.id));

  // Always-visible columns are forced on regardless of what was passed, and
  // order is reasserted to match the column spec.
  const mergeAlwaysVisible = (ids: C[]): C[] => {
    const requested = new Set(ids);
    for (const c of columns) {
      if (c.alwaysVisible) requested.add(c.id);
    }
    return columns.filter((c) => requested.has(c.id)).map((c) => c.id);
  };

  const load = (): C[] => {
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaults;
      const filtered = parsed.filter(
        (id): id is C => typeof id === 'string' && allIds.has(id),
      );
      if (filtered.length === 0) return defaults;
      return mergeAlwaysVisible(filtered);
    } catch {
      return defaults;
    }
  };

  const save = (ids: C[]): void => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(mergeAlwaysVisible(ids)),
      );
    } catch {
      // Quota exceeded or storage disabled. The page stays usable for this
      // session; nothing to recover.
    }
  };

  return { columns, defaults, load, save };
}
