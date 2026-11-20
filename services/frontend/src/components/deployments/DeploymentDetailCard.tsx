/**
 * What the Deployments page says about the selected deployment: where and
 * when, how many photos, and in words why it starts where it does. Below
 * that Set deployment and the camera's fixed periods with Remove, the same
 * list as in the camera panel.
 */
import { Link } from 'react-router-dom';
import { Camera as CameraIcon, MapPinPlus, X } from 'lucide-react';
import type { DeploymentListItem, DeploymentStart } from '../../api/deployments';
import { formatDateTime } from '../../utils/datetime';
import { Button } from '../ui/Button';
import { FixedPeriodsList, dayLabel } from './FixedPeriodsList';
import { metresLabel as metres } from './review-items';

/** The reason in words. */
function startReason(start: DeploymentStart | undefined, thresholdM: number): string | null {
  if (!start) return null;
  if (start.kind === 'fixed') {
    return 'A fixed period starts here: someone said where the camera stood, so the GPS does not change it.';
  }
  if (start.kind === 'moved' && start.distance_m !== null && start.readings !== null && start.first_at) {
    return (
      `The camera moved. ${start.readings} photos in a row were ${metres(start.distance_m)} from where it ` +
      `stood before, more than ${metres(thresholdM)}. The first was taken ${formatDateTime(start.first_at)}.`
    );
  }
  return 'Starts at the first photo here. There was no earlier place to compare with.';
}

interface Props {
  projectId: number;
  deployment: DeploymentListItem;
  start: DeploymentStart | undefined;
  thresholdM: number | undefined;
  onSetDeployment: () => void;
  onClose: () => void;
}

export function DeploymentDetailCard({ projectId, deployment: d, start, thresholdM, onSetDeployment, onClose }: Props) {
  const reason = thresholdM !== undefined ? startReason(start, thresholdM) : null;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{d.site_name ?? 'No site'}</div>
          <div className="text-muted-foreground truncate">Camera {d.camera_label}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="text-muted-foreground">
        {d.start_date ? dayLabel(d.start_date) : '-'} to {d.end_date ? dayLabel(d.end_date) : 'now'}
        {', '}
        {d.image_count.toLocaleString()} photos
        {d.end_date === null && d.last_photo_at && `, last photo ${dayLabel(d.last_photo_at.slice(0, 10))}`}
      </div>

      <div>
        <div className="font-medium">{d.site_source === 'manual' ? 'Fixed' : 'Automatic, from the GPS'}</div>
        {reason ? <p className="text-muted-foreground mt-0.5">{reason}</p> : <p className="text-muted-foreground mt-0.5">Loading...</p>}
        {thresholdM !== undefined && d.latitude !== null && (
          <p className="text-xs text-muted-foreground mt-1">
            On the map, the dashed ring is {metres(thresholdM)} around the pin. Photos inside it count as the
            same place.
          </p>
        )}
      </div>

      <Button size="sm" variant="outline" onClick={onSetDeployment}>
        <MapPinPlus className="h-4 w-4 mr-2" />
        Set deployment
      </Button>

      <FixedPeriodsList projectId={projectId} cameraId={d.camera_id} />

      <Link
        to={`/projects/${projectId}/cameras?camera=${d.camera_id}`}
        className="inline-flex items-center gap-1.5 text-primary hover:underline"
      >
        <CameraIcon className="h-4 w-4" />
        Open the camera
      </Link>
    </div>
  );
}
