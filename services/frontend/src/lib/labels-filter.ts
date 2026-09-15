/**
 * The labels filter: which labels a statistic counts.
 *
 * Every statistic that counts animals can read a person's labels where an
 * image is verified and the AI's labels elsewhere (the default), only what
 * people entered, or the AI's labels on every image. The backend defines the
 * three sources once in shared/label_source.py; this is the one place the
 * frontend knows about them, so the field reads the same on the dashboard
 * and on every insights page.
 *
 * A page adds the filter with two spreads, `...LABELS_SCHEMA` in its URL
 * schema and `LABELS_FIELD` in its field list, and passes
 * `labelSourceParam(parsed.labels)` to the API. The field sits in the More
 * popover on every page, on purpose: few people use it, and one place to
 * find it beats one more control in the bar.
 */
import type { FilterFieldDef } from '../components/ui/FilterBar';
import type { LabelSource } from '../api/types';
import type { FilterSchema } from './filter-url';

export const LABELS_KEY = 'labels';

export const LABELS_SCHEMA: FilterSchema = { [LABELS_KEY]: 'string' };

/** The default, shown as the empty option so it stays out of the URL and off
 *  the chip row, and so Clear all returns to it. */
const DEFAULT_LABEL = 'Verified, else AI';

const OPTIONS: Array<{ value: Exclude<LabelSource, 'merged'>; label: string }> = [
  { value: 'verified', label: 'Verified only' },
  { value: 'ai', label: 'AI only' },
];

export const LABELS_FIELD: FilterFieldDef = {
  kind: 'select',
  key: LABELS_KEY,
  label: 'Labels',
  placeholder: DEFAULT_LABEL,
  options: OPTIONS,
  primary: false,
};

/** The API parameter for a parsed URL value. Undefined for the default, so
 *  query keys and request URLs stay as they were. */
export const labelSourceParam = (
  value: string | string[] | undefined,
): Exclude<LabelSource, 'merged'> | undefined =>
  value === 'verified' || value === 'ai' ? value : undefined;

/** The option label for a source, for captions under a chart. */
export const labelSourceLabel = (source: LabelSource | undefined): string =>
  OPTIONS.find((o) => o.value === source)?.label ?? DEFAULT_LABEL;
