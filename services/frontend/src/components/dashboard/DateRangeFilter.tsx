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
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, startDate: e.target.value || null });
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, endDate: e.target.value || null });
  };

  const handleClear = () => {
    onChange({ startDate: null, endDate: null });
  };

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];

  // Helper to get date label
  const getDateLabel = (dateStr: string | null, isEndDate: boolean): string | null => {
    if (!dateStr) return null;

    if (dateStr === today) {
      return '(today)';
    }

    // Calculate days difference from today
    const date = new Date(dateStr);
    const todayDate = new Date(today);
    const diffTime = todayDate.getTime() - date.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && !isEndDate) {
      return `(${diffDays} day${diffDays !== 1 ? 's' : ''} ago)`;
    }

    return null;
  };

  const startLabel = getDateLabel(value.startDate, false);
  const endLabel = getDateLabel(value.endDate, true);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span>Date Range:</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <input
            type="date"
            value={value.startDate || ''}
            onChange={handleStartChange}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {startLabel && (
            <span className="text-xs text-muted-foreground mt-0.5 ml-1">{startLabel}</span>
          )}
        </div>
        <span className="text-muted-foreground">to</span>
        <div className="flex flex-col">
          <input
            type="date"
            value={value.endDate || ''}
            onChange={handleEndChange}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {endLabel && (
            <span className="text-xs text-muted-foreground mt-0.5 ml-1">{endLabel}</span>
          )}
        </div>
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
