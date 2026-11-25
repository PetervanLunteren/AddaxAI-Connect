/**
 * Deployment cards with everything that sits on them: Edit, the Suspicious
 * marker of a move nobody checked, and the corrections that made a card
 * ("Last day set by peter@... on 25 Nov 2026") with Undo. One component for
 * the camera panel and the site panel, which show the same deployments from
 * two sides, as the same card, so a deployment looks and works the same
 * wherever it is met.
 *
 * - Edit opens the Edit deployment form for the card's camera.
 * - Suspicious uses the Moves page's rule (moveRows) on the same cached
 *   list, so card and page agree; the answer stays on the Moves page.
 * - A correction belongs to the cards of its camera whose days it covers.
 *   Undo takes back the whole edit: a correction is one fact about one
 *   period, so its parts cannot be undone apart. Cards the app placed show
 *   no line. In the code a correction is a fixed period (a statement); the
 *   screens never say so.
 *
 * Edit, Undo and Suspicious are for project admins (the endpoints are);
 * others see plain cards, and none of the admin lists is loaded for them.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { camerasApi } from '../../api/cameras';
import { deploymentsApi, type FixedPeriod } from '../../api/deployments';
import type { Camera } from '../../api/types';
import { DeploymentJourney, type JourneyItem } from '../DeploymentJourney';
import { cameraPanelHref, sitePanelHref } from '../../lib/panel-links';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toaster';
import { MoveStatus } from './MoveStatus';
import { dayLabel, moveRows, type MoveRow } from './moves';
import { SetDeploymentDialog, type SetDeploymentPrefill } from './SetDeploymentDialog';

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

function daysLabel(p: FixedPeriod): string {
  return p.until_date
    ? `${p.site_name}, ${dayLabel(p.from_date)} to ${dayLabel(p.until_date)}`
    : `${p.site_name} from ${dayLabel(p.from_date)}`;
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

function setBy(p: FixedPeriod): string {
  if (p.source === 'upload') return 'Set by an upload';
  if (p.source === 'carried_over') return 'Kept from before the update';
  const when = dayLabel(p.created_at.slice(0, 10));
  const what = whatWasSet(p.changes);
  const verb = what ? `${what} set` : 'Set';
  return p.created_by ? `${verb} by ${p.created_by} on ${when}` : `${verb} on ${when}`;
}

/** Whether a correction covers part of a card's days (null = open). */
const covers = (p: FixedPeriod, d: DeploymentCardData) =>
  p.camera_id === d.cameraId && d.startDate !== null &&
  (p.until_date === null || p.until_date >= d.startDate) &&
  (d.endDate === null || p.from_date <= d.endDate);

interface Props {
  projectId: number;
  deployments: DeploymentCardData[];
  canEdit: boolean;
  emptyText: string;
}

export const DeploymentCards: React.FC<Props> = ({ projectId, deployments, canEdit, emptyText }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<FixedPeriod | null>(null);
  const [editing, setEditing] = useState<{ camera: Camera; prefill: SetDeploymentPrefill } | null>(null);

  // The admin lists, all under the keys the Moves and Cameras pages use.
  const { data: projectDeployments } = useQuery({
    queryKey: ['deployments', projectId, 'overview'],
    queryFn: () => deploymentsApi.list(projectId),
    enabled: canEdit,
  });
  const { data: corrections = [] } = useQuery({
    queryKey: ['fixed-periods', 'project', projectId],
    queryFn: () => deploymentsApi.fixedPeriods(projectId),
    enabled: canEdit,
  });
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: canEdit,
  });

  const suspicious = useMemo(() => new Map<number, MoveRow>(
    moveRows(projectDeployments ?? [])
      .filter((it) => it.suspicious && it.deployment)
      .map((it) => [it.deployment!.id, it]),
  ), [projectDeployments]);

  const remove = useMutation({
    mutationFn: (p: FixedPeriod) => deploymentsApi.removeFixedPeriod(projectId, p.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
      setRemoving(null);
      toast.success('Undone');
    },
    onError: (error: any) => {
      toast.error(`Could not undo this. ${error.response?.data?.detail || error.message || ''}`);
    },
  });

  const byId = new Map(deployments.map((d) => [d.id, d]));
  const cameraOf = (d: DeploymentCardData) => cameras.find((c) => c.id === d.cameraId);

  const edit = (item: JourneyItem) => {
    const d = byId.get(item.id);
    const camera = d && cameraOf(d);
    if (!d || !camera) return;
    setEditing({
      camera,
      prefill: {
        deploymentId: d.id,
        siteId: d.siteId,
        fromDate: d.startDate ?? new Date().toISOString().slice(0, 10),
        untilDate: d.endDate,
        lat: d.lat,
        lon: d.lon,
      },
    });
  };

  const footer = (item: JourneyItem) => {
    const d = byId.get(item.id)!;
    const move = suspicious.get(d.id);
    const mine = corrections.filter((p) => covers(p, d));
    return (
      <>
        {move && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-xs">
            <MoveStatus it={move} />
            <Link
              to={`/projects/${projectId}/moves?camera=${d.cameraId}&status=suspicious`}
              className="text-muted-foreground hover:text-foreground"
            >
              Check this move
            </Link>
          </div>
        )}
        {mine.length > 0 && (
          <ul className="mt-2 space-y-1 border-t pt-2">
            {mine.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                {/* Wraps instead of cutting off: the date at the end matters. */}
                <span className="min-w-0 break-words" title={daysLabel(p)}>{setBy(p)}</span>
                {/* The same look as Edit at the top of the card. */}
                <button
                  type="button"
                  onClick={() => setRemoving(p)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
    startDate: d.startDate,
    endDate: d.endDate,
    imageCount: d.imageCount,
  }));

  return (
    <>
      <DeploymentJourney
        items={items}
        emptyText={emptyText}
        // Edit needs the card's camera from the cameras list; an admin sees
        // every camera of the project, so it is always there once loaded.
        onEdit={canEdit ? edit : undefined}
        footer={canEdit ? footer : undefined}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
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
        isPending={remove.isPending}
      />

      {editing && (
        <SetDeploymentDialog
          projectId={projectId}
          camera={editing.camera}
          prefill={editing.prefill}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
};
