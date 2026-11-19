/**
 * Deployments of one camera, the Deployments tab of the camera panel.
 *
 * The history reads as a journey: each step is a site the camera stood at,
 * oldest first. The server works the deployments out from the photos' GPS
 * plus fixed periods. Project admins can set a deployment (place a camera
 * without GPS, change the site of a step, correct the past) and see the
 * fixed periods with who set them, each of which can be taken back.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPinPlus } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import { deploymentsApi, type FixedPeriod } from '../api/deployments';
import type { Camera } from '../api/types';
import { DeploymentJourney, type JourneyItem } from './DeploymentJourney';
import { SetDeploymentDialog, type SetDeploymentPrefill } from './deployments/SetDeploymentDialog';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/Toaster';
import { useProject } from '../contexts/ProjectContext';
import { formatDate } from '../utils/datetime';

const today = () => new Date().toISOString().slice(0, 10);

// Plain day labels from YYYY-MM-DD, read as the day it says, never shifted by
// the browser's timezone.
const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

function sourceLabel(p: FixedPeriod): string {
  if (p.source === 'upload') return 'set by an upload';
  if (p.source === 'carried_over') return 'kept from before the update';
  const when = dayLabel(p.created_at.slice(0, 10));
  return p.created_by ? `set by ${p.created_by} on ${when}` : `set on ${when}`;
}

export const CameraDeploymentHistory: React.FC<{ camera: Camera }> = ({ camera }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { isProjectAdmin } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const pid = projectId ? Number(projectId) : undefined;
  const canEdit = pid !== undefined && isProjectAdmin;

  const [prefill, setPrefill] = useState<SetDeploymentPrefill | null>(null);
  const [removing, setRemoving] = useState<FixedPeriod | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['camera-deployments', camera.id],
    queryFn: () => camerasApi.getDeployments(camera.id),
  });

  const { data: fixedPeriods } = useQuery({
    queryKey: ['fixed-periods', camera.id],
    queryFn: () => deploymentsApi.fixedPeriods(pid!, camera.id),
    enabled: canEdit,
  });

  const remove = useMutation({
    mutationFn: (p: FixedPeriod) => deploymentsApi.removeFixedPeriod(pid!, p.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sites', pid] });
      setRemoving(null);
      toast.success('Fixed period removed');
    },
    onError: (error: any) => {
      toast.error(`Could not remove the fixed period. ${error.response?.data?.detail || error.message || ''}`);
    },
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
      siteId: dep.site_id,
      fromDate: dep.start_date ?? today(),
      untilDate: dep.end_date,
      lat: dep.latitude,
      lon: dep.longitude,
    });
  };

  const newDeployment = (fromDate: string, untilDate: string | null) =>
    setPrefill({ siteId: null, fromDate, untilDate, lat: null, lon: null });

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
              Set deployment
            </Button>
          }
        >
          {unplaced} {unplaced === 1 ? 'photo has' : 'photos have'} no site yet, taken
          from {dayLabel(camera.unplaced_first_day)} to {dayLabel(camera.unplaced_last_day!)}.
        </Callout>
      )}

      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => newDeployment(today(), null)}>
          <MapPinPlus className="h-4 w-4 mr-2" />
          Set deployment
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

      {canEdit && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Fixed periods</h3>
          <p className="text-xs text-muted-foreground">
            Periods where someone said where the camera stood. The GPS does not
            change them. Remove one and the camera follows its GPS again for those days.
          </p>
          {(fixedPeriods ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y border rounded-md">
              {(fixedPeriods ?? []).map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.site_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {dayLabel(p.from_date)} to {p.until_date ? dayLabel(p.until_date) : 'now'}, {sourceLabel(p)}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {prefill && pid !== undefined && (
        <SetDeploymentDialog
          projectId={pid}
          cameraId={camera.id}
          cameraName={camera.name}
          prefill={prefill}
          onClose={() => setPrefill(null)}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Remove this fixed period?"
        body={
          removing ? (
            <>
              {removing.site_name}, {dayLabel(removing.from_date)} to{' '}
              {removing.until_date ? dayLabel(removing.until_date) : 'now'}. For these
              days the camera follows its GPS again, or an older fixed period. Photos
              without GPS in these days have no site until it is set again.
            </>
          ) : ''
        }
        confirmLabel="Remove"
        variant="destructive"
        isPending={remove.isPending}
      />
    </div>
  );
};
