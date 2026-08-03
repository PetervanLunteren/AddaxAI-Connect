/**
 * Column definitions for the cameras table.
 *
 * Single source of truth for which columns the table can render, in what
 * order, and which are visible by default. Both the ColumnPicker and the
 * page render off this list. The picker only toggles visibility; reorder
 * is intentionally out of scope for v1.
 *
 * Visibility persists per browser via localStorage, handled by the shared
 * column-prefs helper (lib/columnPrefs.ts).
 */
import { makeColumnPrefs } from '../../lib/columnPrefs';

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

export const cameraColumnPrefs = makeColumnPrefs<ColumnId>('cameras-visible-columns', [
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
]);
