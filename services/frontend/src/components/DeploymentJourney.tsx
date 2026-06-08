/**
 * Deployment journey.
 *
 * A read-only vertical timeline of a camera's or a site's deployments, oldest
 * first, so each slideout tells a small story:
 * - camera mode answers "where has this camera lived over time?" (each step is
 *   a site it moved to)
 * - site mode answers "which cameras stood here over time?" (each step is a
 *   camera that was placed here)
 *
 * Editing deployments lives on the Deployments page, not here. Every step and
 * the footer link open that page pre-filtered to this camera or site, so there
 * is exactly one place to make corrections.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Camera, ChevronRight, Calendar, Image as ImageIcon } from 'lucide-react';

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
  // Deployments page URL pre-filtered to this camera or site.
  linkTo: string;
  emptyText: string;
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

export const DeploymentJourney: React.FC<Props> = ({ mode, items, linkTo, emptyText }) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }

  const Icon = mode === 'camera' ? MapPin : Camera;
  const fallback = mode === 'camera' ? 'Unassigned site' : 'Unknown camera';
  // Oldest first so the list reads top-to-bottom as the story unfolds.
  const ordered = [...items].sort((a, b) => startMs(a.startDate) - startMs(b.startDate));

  return (
    <div className="space-y-3">
      <ol className="relative ml-2 border-l border-border">
        {ordered.map((it) => (
          <li key={it.id} className="relative ml-5 pb-4 last:pb-0">
            <span className="absolute -left-[27px] top-3 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
            <Link
              to={linkTo}
              className="block rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 font-medium min-w-0">
                <Icon className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{it.title ?? fallback}</span>
              </div>
              <div className="mt-1 space-y-1">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  {fmtDate(it.startDate)} to {it.endDate ? fmtDate(it.endDate) : 'now'}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                  {it.imageCount.toLocaleString()} images
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <Link
        to={linkTo}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        Open in Deployments
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
};
