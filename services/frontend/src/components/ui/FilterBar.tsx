/**
 * Shared filter bar used across Connect.
 *
 * Always-visible row of labelled controls. Primary fields render inline.
 * Fields marked `primary: false` overflow into a "More" popover on the
 * right. Chart and table display controls live in a separate "Display"
 * popover so "Clear all" never wipes them. Active filters render as
 * chips below the bar with a "Clear all" link.
 *
 * Schema-driven so every page declares its filters in one place. The
 * bar has no domain knowledge.
 *
 * Mirrors AddaxAI WebUI's filter-bar pattern.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, Filter, SlidersHorizontal, X } from 'lucide-react';

import { Button } from './Button';
import { DateRangePicker } from './DateRangePicker';
import { MultiSelect, type Option } from './MultiSelect';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { Slider } from './Slider';

export type { Option };

export type FilterFieldDef =
  | {
      kind: 'multi-select';
      key: string;
      label: string;
      options: Option[];
      placeholder?: string;
      /** Defaults to true. Set false to push the field into the More popover. */
      primary?: boolean;
      isLoading?: boolean;
      /** Chip text for the summary case when more than two items are selected. */
      summary?: (count: number) => string;
    }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: Array<{ value: string; label: string }>;
      /** Defaults to "All". Shown as the first option with empty value. */
      placeholder?: string;
      primary?: boolean;
    }
  | {
      kind: 'date-range';
      fromKey: string;
      toKey: string;
      label: string;
      minDate?: string | null;
      maxDate?: string | null;
      primary?: boolean;
    }
  | {
      kind: 'search';
      key: string;
      label: string;
      placeholder?: string;
      primary?: boolean;
    }
  | {
      kind: 'range';
      /** URL key for the lower bound. */
      minKey: string;
      /** URL key for the upper bound. */
      maxKey: string;
      label: string;
      /** Lower bound of the slider track. */
      min: number;
      /** Upper bound of the slider track. */
      max: number;
      step: number;
      /** Renders the active range, e.g. "60% - 90%". */
      format: (lo: number, hi: number) => string;
      /** Prefix for the chip label, e.g. "Detection". */
      chipPrefix?: string;
      primary?: boolean;
    };

export type DisplayControlDef = {
  key: string;
  label: string;
  /** Select options. Required unless `render` is provided. */
  options?: Array<{ value: string; label: string }>;
  /**
   * Optional custom renderer for controls that don't fit a Select. The
   * page owns the wiring (state, onChange); the popover just hosts the
   * element under the same label. Useful for things like a column
   * visibility picker on the cameras page.
   */
  render?: () => React.ReactNode;
};

export type FilterValue = string | string[] | undefined;

export interface FilterBarProps {
  fields: FilterFieldDef[];
  values: Record<string, FilterValue>;
  /**
   * Called with a partial values map every time a field changes. Always
   * a patch (`{ key: value }` or `{ fromKey, toKey }` for date-range) so
   * multi-key writes apply atomically.
   */
  onChange: (patch: Record<string, FilterValue>) => void;
  onClearAll: () => void;
  displayControls?: DisplayControlDef[];
  displayValues?: Record<string, string>;
  onDisplayChange?: (key: string, value: string) => void;
}

interface ChipDescriptor {
  key: string;
  label: string;
  onRemove: () => void;
}

const VALUE_KEYS = (field: FilterFieldDef): string[] => {
  if (field.kind === 'date-range') return [field.fromKey, field.toKey];
  if (field.kind === 'range') return [field.minKey, field.maxKey];
  return [field.key];
};

const isPrimary = (field: FilterFieldDef): boolean => field.primary !== false;

const isFieldActive = (
  field: FilterFieldDef,
  values: Record<string, FilterValue>,
): boolean => {
  for (const key of VALUE_KEYS(field)) {
    const v = values[key];
    if (Array.isArray(v) ? v.length > 0 : Boolean(v)) return true;
  }
  return false;
};

const asStringArray = (v: FilterValue): string[] => (Array.isArray(v) ? v : []);
const asString = (v: FilterValue): string =>
  typeof v === 'string' ? v : '';

export const FilterBar: React.FC<FilterBarProps> = ({
  fields,
  values,
  onChange,
  onClearAll,
  displayControls,
  displayValues,
  onDisplayChange,
}) => {
  const primaryFields = useMemo(() => fields.filter(isPrimary), [fields]);
  const overflowFields = useMemo(
    () => fields.filter((f) => !isPrimary(f)),
    [fields],
  );

  const chips = useMemo(
    () => buildChips(fields, values, onChange),
    [fields, values, onChange],
  );

  const overflowActiveCount = useMemo(
    () => overflowFields.filter((f) => isFieldActive(f, values)).length,
    [overflowFields, values],
  );

  return (
    <div className="rounded-lg border bg-card pt-2 pb-3 px-3 space-y-3">
      {/* Filters fill the left and wrap among themselves; the More/Display
          buttons stay pinned top-right as their own group, so they never
          orphan onto a lonely row no matter how many filters a page has. */}
      <div className="flex items-end gap-3">
        <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
          {primaryFields.map((field) => (
            <FieldCell key={fieldKey(field)} field={field} values={values} onChange={onChange} />
          ))}
        </div>

        {(overflowFields.length > 0 || (displayControls && displayControls.length > 0)) && (
          <div className="flex items-end gap-2 shrink-0">
            {overflowFields.length > 0 && (
              <MorePopover
                fields={overflowFields}
                values={values}
                onChange={onChange}
                activeCount={overflowActiveCount}
              />
            )}
            {displayControls && displayControls.length > 0 && onDisplayChange && (
              <DisplayPopover
                controls={displayControls}
                values={displayValues ?? {}}
                onChange={onDisplayChange}
              />
            )}
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="border-t pt-2 flex items-center gap-2 flex-wrap">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-xs"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                className="ml-0.5 rounded-full hover:bg-black/10 p-0.5"
                aria-label={`Remove filter ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};

const FieldCell: React.FC<{
  field: FilterFieldDef;
  values: Record<string, FilterValue>;
  onChange: (patch: Record<string, FilterValue>) => void;
}> = ({ field, values, onChange }) => (
  <div className="space-y-1.5 flex-1 min-w-[12rem]">
    <label className="text-xs font-medium text-muted-foreground">
      {field.label}
    </label>
    <FieldControl field={field} values={values} onChange={onChange} />
  </div>
);

const FieldControl: React.FC<{
  field: FilterFieldDef;
  values: Record<string, FilterValue>;
  onChange: (patch: Record<string, FilterValue>) => void;
}> = ({ field, values, onChange }) => {
  if (field.kind === 'multi-select') {
    const selected = asStringArray(values[field.key]);
    const selectedOptions = field.options.filter((o) =>
      selected.includes(String(o.value)),
    );
    return (
      <MultiSelect
        options={field.options}
        value={selectedOptions}
        onChange={(opts) =>
          onChange({
            [field.key]:
              opts.length === 0 ? undefined : opts.map((o) => String(o.value)),
          })
        }
        placeholder={field.placeholder ?? 'Any'}
        isLoading={field.isLoading}
      />
    );
  }
  if (field.kind === 'select') {
    return (
      <NativeSelect
        value={asString(values[field.key])}
        onChange={(v) => onChange({ [field.key]: v === '' ? undefined : v })}
        placeholder={field.placeholder ?? 'All'}
        options={field.options}
      />
    );
  }
  if (field.kind === 'date-range') {
    return (
      <DateRangePicker
        from={asString(values[field.fromKey]) || null}
        to={asString(values[field.toKey]) || null}
        onChange={({ from, to }) =>
          onChange({
            [field.fromKey]: from || undefined,
            [field.toKey]: to || undefined,
          })
        }
        minDate={field.minDate}
        maxDate={field.maxDate}
      />
    );
  }
  if (field.kind === 'range') {
    return (
      <RangeControl field={field} values={values} onChange={onChange} />
    );
  }
  // search
  return (
    <input
      type="search"
      className="w-full h-10 px-3 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      value={asString(values[field.key])}
      placeholder={field.placeholder}
      onChange={(e) =>
        onChange({
          [field.key]: e.target.value === '' ? undefined : e.target.value,
        })
      }
    />
  );
};

const RangeControl: React.FC<{
  field: Extract<FilterFieldDef, { kind: 'range' }>;
  values: Record<string, FilterValue>;
  onChange: (patch: Record<string, FilterValue>) => void;
}> = ({ field, values, onChange }) => {
  const rawLo = asString(values[field.minKey]);
  const rawHi = asString(values[field.maxKey]);
  const lo = rawLo === '' ? field.min : Number(rawLo);
  const hi = rawHi === '' ? field.max : Number(rawHi);
  const safeLo = Number.isFinite(lo) ? lo : field.min;
  const safeHi = Number.isFinite(hi) ? hi : field.max;
  const eps = field.step / 2;
  return (
    <div className="flex items-center gap-3">
      <Slider
        className="h-9 flex-1"
        value={[safeLo, safeHi]}
        min={field.min}
        max={field.max}
        step={field.step}
        onValueChange={([nextLo, nextHi]) =>
          onChange({
            [field.minKey]: nextLo > field.min + eps ? String(nextLo) : undefined,
            [field.maxKey]: nextHi < field.max - eps ? String(nextHi) : undefined,
          })
        }
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {field.format(safeLo, safeHi)}
      </span>
    </div>
  );
};

const NativeSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  /** When provided, shown as a leading option with empty value (typical
   *  for filter selects where empty = no filter). Pass `null` to render
   *  only the real options (typical for display controls where one of
   *  the real options is always the active state). */
  placeholder: string | null;
  options: Array<{ value: string; label: string }>;
}> = ({ value, onChange, placeholder, options }) => (
  <div className="relative">
    <select
      className="w-full h-10 px-3 pr-8 border border-input rounded-md bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== null && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
  </div>
);

const MorePopover: React.FC<{
  fields: FilterFieldDef[];
  values: Record<string, FilterValue>;
  onChange: (patch: Record<string, FilterValue>) => void;
  activeCount: number;
}> = ({ fields, values, onChange, activeCount }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-10 gap-2">
          <Filter className="h-4 w-4" />
          More
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        {fields.map((field) => (
          <div key={fieldKey(field)} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {field.label}
            </label>
            <FieldControl field={field} values={values} onChange={onChange} />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const DisplayPopover: React.FC<{
  controls: DisplayControlDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}> = ({ controls, values, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-10 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Display
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        {controls.map((ctrl) => (
          <div key={ctrl.key} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {ctrl.label}
            </label>
            {ctrl.render ? (
              ctrl.render()
            ) : (
              <NativeSelect
                value={values[ctrl.key] ?? ''}
                onChange={(v) => onChange(ctrl.key, v)}
                placeholder={null}
                options={ctrl.options ?? []}
              />
            )}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const fieldKey = (field: FilterFieldDef): string => {
  if (field.kind === 'date-range') return field.fromKey;
  if (field.kind === 'range') return field.minKey;
  return field.key;
};

function buildChips(
  fields: FilterFieldDef[],
  values: Record<string, FilterValue>,
  onChange: (patch: Record<string, FilterValue>) => void,
): ChipDescriptor[] {
  const chips: ChipDescriptor[] = [];
  for (const field of fields) {
    if (field.kind === 'multi-select') {
      const selected = asStringArray(values[field.key]);
      if (selected.length === 0) continue;
      const byValue = new Map(field.options.map((o) => [String(o.value), o.label]));
      if (selected.length <= 2) {
        for (const value of selected) {
          chips.push({
            key: `${field.key}:${value}`,
            label: byValue.get(value) ?? value,
            onRemove: () => {
              const next = selected.filter((v) => v !== value);
              onChange({ [field.key]: next.length === 0 ? undefined : next });
            },
          });
        }
      } else {
        const summary = field.summary
          ? field.summary(selected.length)
          : `${selected.length} ${field.label.toLowerCase()}`;
        chips.push({
          key: `${field.key}:summary`,
          label: summary,
          onRemove: () => onChange({ [field.key]: undefined }),
        });
      }
    } else if (field.kind === 'select') {
      const value = asString(values[field.key]);
      if (!value) continue;
      const match = field.options.find((o) => o.value === value);
      chips.push({
        key: `${field.key}:${value}`,
        label: match?.label ?? value,
        onRemove: () => onChange({ [field.key]: undefined }),
      });
    } else if (field.kind === 'date-range') {
      const from = asString(values[field.fromKey]);
      const to = asString(values[field.toKey]);
      if (from) {
        chips.push({
          key: `${field.fromKey}:${from}`,
          label: `From ${from}`,
          onRemove: () => onChange({ [field.fromKey]: undefined }),
        });
      }
      if (to) {
        chips.push({
          key: `${field.toKey}:${to}`,
          label: `To ${to}`,
          onRemove: () => onChange({ [field.toKey]: undefined }),
        });
      }
    } else if (field.kind === 'search') {
      const value = asString(values[field.key]);
      if (!value) continue;
      chips.push({
        key: `${field.key}:${value}`,
        label: value,
        onRemove: () => onChange({ [field.key]: undefined }),
      });
    } else if (field.kind === 'range') {
      const rawLo = asString(values[field.minKey]);
      const rawHi = asString(values[field.maxKey]);
      if (!rawLo && !rawHi) continue;
      const lo = rawLo === '' ? field.min : Number(rawLo);
      const hi = rawHi === '' ? field.max : Number(rawHi);
      const safeLo = Number.isFinite(lo) ? lo : field.min;
      const safeHi = Number.isFinite(hi) ? hi : field.max;
      const prefix = field.chipPrefix ?? field.label;
      chips.push({
        key: `${field.minKey}:${field.maxKey}`,
        label: `${prefix} ${field.format(safeLo, safeHi)}`,
        onRemove: () =>
          onChange({ [field.minKey]: undefined, [field.maxKey]: undefined }),
      });
    }
  }
  return chips;
}
