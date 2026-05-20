/**
 * Deployment history for one camera, shown in the camera detail sheet.
 *
 * Lists each period the camera spent at a site, oldest first, with the site
 * name, the date range, and how many images it produced there.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { camerasApi } from '../api/cameras';

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const CameraDeploymentHistory: React.FC<{ cameraId: number }> = ({ cameraId }) => {
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

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.id} className="rounded-md border p-3">
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
            {d.latitude != null && d.longitude != null && (
              <span className="ml-2">
                ({d.latitude.toFixed(5)}, {d.longitude.toFixed(5)})
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
