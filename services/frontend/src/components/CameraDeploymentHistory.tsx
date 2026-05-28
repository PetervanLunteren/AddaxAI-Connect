/**
 * Deployment history for one camera, shown in the camera detail sheet.
 *
 * Lists each period the camera spent at a site, oldest first, with the site
 * name, the date range, and the image count. Clicking a row opens the shared
 * `DeploymentEditModal` in read-only mode (the editable view lives on the
 * site detail).
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { camerasApi, type CameraDeployment } from '../api/cameras';
import { DeploymentEditModal } from './DeploymentEditModal';

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props {
  cameraId: number;
  // Project the camera belongs to. Needed to open the read-only deployment
  // modal. When omitted the rows still render but are not clickable.
  projectId?: number;
  // Used in the modal subhead so the user keeps context.
  cameraName?: string;
}

export const CameraDeploymentHistory: React.FC<Props> = ({
  cameraId,
  projectId,
  cameraName,
}) => {
  const [openDep, setOpenDep] = useState<CameraDeployment | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['camera-deployments', cameraId],
    queryFn: () => camerasApi.getDeployments(cameraId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading deployment history
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No deployment history for this camera yet.
      </p>
    );
  }

  const clickable = projectId !== undefined;

  return (
    <>
      <div className="space-y-3">
        {data.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={clickable ? () => setOpenDep(d) : undefined}
            disabled={!clickable}
            className={`w-full text-left rounded-md border p-3 ${
              clickable ? 'cursor-pointer hover:bg-muted/50' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-medium truncate">
                  {d.site_name ?? 'Unassigned site'}
                  {d.label ? ` / ${d.label}` : ''}
                </span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {d.image_count.toLocaleString()} images
              </span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {fmtDate(d.start_date)} to {d.end_date ? fmtDate(d.end_date) : 'now'}
            </div>
          </button>
        ))}
      </div>

      {projectId !== undefined && (
        <DeploymentEditModal
          open={openDep != null}
          onClose={() => setOpenDep(null)}
          projectId={projectId}
          deploymentId={openDep?.id ?? 0}
          cameraName={cameraName ?? ''}
          siteName={openDep?.site_name ?? null}
          initialName={openDep?.label ?? null}
          initialNotes={openDep?.notes ?? null}
          editable={false}
          invalidateKeys={[['camera-deployments', cameraId]]}
        />
      )}
    </>
  );
};
