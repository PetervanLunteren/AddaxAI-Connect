/**
 * The three-dot menu at the end of a table row, for the actions on that row.
 *
 * Each action shows its icon and a word, so nobody has to guess what a bare
 * icon does. Use it when a row has actions of its own. Tables where a click on
 * the row opens a panel (Cameras, Sites, Service) do not need it.
 *
 * Built on the Popover, which renders outside the table. A menu inside the
 * table would be cut off by the table's scroll container on the last rows.
 */
import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Red, for an action that removes something. Put it last. */
  destructive?: boolean;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  /** What the row is about, for screen readers, for example an email address */
  rowLabel: string;
}

export const RowActionsMenu: React.FC<RowActionsMenuProps> = ({ actions, rowLabel }) => {
  const [open, setOpen] = useState(false);

  // A row with nothing to do gets no button
  if (actions.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={`Actions for ${rowLabel}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              setOpen(false);
              action.onClick();
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
              action.destructive && 'text-destructive',
            )}
          >
            <action.icon className="h-4 w-4" />
            <span>{action.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
