/**
 * Inline column visibility list, shared by the cameras and sites tables.
 *
 * One row per column. Toggling a row updates visibility immediately so
 * the user can keep picking. "Reset to defaults" at the bottom returns
 * the canonical set. Designed to live inside the FilterBar's Display
 * popover, hence inline (no dropdown wrapper of its own).
 */
import { Check } from 'lucide-react';
import type { ColumnPrefs } from '../../lib/columnPrefs';

interface ColumnPickerProps<C extends string> {
  prefs: ColumnPrefs<C>;
  visible: C[];
  onChange: (ids: C[]) => void;
}

export function ColumnPicker<C extends string>({
  prefs,
  visible,
  onChange,
}: ColumnPickerProps<C>) {
  const visibleSet = new Set(visible);

  const toggle = (id: C) => {
    const next = visibleSet.has(id)
      ? visible.filter((v) => v !== id)
      : [...visible, id];
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <div className="max-h-72 overflow-y-auto rounded-md border border-input">
        {prefs.columns.map((column) => {
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
        onClick={() => onChange(prefs.defaults)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  );
}
