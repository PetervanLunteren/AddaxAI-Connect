/**
 * Always-visible filter bar shared by the Dashboard and every Insights
 * page that filters by camera selection, camera tags, and a date range.
 * Mirrors AddaxAI WebUI's filter-bar pattern: rounded card, labelled
 * cells in a grid, controls inline rather than hidden in a popover.
 *
 * Cameras and Tags are intentionally separate. Cameras lets the user
 * pick specific cameras by name (precision); Tags is the bulk-select
 * affordance (every camera carrying any of the picked tags). When both
 * are populated the caller unions the resulting camera-id sets.
 */
import React from 'react';
import { DateRangePicker } from '../ui/DateRangePicker';
import { MultiSelect, Option } from '../ui/MultiSelect';
import type { DateRange } from './DateRangeFilter';

interface DashboardFiltersProps {
  /** Currently-selected camera options (by id-as-string-value). */
  cameras: Option[];
  onCamerasChange: (cameras: Option[]) => void;
  /** All cameras available in the project, used as the dropdown's options. */
  cameraOptions: { id: number; name: string }[];

  tags: Option[];
  onTagsChange: (tags: Option[]) => void;
  tagOptions: string[];

  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  minDate?: string | null;
  maxDate?: string | null;
}

export const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  cameras,
  onCamerasChange,
  cameraOptions,
  tags,
  onTagsChange,
  tagOptions,
  dateRange,
  onDateRangeChange,
  minDate,
  maxDate,
}) => {
  const cameraSelectOptions: Option[] = cameraOptions.map((c) => ({
    label: c.name,
    value: String(c.id),
  }));
  const tagSelectOptions: Option[] = tagOptions.map((t) => ({ label: t, value: t }));

  return (
    <div className="rounded-lg border bg-card pt-2 pb-3 px-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Cameras
          </label>
          <MultiSelect
            options={cameraSelectOptions}
            value={cameras}
            onChange={onCamerasChange}
            placeholder="All cameras"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Camera tags
          </label>
          <MultiSelect
            options={tagSelectOptions}
            value={tags}
            onChange={onTagsChange}
            placeholder="Any tags"
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
