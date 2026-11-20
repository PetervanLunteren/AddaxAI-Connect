/**
 * What the Deployments page says about the selected deployment: where and
 * when, how many photos, and in words why it starts where it does. Below
 * that the camera's fixed periods with who set them. Read only: changes are
 * made in the camera panel, which the link opens.
 */
import { Link } from 'react-router-dom';
import { Camera as CameraIcon, X } from 'lucide-react';
import type { DeploymentListItem, DeploymentStart, FixedPeriod } from '../../api/deployments';
import { formatDate, formatDateTime } from '../../utils/datetime';
import { Button } from '../ui/Button';

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

const metres = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

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

function periodSource(p: FixedPeriod): string {
  if (p.source === 'upload') return 'set by an upload';
  if (p.source === 'carried_over') return 'kept from before the update';
  const when = dayLabel(p.created_at.slice(0, 10));
  return p.created_by ? `set by ${p.created_by} on ${when}` : `set on ${when}`;
}

interface Props {
  projectId: number;
  deployment: DeploymentListItem;
  start: DeploymentStart | undefined;
  thresholdM: number | undefined;
  fixedPeriods: FixedPeriod[] | undefined;
  onClose: () => void;
}

export function DeploymentDetailCard({ projectId, deployment: d, start, thresholdM, fixedPeriods, onClose }: Props) {
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

      {(fixedPeriods ?? []).length > 0 && (
        <div>
          <div className="font-medium">Fixed periods of this camera</div>
          <ul className="mt-1 space-y-1">
            {(fixedPeriods ?? []).map((p) => (
              <li key={p.id} className="text-muted-foreground">
                {p.site_name}, {dayLabel(p.from_date)} to {p.until_date ? dayLabel(p.until_date) : 'now'},{' '}
                {periodSource(p)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        to={`/projects/${projectId}/cameras?camera=${d.camera_id}`}
        className="inline-flex items-center gap-1.5 text-primary hover:underline"
      >
        <CameraIcon className="h-4 w-4" />
        Open the camera to change its deployments
      </Link>
    </div>
  );
}
