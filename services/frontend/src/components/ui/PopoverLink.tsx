/**
 * A quiet text link under a review window that opens a small panel upward:
 * "Show details" and "Show shortcuts" in image verification, "Show
 * shortcuts" in the camera updates check.
 *
 * Place it in the flow, not absolutely: those windows scroll once their
 * panel is long, and a bottom-anchored element then lands on top of
 * whatever is under it. Controlled, so a window can close it when it moves
 * to the next item.
 */
import React from 'react';
import { cn } from '../../lib/utils';

interface PopoverLinkProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Width of the panel, a Tailwind class. */
  width?: string;
  className?: string;
  children: React.ReactNode;
}

export const PopoverLink: React.FC<PopoverLinkProps> = ({
  label,
  open,
  onToggle,
  width = 'min-w-[230px]',
  className,
  children,
}) => (
  <div className={cn('relative', className)}>
    <button
      type="button"
      onClick={onToggle}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
    </button>
    {open && (
      <div className={cn('absolute bottom-6 right-0 bg-background border border-border rounded-md shadow-lg p-3 z-50', width)}>
        <div className="text-xs space-y-1">{children}</div>
      </div>
    )}
  </div>
);

/** One line of a shortcuts panel: the keys, then what they do. */
export const ShortcutRow: React.FC<{ keys: string; children: React.ReactNode }> = ({ keys, children }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{keys}</span>
    <span>{children}</span>
  </div>
);
