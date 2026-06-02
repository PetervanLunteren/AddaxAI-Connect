/**
 * Deployment history for one camera, shown in the camera detail sheet.
 *
 * Lists each period the camera spent at a site, oldest first, using the shared
 * DeploymentCard (site name, camera id, date range, image count). Read-only:
 * a deployment carries no editable metadata, and site reassignment lives on the
 * site detail.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import { DeploymentCard } from './DeploymentCard';

export const CameraDeploymentHistory: React.FC<{
  cameraId: number;
  cameraName: string;
}> = ({ cameraId, cameraName }) => {
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
        <DeploymentCard
          key={d.id}
          siteName={d.site_name}
          cameraName={cameraName}
          startDate={d.start_date}
          endDate={d.end_date}
          imageCount={d.image_count}
        />
      ))}
    </div>
  );
};
