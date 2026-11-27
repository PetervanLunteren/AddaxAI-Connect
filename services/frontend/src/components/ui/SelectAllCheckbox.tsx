/**
 * Header checkbox for bulk-selection tables.
 *
 * Checked when every visible row is selected, indeterminate when only some
 * are. Toggling selects or deselects the visible rows only, leaving rows
 * hidden by the current filters untouched.
 */

interface SelectAllCheckboxProps<K> {
  visibleIds: K[];
  selected: Set<K>;
  onToggle: (ids: K[], on: boolean) => void;
  ariaLabel: string;
}

export function SelectAllCheckbox<K = number>({
  visibleIds,
  selected,
  onToggle,
  ariaLabel,
}: SelectAllCheckboxProps<K>) {
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected && !allSelected;
      }}
      onChange={(e) => onToggle(visibleIds, e.target.checked)}
      className="w-4 h-4 cursor-pointer accent-primary"
    />
  );
}
