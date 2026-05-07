/**
 * Column visibility picker for the cameras table.
 *
 * "Columns" button next to the existing Filters control. Opens a dropdown
 * with one row per column. Toggling a row updates visibility immediately,
 * the menu stays open so the user can continue picking. Footer "Reset to
 * defaults" closes the menu and returns the canonical set.
 */
import React from 'react';
import { ChevronDown, Check, Columns3 } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/DropdownMenu';
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <Columns3 className="h-4 w-4 mr-1.5" />
          Columns
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="min-w-[12rem]">
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
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  locked ? 'cursor-not-allowed opacity-60' : 'hover:bg-gray-100'
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
          <div className="border-t my-1" />
          <DropdownMenuItem
            onClick={() => onChange(DEFAULT_VISIBLE)}
            className="text-sm"
          >
            Reset to defaults
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
