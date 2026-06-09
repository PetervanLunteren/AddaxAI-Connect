/**
 * Deployment site-assignment modal.
 *
 * A deployment carries no free-text metadata; the only human-editable thing is
 * which site it belongs to. The Deployments page opens this from a row's
 * "Change site" button; the camera and site slideouts show deployments
 * read-only and link to that page instead. Changing the site here marks the
 * deployment site_source='manual', recording that a human confirmed the site
 * (drives the badge and filter); it does not change ingestion.
 */
import React, { useEffect, useState } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { sitesApi } from '../api/sites';
import { deploymentsApi, type UpdateDeploymentRequest } from '../api/deployments';
import { SiteFormModal } from './sites/SiteFormModal';
import { AuthenticatedImage } from './AuthenticatedImage';
import { useToast } from './ui/Toaster';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  deploymentId: number;
  cameraName: string;
  initialSiteId: number | null;
  // The deployment's current position label ("North"), or null.
  initialLabel?: string | null;
  // The deployment's own GPS point, used to prefill a new site's coordinates.
  deploymentLat?: number | null;
  deploymentLon?: number | null;
  // The deployment's time range, shown in the subhead to identify which
  // placement this is (a camera can have several over time). end null = open.
  startDate?: string | null;
  endDate?: string | null;
  // React-Query keys to invalidate on a successful save.
  invalidateKeys: QueryKey[];
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const DeploymentEditModal: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  deploymentId,
  cameraName,
  initialSiteId,
  initialLabel,
  deploymentLat,
  deploymentLon,
  startDate,
  endDate,
  invalidateKeys,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [siteId, setSiteId] = useState<number | null>(initialSiteId);
  const [label, setLabel] = useState(initialLabel ?? '');
  const [showCreateSite, setShowCreateSite] = useState(false);

  useEffect(() => {
    if (open) {
      setSiteId(initialSiteId);
      setLabel(initialLabel ?? '');
    }
  }, [open, initialSiteId, initialLabel]);

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
    enabled: open,
  });

  // A few random photos from this deployment, as visual confirmation of where
  // it is. Read-only context, so failures just hide the strip.
  const { data: thumbUuids } = useQuery({
    queryKey: ['deployment-thumbnails', projectId, deploymentId],
    queryFn: () => deploymentsApi.thumbnails(projectId, deploymentId, 6),
    enabled: open && deploymentId > 0,
  });

  const dirty = siteId !== initialSiteId || label.trim() !== (initialLabel ?? '');

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send only what changed, so a label-only edit does not also re-stamp the
      // site as human-confirmed or trigger a merge.
      const body: UpdateDeploymentRequest = {};
      if (siteId !== initialSiteId) body.site_id = siteId;
      if (label.trim() !== (initialLabel ?? '')) body.label = label.trim() || null;
      return deploymentsApi.update(projectId, deploymentId, body);
    },
    onSuccess: (res) => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      toast.success(
        res.merged > 0
          ? `Deployment updated, merged ${res.merged} continuous deployment${res.merged === 1 ? '' : 's'}`
          : 'Deployment updated',
      );
      onClose();
    },
    onError: (error: any) => {
      toast.error(
        `Update failed. ${error.response?.data?.detail || error.message || ''}`,
      );
    },
  });

  const handleClose = () => {
    if (!saveMutation.isPending) onClose();
  };

  // Identify the deployment by camera and time range; the site lives in the
  // dropdown below, so it is not repeated here.
  const period = startDate
    ? `${fmtDate(startDate)} to ${endDate ? fmtDate(endDate) : 'now'}`
    : null;
  const subhead = period ? `Camera ${cameraName}, ${period}` : `Camera ${cameraName}`;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent onClose={handleClose}>
          <DialogHeader>
            <DialogTitle>Edit deployment</DialogTitle>
            <DialogDescription>
              The site was guessed from the photos' GPS. Fix it here if the guess
              is wrong, and add a position label to tell apart the cameras at one
              site. This does not move any site on the map.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-3">{subhead}</p>
            <label className="text-xs text-muted-foreground">Site</label>
            <div className="flex gap-2">
              <select
                value={siteId ?? ''}
                onChange={(e) =>
                  setSiteId(e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={saveMutation.isPending}
                className="flex-1 px-3 py-2 border rounded-md text-sm disabled:bg-muted"
              >
                {/* Only a deployment that has no site can show (and stay)
                    Unassigned. A sited deployment moves between real sites or a
                    new one, never back to nowhere. */}
                {initialSiteId == null && <option value="">Unassigned</option>}
                {(sites ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateSite(true)}
                disabled={saveMutation.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                New site
              </Button>
            </div>

            <div className="mt-3">
              <label className="text-xs text-muted-foreground">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. North"
                maxLength={100}
                disabled={saveMutation.isPending}
                className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted"
              />
            </div>

            {thumbUuids && thumbUuids.length > 0 && (
              <div className="mt-4">
                <label className="text-xs text-muted-foreground">Photos from here</label>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  {thumbUuids.map((u) => (
                    <AuthenticatedImage
                      key={u}
                      src={`/api/images/${u}/thumbnail`}
                      alt="Deployment photo"
                      className="w-full h-20 object-cover rounded-md border"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SiteFormModal
        open={showCreateSite}
        onClose={() => setShowCreateSite(false)}
        projectId={projectId}
        sites={sites ?? []}
        defaultLat={deploymentLat ?? null}
        defaultLon={deploymentLon ?? null}
        onCreated={(site) => setSiteId(site.id)}
      />
    </>
  );
};
