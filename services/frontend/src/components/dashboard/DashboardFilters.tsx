/**
 * Dashboard filters popover with camera tag selection
 */
import React, { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '../ui/Button';
import { MultiSelect, Option } from '../ui/MultiSelect';

interface DashboardFiltersProps {
  tags: Option[];
  onTagsChange: (tags: Option[]) => void;
  tagOptions: string[];
}

export const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  tags,
  onTagsChange,
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

  const activeCount = tags.length;
  const options: Option[] = tagOptions.map((t) => ({ label: t, value: t }));

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
        <div className="absolute right-0 mt-2 w-72 border rounded-md bg-background shadow-lg z-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Camera tags</label>
            {tags.length > 0 && (
              <button
                type="button"
                onClick={() => onTagsChange([])}
                className="text-xs text-muted-foreground hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <MultiSelect
            options={options}
            value={tags}
            onChange={onTagsChange}
            placeholder="Select tags..."
          />
        </div>
      )}
    </div>
  );
};
