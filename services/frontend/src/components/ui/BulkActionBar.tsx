/**
 * The bar above a table while rows are selected, shared by the cameras,
 * sites and service tables. The page passes its action buttons as
 * children; the count and the Cancel button that clears the selection are
 * the same everywhere.
 */
import React from 'react';
import { Button } from './Button';

interface BulkActionBarProps {
  selected: number;
  total: number;
  /** Plural noun, e.g. "cameras". */
  noun: string;
  onClear: () => void;
  children: React.ReactNode;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({ selected, total, noun, onClear, children }) => (
  <div className="flex items-center gap-3 p-3 mb-3 bg-muted rounded-md flex-wrap">
    <span className="text-sm font-medium">
      {selected} of {total} {noun} selected
    </span>
    <div className="flex gap-2 flex-wrap ml-auto">
      {children}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Cancel
      </Button>
    </div>
  </div>
);
