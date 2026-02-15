/**
 * MultiSelect component with popover checkbox list
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Search, Loader2 } from 'lucide-react';

export interface Option {
  label: string;
  value: string | number;
}

interface MultiSelectProps {
  options: Option[];
  value: Option[];
  onChange: (selected: Option[]) => void;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  isLoading = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const selectedValues = useMemo(
    () => new Set(value.map(v => v.value)),
    [value]
  );

  const filteredOptions = useMemo(
    () => options.filter(opt => opt.label.toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const toggleOption = (opt: Option) => {
    if (selectedValues.has(opt.value)) {
      onChange(value.filter(v => v.value !== opt.value));
    } else {
      onChange([...value, opt]);
    }
  };

  const selectAllVisible = () => {
    const toAdd = filteredOptions.filter(opt => !selectedValues.has(opt.value));
    onChange([...value, ...toAdd]);
  };

  const clearAllVisible = () => {
    const visibleValues = new Set(filteredOptions.map(opt => opt.value));
    onChange(value.filter(v => !visibleValues.has(v.value)));
  };

  const triggerLabel = value.length > 0
    ? `${value.length} selected`
    : placeholder;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full border border-input rounded-md h-10 px-3 text-sm bg-background hover:border-input focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className={value.length > 0 ? 'text-foreground' : 'text-muted-foreground'}>
          {triggerLabel}
        </span>
        {isOpen
          ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 border border-input rounded-md bg-background shadow-lg z-50">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2 border-b">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>

              {/* Select all / Clear all */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearAllVisible}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Clear all
                </button>
              </div>

              {/* Checkbox list */}
              <div className="max-h-60 overflow-y-auto">
                {filteredOptions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                    No results
                  </div>
                ) : (
                  filteredOptions.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedValues.has(opt.value)}
                        onChange={() => toggleOption(opt)}
                        className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                      />
                      {opt.label}
                    </label>
                  ))
                )}
              </div>

              {/* Footer count */}
              <div className="px-3 py-1.5 border-t text-xs text-muted-foreground">
                {value.length} of {options.length} selected
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
