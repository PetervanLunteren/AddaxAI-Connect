/**
 * Always-visible filter bar shared by the Dashboard and every Insights
 * page that filters by camera tags and date range. Mirrors AddaxAI
 * WebUI's filter-bar pattern: rounded card, labelled cells in a grid,
 * each control inline rather than hidden in a popover.
 */
import React from 'react';
import { DateRangePicker } from '../ui/DateRangePicker';
import { MultiSelect, Option } from '../ui/MultiSelect';
import type { DateRange } from './DateRangeFilter';

interface DashboardFiltersProps {
  tags: Option[];
  onTagsChange: (tags: Option[]) => void;
  tagOptions: string[];
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  minDate?: string | null;
  maxDate?: string | null;
}

export const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  tags,
  onTagsChange,
  tagOptions,
  dateRange,
  onDateRangeChange,
  minDate,
  maxDate,
}) => {
  const options: Option[] = tagOptions.map((t) => ({ label: t, value: t }));

  return (
    <div className="rounded-lg border bg-card pt-2 pb-3 px-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Camera tags
          </label>
          <MultiSelect
            options={options}
            value={tags}
            onChange={onTagsChange}
            placeholder="All cameras"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Date range
          </label>
          <DateRangePicker
            from={dateRange.startDate}
            to={dateRange.endDate}
            onChange={({ from, to }) =>
              onDateRangeChange({ startDate: from ?? null, endDate: to ?? null })
            }
            minDate={minDate}
            maxDate={maxDate}
          />
        </div>
      </div>
    </div>
  );
};
