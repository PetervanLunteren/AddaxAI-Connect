/**
 * Sortable column header button, shared by the cameras and sites tables.
 *
 * Generic over the page's column-id union so each page keeps its own typed
 * sort state while rendering the same header everywhere.
 */
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SortState<C extends string> {
  column: C | null;
  direction: 'asc' | 'desc';
}

interface SortableHeaderProps<C extends string> {
  label: string;
  column: C;
  align?: 'left' | 'right';
  sort: SortState<C>;
  onSort: (column: C) => void;
}

export function SortableHeader<C extends string>({
  label,
  column,
  align,
  sort,
  onSort,
}: SortableHeaderProps<C>) {
  const isActive = sort.column === column;
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 hover:text-foreground transition-colors -my-1',
        align === 'right' ? 'ml-auto' : '',
      )}
      onClick={() => onSort(column)}
    >
      {label}
      {isActive ? (
        sort.direction === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
      )}
    </button>
  );
}
