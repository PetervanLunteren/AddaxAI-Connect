/**
 * Bulk-edit row selection, shared by the cameras and sites tables.
 *
 * The Set persists across filter / sort / search changes; the header
 * checkbox only flips what is currently visible (setMany with the visible
 * ids). Pages clear the selection after a successful bulk mutation so the
 * action bar disappears.
 */
import { useCallback, useState } from 'react';

export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const setMany = useCallback((ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  return { selected, toggle, clear, setMany };
}
