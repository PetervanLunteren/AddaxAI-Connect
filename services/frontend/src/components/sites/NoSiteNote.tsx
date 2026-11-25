/**
 * Says that a view leaves out photos without a site. Maps, occupancy, the
 * timeline, the trend per trap-night and three exports need a place, and
 * a photo of a camera without GPS has none until a person sets its site.
 * They are left out there (never given a made-up place), and the view
 * says how many, so a number that differs from the dashboard has its
 * reason next to it.
 *
 * Quiet on purpose: the nudge to fix it is in Needs attention. A project
 * admin gets a link to the cameras with such photos; others only the
 * sentence, they cannot set a site.
 *
 * - useNoSiteText gives the sentence as one part of a card's info line
 *   (CardCaption), null when there is nothing to say.
 * - NoSiteNote is the same as a line of its own, for a card without an
 *   info line (the Dashboard trend).
 * - The Exports page asks with ConfirmDialog before a download that
 *   leaves photos out, with NoSiteText as the body.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useUnplacedPhotos } from '../../hooks/useUnplacedPhotos';

/** What the photos miss, for one photo and for more. */
export type Consequence = [one: string, many: string];

export function noSiteSentence(count: number, [one, many]: Consequence): string {
  return count === 1
    ? `1 photo has no site yet and ${one}.`
    : `${count.toLocaleString()} photos have no site yet and ${many}.`;
}

/** The sentence and, for a project admin, the link to fix it. */
export const NoSiteText: React.FC<{ projectId: number; count: number; consequence: Consequence }> = ({
  projectId, count, consequence,
}) => {
  const { isProjectAdmin } = useProject();
  return (
    <span>
      {noSiteSentence(count, consequence)}
      {isProjectAdmin && (
        <>
          {' '}
          <Link to={`/projects/${projectId}/cameras?unplaced=yes`} className="underline hover:text-foreground">
            Set their site
          </Link>
        </>
      )}
    </span>
  );
};

/**
 * The sentence for a card's info line, or null: no such photos, a viewer
 * who never sees them, or a page with a site filter (hidden; the user
 * chose places, so these photos are out of every view anyway).
 */
export function useNoSiteText(
  projectId: number | undefined,
  consequence: Consequence,
  hidden = false,
): React.ReactNode | null {
  const count = useUnplacedPhotos(projectId);
  if (hidden || !count || projectId === undefined) return null;
  return <NoSiteText projectId={projectId} count={count} consequence={consequence} />;
}

interface Props {
  projectId: number | undefined;
  consequence: Consequence;
  hidden?: boolean;
  className?: string;
}

export const NoSiteNote: React.FC<Props> = ({ projectId, consequence, hidden = false, className = '' }) => {
  const text = useNoSiteText(projectId, consequence, hidden);
  if (!text) return null;
  return (
    <p className={`flex items-start gap-2 text-xs text-muted-foreground ${className}`}>
      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
      {text}
    </p>
  );
};
