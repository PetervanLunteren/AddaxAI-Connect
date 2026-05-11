/**
 * Dashboard filters popover with camera tags and date range
 */
import React, { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '../ui/Button';
import { DateRangePicker } from '../ui/DateRangePicker';
import { MultiSelect, Option } from '../ui/MultiSelect';
import type { DateRange } from './DateRangeFilter';
import { useMobileDropdownTop } from '../../hooks/useMobileDropdownTop';

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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileTop = useMobileDropdownTop(containerRef, isOpen);

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const activeCount =
    tags.length +
    (dateRange.startDate ? 1 : 0) +
    (dateRange.endDate ? 1 : 0);

  const options: Option[] = tagOptions.map((t) => ({ label: t, value: t }));

  const clearAll = () => {
    onTagsChange([]);
    onDateRangeChange({ startDate: null, endDate: null });
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2"
      >
        <Filter className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
            {activeCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div
          className="fixed inset-x-2 z-50 max-h-[80vh] overflow-y-auto rounded-md border bg-background shadow-lg p-4 space-y-4 sm:absolute sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-96 sm:max-h-none"
          style={mobileTop !== null ? { top: `${mobileTop}px` } : undefined}
        >
          {/* Camera tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Camera tags</label>
            <MultiSelect
              options={options}
              value={tags}
              onChange={onTagsChange}
              placeholder="Select tags..."
            />
          </div>

          {/* Date range — single popover with a two-month calendar */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Date range</label>
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

          {/* Clear all */}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};
