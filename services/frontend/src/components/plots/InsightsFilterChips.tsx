/**
 * Active filter chips for the Insights pages.
 *
 * Each Insights page composes its own chips from the active filter values
 * and passes them in alongside an onClearAll handler that resets data
 * filters but leaves display-mode controls (sort, density, view mode,
 * base layer, etc.) untouched.
 *
 * Adapted from AddaxAI WebUI's InsightsFilterChips. Connect has no `Badge`
 * UI primitive yet, so the chip styling is inlined with Tailwind classes.
 */

import { X } from "lucide-react";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface InsightsFilterChipsProps {
  chips: FilterChip[];
  onClearAll: () => void;
}

export function InsightsFilterChips({
  chips,
  onClearAll,
}: InsightsFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-xs"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="ml-0.5 rounded-full hover:bg-black/10 p-0.5"
            aria-label={`Remove filter ${chip.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Clear all
      </button>
    </div>
  );
}

/** Date-range chip builder. Emits 0, 1, or 2 chips depending on which
 *  bounds are set. */
export function dateChips(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  setDateFrom: (v: string | undefined) => void,
  setDateTo: (v: string | undefined) => void,
): FilterChip[] {
  const out: FilterChip[] = [];
  if (dateFrom) {
    out.push({
      key: "date_from",
      label: `From ${dateFrom}`,
      onRemove: () => setDateFrom(undefined),
    });
  }
  if (dateTo) {
    out.push({
      key: "date_to",
      label: `To ${dateTo}`,
      onRemove: () => setDateTo(undefined),
    });
  }
  return out;
}
