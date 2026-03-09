/**
 * Camera page filters popover — matches the ImageFilters pattern
 */
import React, { useState, useRef, useEffect } from 'react';
import { Filter, ChevronDown } from 'lucide-react';
import { Button } from './ui/Button';
import { MultiSelect, Option } from './ui/MultiSelect';

export interface CameraFilterState {
  status: Option[];
  tags: Option[];
  battery: string;
  signal: string;
  sd_usage: string;
  location: string;
}

export const defaultCameraFilters: CameraFilterState = {
  status: [],
  tags: [],
  battery: '',
  signal: '',
  sd_usage: '',
  location: '',
};

interface CameraFiltersProps {
  filters: CameraFilterState;
  onFilterChange: (key: keyof CameraFilterState, value: any) => void;
  onClearAll: () => void;
  tagOptions: Option[];
}

const statusOptions: Option[] = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Never reported', value: 'never_reported' },
];

const SelectDropdown: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}> = ({ label, value, onChange, options }) => (
  <div className="space-y-2">
    <label className="text-sm font-medium">{label}</label>
    <div className="relative">
      <select
        className="w-full h-9 px-3 pr-8 border border-input rounded-md bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    </div>
  </div>
);

export const CameraFilters: React.FC<CameraFiltersProps> = ({
  filters,
  onFilterChange,
  onClearAll,
  tagOptions,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    filters.status.length +
    filters.tags.length +
    (filters.battery ? 1 : 0) +
    (filters.signal ? 1 : 0) +
    (filters.sd_usage ? 1 : 0) +
    (filters.location ? 1 : 0);

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
        <div className="absolute right-0 mt-2 w-80 border rounded-md bg-background shadow-lg z-50 p-4 space-y-4">
          {/* Status */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <MultiSelect
              options={statusOptions}
              value={filters.status}
              onChange={(selected) => onFilterChange('status', selected)}
              placeholder="Select status..."
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <MultiSelect
              options={tagOptions}
              value={filters.tags}
              onChange={(selected) => onFilterChange('tags', selected)}
              placeholder="Select tags..."
            />
          </div>

          {/* Battery */}
          <SelectDropdown
            label="Battery"
            value={filters.battery}
            onChange={(v) => onFilterChange('battery', v)}
            options={[
              { label: 'Low (<30%)', value: 'low' },
              { label: 'Medium (30-70%)', value: 'medium' },
              { label: 'High (>70%)', value: 'high' },
              { label: 'Unknown', value: 'unknown' },
            ]}
          />

          {/* Signal quality */}
          <SelectDropdown
            label="Signal quality"
            value={filters.signal}
            onChange={(v) => onFilterChange('signal', v)}
            options={[
              { label: 'Excellent (20+)', value: 'excellent' },
              { label: 'Good (15-19)', value: 'good' },
              { label: 'Fair (10-14)', value: 'fair' },
              { label: 'Poor (2-9)', value: 'poor' },
              { label: 'No signal (0-1)', value: 'no_signal' },
              { label: 'Unknown', value: 'unknown' },
            ]}
          />

          {/* SD usage */}
          <SelectDropdown
            label="SD usage"
            value={filters.sd_usage}
            onChange={(v) => onFilterChange('sd_usage', v)}
            options={[
              { label: 'Low (<50%)', value: 'low' },
              { label: 'Medium (50-80%)', value: 'medium' },
              { label: 'High (>80%)', value: 'high' },
              { label: 'Unknown', value: 'unknown' },
            ]}
          />

          {/* Location */}
          <SelectDropdown
            label="Location"
            value={filters.location}
            onChange={(v) => onFilterChange('location', v)}
            options={[
              { label: 'Known', value: 'known' },
              { label: 'Unknown', value: 'unknown' },
            ]}
          />

          {/* Clear all */}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
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
