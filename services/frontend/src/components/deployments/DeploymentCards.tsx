/**
 * Deployment cards with everything that sits on them: Edit, the Suspicious
 * marker of a short trip nobody answered, and the corrections that made a card
 * ("Last day set by peter@... on 25 Nov 2026") with Undo. One component for
 * the camera panel and the site panel, which show the same deployments from
 * two sides, as the same card, so a deployment looks and works the same
 * wherever it is met.
 *
 * - Edit opens the Edit deployment form for the card's camera.
 * - Suspicious uses the Deployments page's rows (deploymentRows) on the
 *   same cached list, so card and page agree; the question is answered in
 *   the deployment's window on that page, where the map and photos are.
 * - A correction belongs to the cards of its camera whose days it covers.
 *   Undo takes back the whole edit: a correction is one fact about one
 *   period, so its parts cannot be undone apart. Cards the app placed show
 *   no line.
 *
 * Edit, Undo and Suspicious are for project admins (the endpoints are);
 * others see plain cards, and none of the admin lists is loaded for them.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { deploymentKeys, deploymentsApi, invalidateDeployments, type Correction } from '../../api/deployments';
import { DeploymentJourney, type JourneyItem } from '../DeploymentJourney';
import { cameraPanelHref, deploymentImagesHref, deploymentWindowHref, sitePanelHref } from '../../lib/panel-links';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toaster';
import { errorDetail } from '../../lib/utils';
import { DeploymentStatus } from './DeploymentStatus';
import { dayLabel, today } from './format';
import { covers, deploymentRows, type DeploymentRow } from './rows';
import { SetDeploymentDialog } from './SetDeploymentDialog';

/** One deployment, as both panels have it. */
export interface DeploymentCardData {
  id: number;
  cameraId: number;
  cameraName: string;
  siteId: number | null;
  siteName: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD, null = still there
  imageCount: number;
  lat: number | null;
  lon: number | null;
}

function daysLabel(c: Correction): string {
  return c.until_date
    ? `${c.site_name}, ${dayLabel(c.from_date)} to ${dayLabel(c.until_date)}`
    : `${c.site_name} from ${dayLabel(c.from_date)}`;
}

// "Site", "Last day", "Site and first day", "First and last day": what an
// edit changed, as the start of the line on the card. All three (every
// added deployment, or an edit that changed everything) is a deployment
// set anew, so the line says plainly "Set by", as for older corrections
// that did not record what they changed.
function whatWasSet(changes: string[] | null): string {
  if (!changes || changes.length === 0 || changes.length === 3) return '';
  const site = changes.includes('site');
  const first = changes.includes('first_day');
  const last = changes.includes('last_day');
  const days = first && last ? 'first and last day' : first ? 'first day' : last ? 'last day' : '';
  const text = site && days ? `site and ${days}` : site ? 'site' : days;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setBy(c: Correction): string {
  if (c.source === 'upload') return 'Set by an upload';
  if (c.source === 'carried_over') return 'Kept from before the update';
  const when = dayLabel(c.created_at.slice(0, 10));
  const what = whatWasSet(c.changes);
  const verb = what ? `${what} set` : 'Set';
  return c.created_by ? `${verb} by ${c.created_by} on ${when}` : `${verb} on ${when}`;
}

interface Props {
  projectId: number;
  deployments: DeploymentCardData[];
  canEdit: boolean;
  emptyText: string;
  // In the deployment's own window the Suspicious line would point at
  // itself; the window shows the question instead.
  hideSuspicious?: boolean;
}

export const DeploymentCards: React.FC<Props> = ({
  projectId, deployments, canEdit, emptyText, hideSuspicious = false,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<Correction | null>(null);
  const [editing, setEditing] = useState<DeploymentCardData | null>(null);

  // The admin lists, shared with the Deployments page through their keys.
  const { data: projectDeployments } = useQuery({
    queryKey: deploymentKeys.list(projectId),
    queryFn: () => deploymentsApi.list(projectId),
    enabled: canEdit,
  });
  const { data: corrections = [] } = useQuery({
    queryKey: deploymentKeys.corrections(projectId),
    queryFn: () => deploymentsApi.corrections(projectId),
    enabled: canEdit,
  });

  const suspicious = useMemo(() => new Map<number, DeploymentRow>(
    deploymentRows(projectDeployments ?? [])
      .filter((row) => row.suspicious)
      .map((row) => [row.deployment.id, row]),
  ), [projectDeployments]);

  const undo = useMutation({
    mutationFn: (c: Correction) => deploymentsApi.undoCorrection(projectId, c.id),
    onSuccess: () => {
      invalidateDeployments(queryClient, projectId);
      setRemoving(null);
      toast.success('Undone');
    },
    onError: (error) => toast.error(`Could not undo this. ${errorDetail(error)}`),
  });

  const byId = new Map(deployments.map((d) => [d.id, d]));

  const footer = (item: JourneyItem) => {
    const d = byId.get(item.id)!;
    const row = hideSuspicious ? undefined : suspicious.get(d.id);
    const mine = corrections.filter((c) => covers(c, d.cameraId, d.startDate, d.endDate));
    return (
      <>
        {row && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-xs">
            <DeploymentStatus row={row} />
            <Link
              to={deploymentWindowHref(projectId, d.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              Check this move
            </Link>
          </div>
        )}
        {mine.length > 0 && (
          <ul className="mt-2 space-y-1 border-t pt-2">
            {mine.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                {/* Wraps instead of cutting off: the date at the end matters. */}
                <span className="min-w-0 break-words" title={daysLabel(c)}>{setBy(c)}</span>
                {/* The same look as Edit at the top of the card. */}
                <button
                  type="button"
                  onClick={() => setRemoving(c)}
                  className="tap-target inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  const items: JourneyItem[] = deployments.map((d) => ({
    id: d.id,
    siteName: d.siteName,
    cameraName: d.cameraName,
    cameraHref: cameraPanelHref(projectId, d.cameraId),
    siteHref: d.siteId !== null ? sitePanelHref(projectId, d.siteId) : undefined,
    imagesHref: deploymentImagesHref(projectId, d.cameraId, d.startDate, d.endDate),
    startDate: d.startDate,
    endDate: d.endDate,
    imageCount: d.imageCount,
  }));

  return (
    <>
      <DeploymentJourney
        items={items}
        emptyText={emptyText}
        onEdit={canEdit ? (item) => setEditing(byId.get(item.id) ?? null) : undefined}
        footer={canEdit ? footer : undefined}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && undo.mutate(removing)}
        title="Undo this?"
        body={
          removing ? (
            <>
              {daysLabel(removing)}. The app works out the site of these days again,
              from the GPS or an earlier correction. Photos without GPS in these days
              have no site until it is set again.
            </>
          ) : ''
        }
        confirmLabel="Undo"
        variant="destructive"
        isPending={undo.isPending}
      />

      {editing && (
        <SetDeploymentDialog
          projectId={projectId}
          cameraId={editing.cameraId}
          cameraName={editing.cameraName}
          prefill={{
            deploymentId: editing.id,
            siteId: editing.siteId,
            fromDate: editing.startDate ?? today(),
            untilDate: editing.endDate,
            lat: editing.lat,
            lon: editing.lon,
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
};
