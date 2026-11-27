/**
 * A quiet text link under a review window that opens a small panel upward:
 * "Show details" and "Show shortcuts" in image verification.
 *
 * Place it in the flow, not absolutely: those windows scroll once their
 * panel is long, and a bottom-anchored element then lands on top of
 * whatever is under it. Controlled, so a window can close it when it moves
 * to the next item.
 *
 * A click outside or Escape closes it. Escape is caught in the capture
 * phase and stopped, so it closes only the panel and not the window behind
 * it, which has its own Escape listeners (the dialog's and the window's).
 */
import React, { useEffect, useRef } from 'react';
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
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // A ref, so a new callback on every render does not re-add the listeners.
  const toggle = useRef(onToggle);
  toggle.current = onToggle;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) toggle.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      toggle.current();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
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
};

/** One line of a shortcuts panel: the keys, then what they do. */
export const ShortcutRow: React.FC<{ keys: string; children: React.ReactNode }> = ({ keys, children }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{keys}</span>
    <span>{children}</span>
  </div>
);
