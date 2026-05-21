/**
 * Column definitions for the cameras table.
 *
 * Single source of truth for which columns the table can render, in what
 * order, and which are visible by default. Both the ColumnPicker and the
 * page render off this list. The picker only toggles visibility; reorder
 * is intentionally out of scope for v1.
 *
 * Visibility persists per browser via localStorage, mirroring the
 * cameras-view-mode pattern already used in CamerasPage.tsx.
 */

export type ColumnId =
  | 'device_id'
  | 'tags'
  | 'status'
  | 'battery'
  | 'signal'
  | 'sd_used'
  | 'temperature'
  | 'last_image'
  | 'last_report'
  | 'site'
  | 'location'
  | 'notes'
  | 'sim_expiry';

export interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
  sortable: boolean;
  // Columns the user cannot hide. Only the Camera ID today, so a row stays
  // identifiable no matter what the user toggles.
  alwaysVisible?: boolean;
}

export const CAMERA_COLUMNS: ColumnDef[] = [
  { id: 'device_id', label: 'Camera ID', defaultVisible: true, sortable: true, alwaysVisible: true },
  { id: 'tags', label: 'Tags', defaultVisible: false, sortable: true },
  { id: 'status', label: 'Status', defaultVisible: true, sortable: true },
  { id: 'site', label: 'Site', defaultVisible: true, sortable: true },
  { id: 'battery', label: 'Battery', defaultVisible: true, sortable: true },
  { id: 'signal', label: 'Signal', defaultVisible: true, sortable: true },
  { id: 'sd_used', label: 'SD used', defaultVisible: false, sortable: true },
  { id: 'temperature', label: 'Temperature', defaultVisible: false, sortable: true },
  { id: 'last_report', label: 'Last report', defaultVisible: false, sortable: true },
  { id: 'last_image', label: 'Last image', defaultVisible: true, sortable: true },
  { id: 'location', label: 'Location', defaultVisible: false, sortable: true },
  { id: 'notes', label: 'Notes', defaultVisible: false, sortable: false },
  { id: 'sim_expiry', label: 'SIM expiry', defaultVisible: false, sortable: true },
];

export const DEFAULT_VISIBLE: ColumnId[] = CAMERA_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.id);

const ALL_IDS: Set<string> = new Set(CAMERA_COLUMNS.map((c) => c.id));

export const STORAGE_KEY = 'cameras-visible-columns';

// Read the persisted visible-column list. Falls back to DEFAULT_VISIBLE on
// missing key, parse failure, or any stale ID that no longer exists in the
// spec (e.g. a column we ship-deleted between releases). Always-visible
// columns are merged in so the user cannot end up with an unidentifiable
// table even if their saved list is corrupted.
export function loadVisibleColumns(): ColumnId[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE;
    const filtered = parsed.filter((id): id is ColumnId =>
      typeof id === 'string' && ALL_IDS.has(id)
    );
    if (filtered.length === 0) return DEFAULT_VISIBLE;
    return mergeAlwaysVisible(filtered);
  } catch {
    return DEFAULT_VISIBLE;
  }
}

export function saveVisibleColumns(ids: ColumnId[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeAlwaysVisible(ids)));
  } catch {
    // Quota exceeded or storage disabled. The page stays usable for this
    // session; nothing to recover.
  }
}

// Always-visible columns are forced on regardless of what the caller passed.
// Order is reasserted to match CAMERA_COLUMNS so the table layout stays
// canonical even if the saved list got reordered by hand.
function mergeAlwaysVisible(ids: ColumnId[]): ColumnId[] {
  const requested = new Set(ids);
  for (const c of CAMERA_COLUMNS) {
    if (c.alwaysVisible) requested.add(c.id);
  }
  return CAMERA_COLUMNS.filter((c) => requested.has(c.id)).map((c) => c.id);
}
