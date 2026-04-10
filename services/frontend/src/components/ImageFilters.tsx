/**
 * Image page filters popover — matches the DashboardFilters pattern
 */
import React, { useState, useRef, useEffect } from 'react';
import { Filter, ChevronDown } from 'lucide-react';
import { Button } from './ui/Button';
import { MultiSelect, Option } from './ui/MultiSelect';

interface ImageFiltersProps {
  filters: {
    camera_ids: Option[];
    tags: Option[];
    start_date: string;
    end_date: string;
    species: Option[];
    verified: '' | 'true' | 'false';
  };
  onFilterChange: (key: string, value: any) => void;
  onClearAll: () => void;
  cameraOptions: Option[];
  tagOptions: Option[];
  speciesOptions: Option[];
  speciesLoading?: boolean;
  minDate?: string | null;
  maxDate?: string | null;
  defaultOpen?: boolean;
}

export const ImageFilters: React.FC<ImageFiltersProps> = ({
  filters,
  onFilterChange,
  onClearAll,
  cameraOptions,
  tagOptions,
  speciesOptions,
  speciesLoading,
  minDate,
  maxDate,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
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
    filters.camera_ids.length +
    filters.tags.length +
    filters.species.length +
    (filters.start_date ? 1 : 0) +
    (filters.end_date ? 1 : 0) +
    (filters.verified ? 1 : 0);

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
        <div className="absolute right-0 mt-2 w-96 border rounded-md bg-background shadow-lg z-50 p-4 space-y-4">
          {/* Cameras */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Cameras</label>
            <MultiSelect
              options={cameraOptions}
              value={filters.camera_ids}
              onChange={(selected) => onFilterChange('camera_ids', selected)}
              placeholder="Select cameras..."
            />
          </div>

          {/* Camera tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Camera tags</label>
            <MultiSelect
              options={tagOptions}
              value={filters.tags}
              onChange={(selected) => onFilterChange('tags', selected)}
              placeholder="Select tags..."
            />
          </div>

          {/* Labels (species + person/vehicle + empty) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Labels</label>
            <MultiSelect
              options={speciesOptions}
              value={filters.species}
              onChange={(selected) => onFilterChange('species', selected)}
              placeholder="Select labels..."
              isLoading={speciesLoading}
            />
          </div>

          {/* Verification */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Verification</label>
            <div className="relative">
              <select
                className="w-full h-9 px-3 pr-8 border border-input rounded-md bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={filters.verified}
                onChange={(e) => onFilterChange('verified', e.target.value)}
              >
                <option value="">All</option>
                <option value="false">Unverified</option>
                <option value="true">Verified</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Date range */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Date range</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.start_date}
                onChange={(e) => onFilterChange('start_date', e.target.value)}
                min={minDate || undefined}
                max={maxDate || undefined}
                className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={filters.end_date}
                onChange={(e) => onFilterChange('end_date', e.target.value)}
                min={minDate || undefined}
                max={maxDate || undefined}
                className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

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
