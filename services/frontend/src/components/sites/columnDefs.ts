/**
 * Column definitions for the sites table.
 *
 * Single source of truth for which columns the table can render, in what
 * order, and which are visible by default. Both the ColumnPicker and the
 * page render off this list. Visibility persists per browser via
 * localStorage, handled by the shared column-prefs helper.
 */
import { makeColumnPrefs } from '../../lib/columnPrefs';

export type SiteColumnId =
  | 'name'
  | 'tags'
  | 'habitat'
  | 'cameras'
  | 'deployments'
  | 'images'
  | 'last_activity'
  | 'coordinates'
  | 'notes';

export const siteColumnPrefs = makeColumnPrefs<SiteColumnId>('sites-visible-columns', [
  { id: 'name', label: 'Name', defaultVisible: true, sortable: true, alwaysVisible: true },
  { id: 'tags', label: 'Tags', defaultVisible: true, sortable: true },
  { id: 'habitat', label: 'Habitat', defaultVisible: false, sortable: true },
  { id: 'cameras', label: 'Cameras', defaultVisible: true, sortable: true },
  { id: 'deployments', label: 'Deployments', defaultVisible: false, sortable: true },
  { id: 'images', label: 'Images', defaultVisible: true, sortable: true },
  { id: 'last_activity', label: 'Last activity', defaultVisible: true, sortable: true },
  { id: 'coordinates', label: 'Coordinates', defaultVisible: false, sortable: false },
  { id: 'notes', label: 'Notes', defaultVisible: false, sortable: false },
]);
