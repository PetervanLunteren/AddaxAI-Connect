/**
 * One deployment, in a slide-out like a site's and a camera's. It opens on
 * a row of the Deployments page and shows the same for every deployment,
 * top to bottom:
 * - the deployment's card (DeploymentCards), the same as in the camera and
 *   site panels: Edit, the corrections with Undo, links to the camera, the
 *   site and the photos;
 * - only for a suspicious deployment (rows.ts), one question, did the
 *   camera really go there:
 *   - Right (PUT .../deployments/{id}/checked) clears the warning and
 *     records who said so, with Undo.
 *   - Wrong (POST .../deployments/{id}/not-moved): the GPS was off, the
 *     camera stayed. One correction at the old site, at once. The
 *     deployment is gone then, so the panel closes; the correction is on
 *     the card of the deployment at the old site, with Undo.
 * - the map: where it came from, where it stood and where it went;
 * - Moved from and Moved to, when it did;
 * - the photos that tell whether a move is real: the last one at the old
 *   site next to the first one here (or its first two photos);
 * - links to its photos in Images and in Curation.
 *
 * Nobody has to answer anything; a person fixes a deployment with Edit.
 */
import React, { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardSim, Check, Loader2, Undo2, X } from 'lucide-react';
import {
  deploymentKeys, deploymentsApi, invalidateDeployments, type DeploymentListItem, type DeploymentPhoto,
} from '../../api/deployments';
import { imageHref } from '../../lib/panel-links';
import { errorDetail } from '../../lib/utils';
import { formatDateTime } from '../../utils/datetime';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { DetailRow } from '../ui/DetailRow';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '../ui/Sheet';
import { useToast } from '../ui/Toaster';
import type { SitePin } from '../sites/SiteMarkersLayer';
import { DeploymentCards } from './DeploymentCards';
import { DeploymentStatus } from './DeploymentStatus';
import { DeploymentsMap, type MapArrow } from './DeploymentsMap';
import { cameraLabel, dayLabel, metresLabel, placeName, siteLabel } from './format';
import { PhotoLinks } from './PhotoLinks';
import { SUSPICIOUS_REASON, type DeploymentRow } from './rows';

interface Props {
  projectId: number;
  row: DeploymentRow; // kept fresh by the page
  sites: SitePin[];
  onClose: () => void;
}

/** "Pond · 3 May 2026 · 420 m": the other site of a move, its day and how far. */
const moveLabel = (site: DeploymentListItem, day: string | null, distanceM: number | undefined) =>
  [siteLabel(site.site_name), day && dayLabel(day), distanceM !== undefined && metresLabel(distanceM)]
    .filter(Boolean).join(' · ');

export const DeploymentSheet: React.FC<Props> = ({ projectId, row, sites, onClose }) => {
  const d = row.deployment;
  const { previous, next } = row;

  // From site to site, so an arrow meets the two magenta markers.
  const arrows: MapArrow[] = useMemo(() => {
    const at = (x: DeploymentListItem): [number, number] | null => {
      const site = sites.find((s) => s.id === x.site_id);
      return site && site.latitude != null && site.longitude != null ? [site.latitude, site.longitude] : null;
    };
    const arrow = (a: DeploymentListItem | undefined, b: DeploymentListItem | undefined): MapArrow[] => {
      const from = a && at(a);
      const to = b && at(b);
      return from && to
        ? [{ key: `${a.id}-${b.id}`, from, to, label: `${placeName(a.site_name)} to ${placeName(b.site_name)}` }]
        : [];
    };
    return [...arrow(previous, d), ...arrow(d, next)];
  }, [d, previous, next, sites]);
  const active = useMemo(
    () => new Set([d, previous, next].map((x) => x?.site_id).filter((id): id is number => id != null)),
    [d, previous, next],
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent onClose={onClose}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <CardSim className="h-5 w-5" />
            Deployment
            <DeploymentStatus row={row} />
          </SheetTitle>
        </SheetHeader>

        <SheetBody className="space-y-6">
          <DeploymentCards
            projectId={projectId}
            deployments={[{
              id: d.id,
              cameraId: d.camera_id,
              cameraName: cameraLabel(d.camera_label, d.camera_id),
              siteId: d.site_id,
              siteName: d.site_name,
              startDate: d.start_date,
              endDate: d.end_date,
              imageCount: d.image_count,
              lat: d.latitude,
              lon: d.longitude,
            }]}
            canEdit
            emptyText=""
            inOwnPanel
          />

          {row.shortTrip && <ShortTrip projectId={projectId} row={row} onClose={onClose} />}

          <div className="rounded-lg border p-4 space-y-3 text-sm">
            {/* A new map per deployment and per set of sites: it fits once
                when it opens, so after an edit to another site it fits again. */}
            <DeploymentsMap
              key={`${row.key}|${[...active].sort().join()}`}
              sites={sites}
              activeSiteIds={active.size === 0 ? null : active}
              arrows={arrows}
              height={280}
            />
            <DetailRow label="Moved from">
              {previous && moveLabel(previous, d.start_date, row.distanceM)}
            </DetailRow>
            <DetailRow label="Moved to">
              {next && moveLabel(next, next.start_date, row.nextDistanceM)}
            </DetailRow>
          </div>

          <Photos projectId={projectId} row={row} />

          <p className="text-sm text-muted-foreground">
            <PhotoLinks
              projectId={projectId}
              photos={{ cameraId: d.camera_id, firstDay: d.start_date, lastDay: d.end_date }}
            />
          </p>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};

/**
 * A short trip (rows.ts): the question while nobody answered it, or who
 * marked it right, with Undo, which makes it suspicious again.
 */
const ShortTrip: React.FC<{ projectId: number; row: DeploymentRow; onClose: () => void }> = ({
  projectId, row, onClose,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const d = row.deployment;
  const oldSite = placeName(row.previous?.site_name);
  const refresh = () => invalidateDeployments(queryClient, projectId);

  const right = useMutation({
    mutationFn: (checked: boolean) => deploymentsApi.setChecked(projectId, d.id, checked),
    onSuccess: refresh,
    onError: (error) => toast.error(`Could not save. ${errorDetail(error)}`),
  });
  const wrong = useMutation({
    mutationFn: () => deploymentsApi.notMoved(projectId, d.id),
    onSuccess: () => {
      toast.success(`The camera stayed at ${oldSite}. Its photos are back there.`);
      onClose();
      refresh();
    },
    onError: (error) => toast.error(`Could not save. ${errorDetail(error)}`),
  });
  const busy = right.isPending || wrong.isPending;

  if (d.checked_at) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 break-words">
          Marked right by {d.checked_by ?? 'someone'} on {dayLabel(d.checked_at.slice(0, 10))}
        </span>
        <button
          type="button"
          onClick={() => right.mutate(false)}
          disabled={busy}
          className="tap-target inline-flex shrink-0 items-center gap-1 hover:text-foreground"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-4 space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">{SUSPICIOUS_REASON}</p>
      <p className="font-medium">Did the camera really go to {placeName(d.site_name)}?</p>
      <Button className="w-full" onClick={() => right.mutate(true)} disabled={busy}>
        {right.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
        Right, it went there
      </Button>
      <Button variant="outline" className="w-full" onClick={() => wrong.mutate()} disabled={busy}>
        {wrong.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <X className="h-4 w-4 mr-2" />}
        Wrong, it stayed at {oldSite}
      </Button>
    </div>
  );
};

/**
 * What tells whether a deployment is right: the last photo at the site it
 * moved from next to the first one here, or its first two photos when it
 * did not move.
 */
const Photos: React.FC<{ projectId: number; row: DeploymentRow }> = ({ projectId, row }) => {
  const d = row.deployment;
  const p = row.previous;
  const firstCount = p ? 1 : 2;
  const { data: before } = useQuery({
    queryKey: deploymentKeys.photos(projectId, p, 'last', 1),
    queryFn: () => deploymentsApi.photos(projectId, p!.id, 'last', 1),
    enabled: !!p,
  });
  const { data: after } = useQuery({
    queryKey: deploymentKeys.photos(projectId, d, 'first', firstCount),
    queryFn: () => deploymentsApi.photos(projectId, d.id, 'first', firstCount),
  });
  return (
    <div className="grid grid-cols-2 gap-2">
      {p && <Photo projectId={projectId} photo={before?.[0]} label={`Last photo at ${placeName(p.site_name)}`} />}
      {(after ?? []).map((photo, i) => (
        <Photo
          key={photo.uuid}
          projectId={projectId}
          photo={photo}
          label={i === 0 ? `First photo at ${placeName(d.site_name)}` : 'Next photo'}
        />
      ))}
    </div>
  );
};

/**
 * A small photo with one short caption under it ("Last photo at Pond"), so
 * it is clear what it shows, also on a phone where nothing hovers. A long
 * site name is cut; the full caption and the time show on hover. A click
 * opens the photo in image verification in a new tab, so the panel keeps
 * its place.
 */
const Photo: React.FC<{ projectId: number; photo: DeploymentPhoto | undefined; label: string }> = ({ projectId, photo, label }) => {
  const title = photo ? `${label}, ${formatDateTime(photo.captured_at)}` : label;
  return (
    <figure className="min-w-0 space-y-1">
      {photo ? (
        <a href={imageHref(projectId, photo.uuid)} target="_blank" rel="noopener noreferrer" title={title}>
          <AuthenticatedImage
            src={`/api/images/${photo.uuid}/thumbnail`}
            alt={title}
            className="w-full aspect-[4/3] object-cover rounded border hover:opacity-90"
          />
        </a>
      ) : (
        <div className="w-full aspect-[4/3] rounded border bg-muted" />
      )}
      <figcaption className="text-xs text-muted-foreground truncate" title={title}>{label}</figcaption>
    </figure>
  );
};
