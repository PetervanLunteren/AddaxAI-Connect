/**
 * Rejected files of one camera, shown in the camera detail sheet.
 *
 * A rejected file is one the server refused (no GPS fix, no date) and could
 * still attribute to this camera by its device id. It never became an image,
 * so it is not on the map, in the statistics or in a deployment. This tab
 * exists so a camera that keeps sending unusable files is found from the
 * Cameras page, instead of by hunting through the global File management
 * list. The window is the 30-day retention; older files are gone.
 *
 * The picture comes through the live-feed endpoint, which blurs the whole
 * frame when the project hides people or vehicles.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { camerasApi, type CameraRejection } from '../api/cameras';
import { AuthenticatedImage } from './AuthenticatedImage';
import { rejectionReasonLabel } from '../utils/rejectionReason';
import { formatDateTime } from '../utils/datetime';

const ALL = 'all';

export const CameraRejectionsTab: React.FC<{
  cameraId: number;
  isServerAdmin: boolean;
}> = ({ cameraId, isServerAdmin }) => {
  const [reason, setReason] = useState<string>(ALL);

  const { data, isLoading } = useQuery({
    queryKey: ['camera-rejections', cameraId],
    queryFn: () => camerasApi.getRejections(cameraId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading rejected files
      </div>
    );
  }

  const rejections = data ?? [];

  // Reasons present for this camera, with counts, for the filter.
  const counts = new Map<string, number>();
  for (const r of rejections) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const reasons = Array.from(counts.keys()).sort();
  const shown = reason === ALL ? rejections : rejections.filter((r) => r.reason === reason);

  if (rejections.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No rejected files in the last 30 days.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Files this camera sent that the server could not use. They are not on the map
        or in the statistics. Files older than 30 days are removed.
        {isServerAdmin && (
          <>
            {' '}
            <Link to="/server/file-management" className="text-primary hover:underline">
              Manage rejected files
            </Link>
          </>
        )}
      </p>

      {reasons.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip active={reason === ALL} onClick={() => setReason(ALL)}>
            All ({rejections.length})
          </FilterChip>
          {reasons.map((r) => (
            <FilterChip key={r} active={reason === r} onClick={() => setReason(r)}>
              {rejectionReasonLabel(r)} ({counts.get(r)})
            </FilterChip>
          ))}
        </div>
      )}

      <ul className="divide-y rounded-lg border">
        {shown.map((r) => (
          <RejectionRow key={r.id} rejection={r} />
        ))}
      </ul>
    </div>
  );
};

const FilterChip: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={
      active
        ? 'px-2.5 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground'
        : 'px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:text-foreground'
    }
  >
    {children}
  </button>
);

const RejectionRow: React.FC<{ rejection: CameraRejection }> = ({ rejection }) => (
  <li className="flex gap-3 p-3">
    <div className="h-16 w-24 shrink-0 overflow-hidden rounded bg-muted">
      <AuthenticatedImage
        src={rejection.image_url}
        alt={rejection.filename}
        className="h-full w-full object-cover"
        fallback={
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <AlertTriangle className="h-5 w-5" />
          </div>
        }
      />
    </div>
    <div className="min-w-0 flex-1 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800">
          {rejectionReasonLabel(rejection.reason)}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(rejection.rejected_at)}
        </span>
      </div>
      <p className="truncate font-mono text-xs" title={rejection.filename}>
        {rejection.filename}
      </p>
      {rejection.captured_at && (
        <p className="text-xs text-muted-foreground">
          Taken {formatDateTime(rejection.captured_at)}
        </p>
      )}
    </div>
  </li>
);
