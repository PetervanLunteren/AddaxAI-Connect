/**
 * Deployments of one camera, the Deployments tab of the camera panel.
 *
 * The history reads as a journey: each step is a site the camera stood at,
 * oldest first. The server works the deployments out from the photos' GPS
 * plus fixed periods. Project admins fix a wrong site with "Wrong site?" on
 * a step: the form opens with that step's site and days, and the first day
 * can be moved to fix a move the GPS missed. Photos without a site, and a
 * camera without any deployment yet, get their own Set site button, since
 * there is no step to click. The fixed periods with who set them, each with
 * Undo, show only once someone set one.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPinPlus } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import type { Camera } from '../api/types';
import { DeploymentJourney, type JourneyItem } from './DeploymentJourney';
import { FixedPeriodsList } from './deployments/FixedPeriodsList';
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

  const [prefill, setPrefill] = useState<SetDeploymentPrefill | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['camera-deployments', camera.id],
    queryFn: () => camerasApi.getDeployments(camera.id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading deployments
      </div>
    );
  }

  const deployments = data ?? [];
  const unplaced = camera.unplaced_photo_count ?? 0;

  const changeSite = (item: JourneyItem) => {
    const dep = deployments.find((d) => d.id === item.id);
    if (!dep) return;
    setPrefill({
      deploymentId: dep.id,
      siteId: dep.site_id,
      fromDate: dep.start_date ?? today(),
      untilDate: dep.end_date,
      lat: dep.latitude,
      lon: dep.longitude,
    });
  };

  const newDeployment = (fromDate: string, untilDate: string | null) =>
    setPrefill({ deploymentId: null, siteId: null, fromDate, untilDate, lat: null, lon: null });

  return (
    <div className="space-y-6">
      {canEdit && unplaced > 0 && camera.unplaced_first_day && (
        <Callout
          variant="warning"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => newDeployment(camera.unplaced_first_day!, null)}
            >
              Set site
            </Button>
          }
        >
          {unplaced} {unplaced === 1 ? 'photo has' : 'photos have'} no site yet, taken
          from {dayLabel(camera.unplaced_first_day)} to {dayLabel(camera.unplaced_last_day!)}.
        </Callout>
      )}

      {/* Every other fix starts from a deployment, with Edit. */}
      {canEdit && unplaced === 0 && deployments.length === 0 && (
        <Button size="sm" variant="outline" onClick={() => newDeployment(today(), null)}>
          <MapPinPlus className="h-4 w-4 mr-2" />
          Set site
        </Button>
      )}

      <DeploymentJourney
        mode="camera"
        items={deployments.map((d) => ({
          id: d.id,
          title: d.site_name,
          startDate: d.start_date,
          endDate: d.end_date,
          imageCount: d.image_count,
        }))}
        emptyText={`No deployments for camera ${camera.name} yet.`}
        onChangeSite={canEdit ? changeSite : undefined}
      />

      {canEdit && <FixedPeriodsList projectId={pid} cameraId={camera.id} />}

      {prefill && pid !== undefined && (
        <SetDeploymentDialog
          projectId={pid}
          camera={camera}
          prefill={prefill}
          onClose={() => setPrefill(null)}
        />
      )}
    </div>
  );
};
