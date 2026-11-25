/**
 * A list of deployment cards: one card per deployment, oldest first, on a
 * timeline. The one picture of a deployment in the app. DeploymentCards
 * puts Edit, Undo and the Suspicious marker on it (camera and site panels);
 * the Edit deployment form uses it plain, for its Now and After saving
 * cards.
 *
 * A deployment is a camera at a site for a period, seen from either side:
 * - camera mode: one camera's deployments; a card's title is the site
 * - site mode: one site's deployments; a card's title is the camera
 *
 * One card per deployment, never merged: a card is what Edit acts on. Days
 * are printed with dayLabel, which never shifts a day across time zones.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Camera, Pencil } from 'lucide-react';
import { dayLabel } from './deployments/moves';

export interface JourneyItem {
  id: number;
  title: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD, null = still there
  imageCount: number;
  // Where the title leads (site mode: the camera's panel).
  href?: string;
}

interface Props {
  mode: 'camera' | 'site';
  items: JourneyItem[];
  emptyText: string;
  // When given, each card shows Edit.
  onEdit?: (item: JourneyItem) => void;
  // Lines at the foot of a card (the Suspicious marker, the corrections
  // that made it, with Undo).
  footer?: (item: JourneyItem) => React.ReactNode;
  // A card drawn quieter: the form's Now card, or cards still loading.
  dimmed?: boolean;
}

export const DeploymentJourney: React.FC<Props> = ({ mode, items, emptyText, onEdit, footer, dimmed = false }) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }

  const Icon = mode === 'camera' ? MapPin : Camera;
  const fallback = mode === 'camera' ? 'No site' : 'Unknown camera';
  // Oldest first so the list reads top-to-bottom as the story unfolds.
  const ordered = [...items].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

  return (
    <ol className={`relative ml-2 border-l border-border ${dimmed ? 'opacity-60' : ''}`}>
      {ordered.map((it) => (
        <li key={it.id} className="relative ml-5 pb-4 last:pb-0">
          <span className="absolute -left-[27px] top-3 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
          <div className="rounded-md border p-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 text-primary shrink-0" />
              {it.href ? (
                <Link to={it.href} className="truncate font-medium flex-1 hover:underline">
                  {it.title ?? fallback}
                </Link>
              ) : (
                <span className="truncate font-medium flex-1">{it.title ?? fallback}</span>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(it)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              {it.startDate ? dayLabel(it.startDate) : '-'} to {it.endDate ? dayLabel(it.endDate) : 'now'}
            </p>
            <p className="text-muted-foreground">{it.imageCount.toLocaleString()} images</p>
            {footer?.(it)}
          </div>
        </li>
      ))}
    </ol>
  );
};
