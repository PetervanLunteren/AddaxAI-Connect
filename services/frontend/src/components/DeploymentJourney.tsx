/**
 * A list of deployment cards: one card per deployment, oldest first, on a
 * timeline. The one picture of a deployment in the app. DeploymentCards
 * puts Edit, Undo and the Suspicious marker on it (camera and site panels);
 * the Edit deployment form uses it plain, for its Now and After saving
 * cards.
 *
 * A card always reads the same, wherever it is: the site, the camera, the
 * period and the number of photos, each on its own line with its icon, in
 * that order. Inside a panel one of the names repeats the panel's heading;
 * that is the price of a card that never changes shape. Both names link to
 * their panel, the photo count to those photos (lib/panel-links.ts).
 *
 * One card per deployment, never merged: a card is what Edit acts on. Days
 * are printed with dayLabel, which never shifts a day across time zones.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Camera, Images, MapPin, Pencil } from 'lucide-react';
import { dayLabel } from './deployments/moves';

export interface JourneyItem {
  id: number;
  siteName: string | null;
  cameraName: string;
  // The camera's and the site's panels, when the card may link there (not
  // in the Edit deployment form: leaving it would lose the edit).
  cameraHref?: string;
  siteHref?: string;
  // The deployment's photos on the Images page.
  imagesHref?: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD, null = still there
  imageCount: number;
}

interface Props {
  items: JourneyItem[];
  emptyText: string;
  // When given, each card shows Edit.
  onEdit?: (item: JourneyItem) => void;
  // Lines at the foot of a card (the Suspicious marker, the corrections
  // that made it, with Undo).
  footer?: (item: JourneyItem) => React.ReactNode;
  // Cards drawn quieter: the form's cards while a newer preview loads.
  dimmed?: boolean;
}

const Row: React.FC<{ icon: React.ElementType; children: React.ReactNode; strong?: boolean }> = ({
  icon: Icon, children, strong = false,
}) => (
  <div className={`flex items-center gap-2 min-w-0 ${strong ? 'font-medium' : 'text-muted-foreground'}`}>
    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    <span className="truncate">{children}</span>
  </div>
);

export const DeploymentJourney: React.FC<Props> = ({ items, emptyText, onEdit, footer, dimmed = false }) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }

  // Oldest first so the list reads top-to-bottom as the story unfolds.
  const ordered = [...items].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

  return (
    <ol className={`relative ml-2 border-l border-border ${dimmed ? 'opacity-60' : ''}`}>
      {ordered.map((it) => (
        <li key={it.id} className="relative ml-5 pb-4 last:pb-0">
          <span className="absolute -left-[27px] top-3 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
          <div className="rounded-md border bg-card p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <Row icon={MapPin} strong>
                  {it.siteHref ? (
                    <Link to={it.siteHref} className="hover:underline">{it.siteName ?? 'No site'}</Link>
                  ) : (
                    it.siteName ?? 'No site'
                  )}
                </Row>
              </div>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(it)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              )}
            </div>
            <Row icon={Camera}>
              {it.cameraHref ? (
                <Link to={it.cameraHref} className="hover:text-foreground hover:underline">{it.cameraName}</Link>
              ) : (
                it.cameraName
              )}
            </Row>
            <Row icon={Calendar}>
              {it.startDate ? dayLabel(it.startDate) : '-'} to {it.endDate ? dayLabel(it.endDate) : 'now'}
            </Row>
            <Row icon={Images}>
              {it.imagesHref ? (
                <Link to={it.imagesHref} className="hover:text-foreground hover:underline">
                  {it.imageCount.toLocaleString()} images
                </Link>
              ) : (
                `${it.imageCount.toLocaleString()} images`
              )}
            </Row>
            {footer?.(it)}
          </div>
        </li>
      ))}
    </ol>
  );
};
