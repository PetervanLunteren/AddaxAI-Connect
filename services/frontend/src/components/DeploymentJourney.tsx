/**
 * Deployment journey.
 *
 * A read-only vertical timeline of a camera's or a site's placements, oldest
 * first, so each slideout tells a small story:
 * - camera mode answers "where has this camera lived over time?" (each step is
 *   a site it moved to)
 * - site mode answers "which cameras stood here over time?" (each step is a
 *   camera that was placed here)
 *
 * Site assignment is automatic and corrections normally happen from the
 * camera updates panel. For late corrections, camera mode can pass
 * onChangeSite (admin only), which puts a small action on each step.
 */
import React from 'react';
import { MapPin, Camera, Pencil } from 'lucide-react';

export interface JourneyItem {
  id: number;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  imageCount: number;
}

interface Props {
  mode: 'camera' | 'site';
  items: JourneyItem[];
  emptyText: string;
  // Escape hatch: when given, each step shows a "change site" action.
  onChangeSite?: (item: JourneyItem) => void;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function dateMs(s: string | null): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const t = new Date(s).getTime();
  return isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export const DeploymentJourney: React.FC<Props> = ({ mode, items, emptyText, onChangeSite }) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }

  const Icon = mode === 'camera' ? MapPin : Camera;
  const fallback = mode === 'camera' ? 'Unassigned site' : 'Unknown camera';
  // Oldest first so the list reads top-to-bottom as the story unfolds.
  const ordered = [...items].sort((a, b) => dateMs(a.startDate) - dateMs(b.startDate));

  return (
    <ol className="relative ml-2 border-l border-border">
      {ordered.map((it, i) => {
        // In site mode, a gap between one placement ending and the next
        // starting means no camera recorded here for that stretch. Show it so
        // two rows for the same camera read as "a gap split them", not a
        // duplicate. Only for real, finite date ranges.
        const prev = i > 0 ? ordered[i - 1] : null;
        const start = dateMs(it.startDate);
        const prevEnd = prev ? dateMs(prev.endDate) : Number.NaN;
        const gapDays =
          mode === 'site' && prev && Number.isFinite(start) && Number.isFinite(prevEnd)
            ? Math.round((start - prevEnd) / 86_400_000)
            : 0;

        return (
          <React.Fragment key={it.id}>
            {gapDays >= 1 && (
              <li className="relative ml-5 py-0.5">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full border border-dashed border-border bg-card" />
                <p className="text-xs italic text-muted-foreground">
                  ≈{gapDays} {gapDays === 1 ? 'day' : 'days'} offline
                </p>
              </li>
            )}
            <li className="relative ml-5 pb-4 last:pb-0">
              <span className="absolute -left-[27px] top-3 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
              <div className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate font-medium flex-1">{it.title ?? fallback}</span>
                  {onChangeSite && (
                    <button
                      type="button"
                      onClick={() => onChangeSite(it)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Change site"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Change site
                    </button>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">
                  {fmtDate(it.startDate)} to {it.endDate ? fmtDate(it.endDate) : 'now'}
                </p>
                <p className="text-muted-foreground">{it.imageCount.toLocaleString()} images</p>
              </div>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
};
