/**
 * Deployment history for one camera, shown in the camera detail sheet.
 *
 * Tells the story "where has this camera lived over time?" as a read-only
 * journey: each step is a site the camera moved to, oldest first. Editing
 * happens on the Deployments page, which each step links to (pre-filtered to
 * this camera).
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import { DeploymentJourney } from './DeploymentJourney';

export const CameraDeploymentHistory: React.FC<{
  cameraId: number;
  cameraName: string;
}> = ({ cameraId, cameraName }) => {
  const { projectId } = useParams<{ projectId: string }>();
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

  // The Deployments page filters cameras by their device-id label, which is what
  // cameraName holds.
  const linkTo = `/projects/${projectId}/deployments?camera=${encodeURIComponent(cameraName)}`;

  return (
    <DeploymentJourney
      mode="camera"
      items={(data ?? []).map((d) => ({
        id: d.id,
        title: d.site_name,
        startDate: d.start_date,
        endDate: d.end_date,
        imageCount: d.image_count,
      }))}
      linkTo={linkTo}
      emptyText="No deployment history for this camera yet."
    />
  );
};
