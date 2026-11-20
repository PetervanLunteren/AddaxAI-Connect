/**
 * The small card under the map of the Camera updates page, for the selected
 * update: where and when, how many photos, and in one line why the app
 * decided so.
 */
import { Link } from 'react-router-dom';
import { Camera as CameraIcon, X } from 'lucide-react';
import type { DeploymentListItem, DeploymentStart } from '../../api/deployments';
import { formatDateTime } from '../../utils/datetime';
import { Button } from '../ui/Button';
import { dayLabel } from './FixedPeriodsList';
import { metresLabel as metres } from './update-items';

/** The reason in one line. */
function startReason(start: DeploymentStart | undefined, thresholdM: number): string | null {
  if (!start) return null;
  if (start.kind === 'fixed') return 'A person set this site.';
  if (start.kind === 'moved' && start.distance_m !== null && start.readings !== null && start.first_at) {
    return (
      `${start.readings} photos in a row were ${metres(start.distance_m)} from where the camera stood before ` +
      `(more than ${metres(thresholdM)} counts as a move). The first was taken ${formatDateTime(start.first_at)}.`
    );
  }
  return 'The first photos of this camera here.';
}

interface Props {
  projectId: number;
  deployment: DeploymentListItem;
  start: DeploymentStart | undefined;
  thresholdM: number | undefined;
  onClose: () => void;
}

export function DeploymentDetailCard({ projectId, deployment: d, start, thresholdM, onClose }: Props) {
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

      <p className="text-muted-foreground">{reason ?? 'Loading...'}</p>

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
