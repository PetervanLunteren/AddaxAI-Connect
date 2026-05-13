/**
 * Inline column visibility list for the cameras table.
 *
 * One row per column. Toggling a row updates visibility immediately so
 * the user can keep picking. "Reset to defaults" at the bottom returns
 * the canonical set. Designed to live inside the FilterBar's Display
 * popover, hence inline (no dropdown wrapper of its own).
 */
import React from 'react';
import { Check } from 'lucide-react';
import {
  CAMERA_COLUMNS,
  DEFAULT_VISIBLE,
  type ColumnId,
} from './columnDefs';

interface ColumnPickerProps {
  visible: ColumnId[];
  onChange: (ids: ColumnId[]) => void;
}

export const ColumnPicker: React.FC<ColumnPickerProps> = ({ visible, onChange }) => {
  const visibleSet = new Set(visible);

  const toggle = (id: ColumnId) => {
    const next = visibleSet.has(id)
      ? visible.filter((v) => v !== id)
      : [...visible, id];
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <div className="max-h-72 overflow-y-auto rounded-md border border-input">
        {CAMERA_COLUMNS.map((column) => {
          const checked = visibleSet.has(column.id);
          const locked = column.alwaysVisible === true;
          return (
            <button
              key={column.id}
              type="button"
              onClick={() => {
                if (!locked) toggle(column.id);
              }}
              disabled={locked}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                locked ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent'
              }`}
              title={locked ? 'Always shown' : undefined}
            >
              <span className="w-4 h-4 inline-flex items-center justify-center rounded border border-input">
                {checked && <Check className="h-3 w-3 text-primary" />}
              </span>
              <span className="flex-1">{column.label}</span>
              {locked && (
                <span className="text-xs text-muted-foreground">always</span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange(DEFAULT_VISIBLE)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  );
};
