/**
 * Deployments of one camera, the Deployments tab of the camera panel: the
 * shared deployment cards (DeploymentCards), oldest first.
 * The site panel shows the same cards from the site's side.
 *
 * Photos without a site, and a camera without any deployment yet, get a
 * Set site button here, since there is no card to click: it opens the same
 * form as Edit, as Add deployment.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPinPlus } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import type { Camera } from '../api/types';
import { DeploymentCards } from './deployments/DeploymentCards';
import { dayLabel } from './deployments/moves';
import { SetDeploymentDialog, type SetDeploymentPrefill } from './deployments/SetDeploymentDialog';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { useProject } from '../contexts/ProjectContext';

const today = () => new Date().toISOString().slice(0, 10);

export const CameraDeploymentHistory: React.FC<{ camera: Camera }> = ({ camera }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { isProjectAdmin } = useProject();
  const pid = projectId ? Number(projectId) : undefined;
  const canEdit = pid !== undefined && isProjectAdmin;
  // Add deployment (Set site); Edit lives on the cards.
  const [adding, setAdding] = useState<SetDeploymentPrefill | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['camera-deployments', camera.id],
    queryFn: () => camerasApi.getDeployments(camera.id),
  });

  if (isLoading || pid === undefined) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading deployments
      </div>
    );
  }

  const deployments = data ?? [];
  const unplaced = camera.unplaced_photo_count ?? 0;
  const add = (fromDate: string) =>
    setAdding({ deploymentId: null, siteId: null, fromDate, untilDate: null, lat: null, lon: null });

  return (
    <div className="space-y-6">
      {canEdit && unplaced > 0 && camera.unplaced_first_day && (
        <Callout
          variant="warning"
          action={
            <Button size="sm" variant="outline" onClick={() => add(camera.unplaced_first_day!)}>
              Set site
            </Button>
          }
        >
          {unplaced} {unplaced === 1 ? 'photo has' : 'photos have'} no site yet, taken
          from {dayLabel(camera.unplaced_first_day)} to {dayLabel(camera.unplaced_last_day!)}.
        </Callout>
      )}

      {/* Every other fix starts from a card, with Edit. */}
      {canEdit && unplaced === 0 && deployments.length === 0 && (
        <Button size="sm" variant="outline" onClick={() => add(today())}>
          <MapPinPlus className="h-4 w-4 mr-2" />
          Set site
        </Button>
      )}

      <DeploymentCards
        projectId={pid}
        deployments={deployments.map((d) => ({
          id: d.id,
          cameraId: camera.id,
          cameraName: camera.name,
          siteId: d.site_id,
          siteName: d.site_name,
          startDate: d.start_date,
          endDate: d.end_date,
          imageCount: d.image_count,
          lat: d.latitude,
          lon: d.longitude,
        }))}
        canEdit={canEdit}
        emptyText={`No deployments for camera ${camera.name} yet.`}
      />

      {adding && (
        <SetDeploymentDialog projectId={pid} camera={camera} prefill={adding} onClose={() => setAdding(null)} />
      )}
    </div>
  );
};
