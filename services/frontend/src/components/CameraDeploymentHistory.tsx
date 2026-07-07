/**
 * Deployment history for one camera, shown in the camera detail sheet.
 *
 * Tells the story "where has this camera lived over time?" as a journey:
 * each step is a site the camera moved to, oldest first. Site assignment is
 * automatic; corrections normally happen from the camera updates panel. As a
 * late-correction escape hatch, project admins get a "change site" action on
 * each step, which reassigns that placement to any site of the project, or to
 * a brand new site created at the placement's own GPS. That new-site path is
 * the only way to split a backlog site that the automatic clustering merged by
 * mistake, since the feed's "new site" decision is not replayable for old data.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import { sitesApi } from '../api/sites';
import { deploymentsApi } from '../api/deployments';
import { DeploymentJourney, type JourneyItem } from './DeploymentJourney';
import { SiteFormModal } from './sites/SiteFormModal';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { useToast } from './ui/Toaster';
import { useProject } from '../contexts/ProjectContext';

export const CameraDeploymentHistory: React.FC<{
  cameraId: number;
  cameraName: string;
}> = ({ cameraId, cameraName }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { isProjectAdmin } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const pid = projectId ? Number(projectId) : undefined;

  const [editItem, setEditItem] = useState<JourneyItem | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [creatingSite, setCreatingSite] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['camera-deployments', cameraId],
    queryFn: () => camerasApi.getDeployments(cameraId),
  });

  const { data: sites } = useQuery({
    queryKey: ['sites', pid],
    queryFn: () => sitesApi.list(pid!),
    enabled: pid !== undefined && editItem !== null,
  });

  // Reassign the edited placement to a site, by id. Shared by the "pick an
  // existing site" dropdown and the "create a new site here" path.
  const assignMutation = useMutation({
    mutationFn: (targetSiteId: number) =>
      deploymentsApi.update(pid!, editItem!.id, { site_id: targetSiteId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['sites', pid] });
      queryClient.invalidateQueries({ queryKey: ['feed', pid] });
      setEditItem(null);
      toast.success('Site changed');
    },
    onError: (error: any) => {
      toast.error(`Could not change the site. ${error.response?.data?.detail || error.message || ''}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading deployment history
      </div>
    );
  }

  const deployments = data ?? [];
  const editDep = editItem ? deployments.find((d) => d.id === editItem.id) : undefined;

  const openEdit = (item: JourneyItem) => {
    const dep = deployments.find((d) => d.id === item.id);
    setSiteId(dep?.site_id ?? null);
    setEditItem(item);
  };

  return (
    <>
      <DeploymentJourney
        mode="camera"
        items={deployments.map((d) => ({
          id: d.id,
          title: d.site_name,
          startDate: d.start_date,
          endDate: d.end_date,
          imageCount: d.image_count,
        }))}
        emptyText={`No deployment history for camera ${cameraName} yet.`}
        onChangeSite={pid !== undefined && isProjectAdmin ? openEdit : undefined}
      />

      {editItem && (
        <Dialog open onOpenChange={(o) => !o && setEditItem(null)}>
          <DialogContent onClose={() => setEditItem(null)}>
            <DialogHeader>
              <DialogTitle>Change site</DialogTitle>
              <DialogDescription>
                Pick the site where camera {cameraName} actually stood during
                this period. Its images move along to the new site.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Site</label>
                <Select
                  value={siteId ?? ''}
                  onChange={(e) => setSiteId(e.target.value === '' ? null : Number(e.target.value))}
                >
                  {(sites ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                onClick={() => setCreatingSite(true)}
                className="text-sm text-primary hover:underline"
              >
                Or create a new site here
              </button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditItem(null)} disabled={assignMutation.isPending}>
                Cancel
              </Button>
              <Button onClick={() => assignMutation.mutate(siteId!)} disabled={assignMutation.isPending || siteId == null}>
                {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editItem && creatingSite && (
        <SiteFormModal
          open
          onClose={() => setCreatingSite(false)}
          projectId={pid!}
          sites={sites ?? []}
          defaultLat={editDep?.latitude ?? null}
          defaultLon={editDep?.longitude ?? null}
          onCreated={(site) => {
            // Created at this placement's GPS: move the placement onto it, which
            // splits it out of the site the automatic clustering had merged.
            setCreatingSite(false);
            assignMutation.mutate(site.id);
          }}
        />
      )}
    </>
  );
};
