/**
 * Global date range filter for dashboard charts
 */
import React from 'react';
import { Calendar } from 'lucide-react';

export interface DateRange {
  startDate: string | null;
  endDate: string | null;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  minDate?: string | null;  // YYYY-MM-DD
  maxDate?: string | null;  // YYYY-MM-DD
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange, minDate, maxDate }) => {
  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, startDate: e.target.value || null });
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, endDate: e.target.value || null });
  };

  const handleClear = () => {
    onChange({ startDate: null, endDate: null });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span>Date range</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={value.startDate || ''}
          onChange={handleStartChange}
          min={minDate || undefined}
          max={maxDate || undefined}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <span className="text-muted-foreground">to</span>
        <input
          type="date"
          value={value.endDate || ''}
          onChange={handleEndChange}
          min={minDate || undefined}
          max={maxDate || undefined}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        {(value.startDate || value.endDate) && (
          <button
            onClick={handleClear}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};
