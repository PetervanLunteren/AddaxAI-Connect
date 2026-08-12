/**
 * MultiSelect component with popover checkbox list.
 *
 * The dropdown panel is rendered in a portal to document.body with fixed
 * positioning anchored to the trigger. That keeps it from being clipped
 * when the MultiSelect sits inside a scrollable, overflow-hidden
 * container such as a Dialog. It opens upward when there is more room
 * above the trigger than below, and follows the trigger on scroll and
 * resize.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  // Noun shown in the trigger when one or more items are selected, e.g.
  // selectedNoun="labels" produces "20 labels selected". Defaults to a plain
  // "N selected" so existing call sites keep their current text.
  selectedNoun?: string;
}

// The panel prefers to open downward; it flips up only when the space
// below is tighter than this and there is more room above.
const PANEL_MAX_HEIGHT = 360;
const VIEWPORT_GAP = 8;
const TRIGGER_GAP = 4;

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  isLoading = false,
  className = '',
  selectedNoun,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP;
    const spaceAbove = rect.top - VIEWPORT_GAP;
    const openUp = spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(0, available));
    if (openUp) {
      setMenuPos({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + TRIGGER_GAP,
        maxHeight,
      });
    } else {
      setMenuPos({
        left: rect.left,
        width: rect.width,
        top: rect.bottom + TRIGGER_GAP,
        maxHeight,
      });
    }
  }, []);

  // Position the panel while open and keep it anchored to the trigger as
  // the page or any scroll container moves (capture catches ancestor
  // scrolls, including a Dialog's own overflow).
  useEffect(() => {
    if (!isOpen) {
      setMenuPos(null);
      return;
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Close on click outside. The panel lives in a portal, so both the
  // trigger container and the panel must count as "inside".
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
      setSearch('');
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Close on Escape. Stop the event when the panel is open so it closes
  // the dropdown only, not an enclosing dialog (which would discard the
  // edit). Capture phase, to win over the dialog's own document listener.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation();
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
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

  // When the caller passes selectedNoun, the trigger always shows the count
  // ('0 cameras selected', '5 cameras selected'). The placeholder only kicks
  // in for callers that did not opt into the named-count format.
  const triggerLabel = selectedNoun
    ? `${value.length} ${selectedNoun} selected`
    : value.length > 0
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
        <span className="text-foreground">{triggerLabel}</span>
        {isOpen
          ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {/* Dropdown, portaled to the body so a Dialog's overflow cannot clip it */}
      {isOpen && menuPos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            left: menuPos.left,
            width: menuPos.width,
            top: menuPos.top,
            bottom: menuPos.bottom,
            maxHeight: menuPos.maxHeight,
          }}
          className="z-50 flex flex-col overflow-hidden border border-input rounded-md bg-background shadow-lg"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>

              {/* Select all / Clear all */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b flex-shrink-0">
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
              <div className="flex-1 min-h-0 overflow-y-auto">
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
              <div className="px-3 py-1.5 border-t text-xs text-muted-foreground flex-shrink-0">
                {value.length} of {options.length} selected
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};
