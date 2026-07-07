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

function startMs(s: string | null): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const t = new Date(s).getTime();
  return isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Collapse consecutive steps with the same title into one tenure.
 *
 * The same camera at one site (or one camera staying at the same site) can span
 * several deployment records, split by a GPS re-pin or a gap crossing the split
 * threshold. That split is a system detail. Reading it as the camera leaving and
 * coming back is wrong, and gaps already live on the timeline, not here. So a
 * new row appears only when the title actually changes. Only consecutive runs
 * merge, so a camera that leaves and later returns still reads as two tenures.
 * Items must be sorted oldest first.
 */
function mergeConsecutive(items: JourneyItem[]): JourneyItem[] {
  const merged: JourneyItem[] = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && last.title === it.title) {
      // Extend the tenure to the later placement (null end means ongoing) and
      // pool the images. startDate stays the earliest, since items are ordered.
      last.endDate = it.endDate;
      last.imageCount += it.imageCount;
    } else {
      merged.push({ ...it });
    }
  }
  return merged;
}

export const DeploymentJourney: React.FC<Props> = ({ mode, items, emptyText, onChangeSite }) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }

  const Icon = mode === 'camera' ? MapPin : Camera;
  const fallback = mode === 'camera' ? 'Unassigned site' : 'Unknown camera';
  // Oldest first so the list reads top-to-bottom as the story unfolds.
  const ordered = [...items].sort((a, b) => startMs(a.startDate) - startMs(b.startDate));
  // Site mode reads as "which cameras stood here", so collapse a camera's
  // consecutive placements into one row. Camera mode keeps each placement,
  // because its change-site escape hatch acts on a single one.
  const steps = mode === 'site' ? mergeConsecutive(ordered) : ordered;

  return (
    <ol className="relative ml-2 border-l border-border">
      {steps.map((it) => (
        <li key={it.id} className="relative ml-5 pb-4 last:pb-0">
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
      ))}
    </ol>
  );
};
