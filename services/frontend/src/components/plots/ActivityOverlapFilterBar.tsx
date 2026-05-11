/**
 * Filter bar for the Activity overlap insights page.
 *
 * species_a / species_b dropdowns, date-range pickers, camera-tag multi-select,
 * and a clock / sun-time toggle. Filter state lives in the URL on the parent
 * page; this is a controlled component.
 */
import React from 'react';
import { Select, SelectItem } from '../ui/Select';
import { MultiSelect, type Option } from '../ui/MultiSelect';
import { DateRangePicker } from '../ui/DateRangePicker';
import type { TimeAxis } from '../../api/types';
import { normalizeLabel } from '../../utils/labels';

export interface ActivityOverlapBarValues {
  speciesA: string | null;
  speciesB: string | null;
  startDate: string | null;
  endDate: string | null;
  tags: Option[];
  timeAxis: TimeAxis;
}

interface ActivityOverlapFilterBarProps {
  speciesOptions: string[];
  tagOptions: string[];
  values: ActivityOverlapBarValues;
  onChange: (next: ActivityOverlapBarValues) => void;
}

export const ActivityOverlapFilterBar: React.FC<ActivityOverlapFilterBarProps> = ({
  speciesOptions,
  tagOptions,
  values,
  onChange,
}) => {
  const tagsAsOptions: Option[] = tagOptions.map((t) => ({ label: t, value: t }));

  return (
    <div className="rounded-lg border bg-card pt-2 pb-3 px-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Species A
          </label>
          <Select
            value={values.speciesA ?? ''}
            onValueChange={(v) => onChange({ ...values, speciesA: v || null })}
            className="w-full h-9 text-sm"
          >
            {speciesOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {normalizeLabel(s)}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Species B (optional)
          </label>
          <Select
            value={values.speciesB ?? ''}
            onValueChange={(v) => onChange({ ...values, speciesB: v || null })}
            className="w-full h-9 text-sm"
          >
            <SelectItem value="">None (single species)</SelectItem>
            {speciesOptions
              .filter((s) => s !== values.speciesA)
              .map((s) => (
                <SelectItem key={s} value={s}>
                  {normalizeLabel(s)}
                </SelectItem>
              ))}
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Date range
          </label>
          <DateRangePicker
            from={values.startDate}
            to={values.endDate}
            onChange={({ from, to }) =>
              onChange({ ...values, startDate: from ?? null, endDate: to ?? null })
            }
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Camera tags
          </label>
          <MultiSelect
            options={tagsAsOptions}
            value={values.tags}
            onChange={(tags) => onChange({ ...values, tags })}
            placeholder="All cameras"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Time axis
          </label>
          <Select
            value={values.timeAxis}
            onValueChange={(v) => onChange({ ...values, timeAxis: v as TimeAxis })}
            className="w-full h-9 text-sm"
          >
            <SelectItem value="clock">Clock time (server local)</SelectItem>
            <SelectItem value="sun">Sun time (Vazquez 2019 anchored)</SelectItem>
          </Select>
        </div>
      </div>
    </div>
  );
};
