/**
 * Deployment edit modal.
 *
 * One shared Dialog for editing a deployment's orientation label, notes, and
 * its site assignment. The site detail opens it editable; the camera deployment
 * history opens it read-only (single edit point on the site detail). Assigning
 * a site here marks the deployment site_source='manual' on the backend, so GPS
 * ingestion stops re-resolving it. The caller passes the React-Query keys to
 * invalidate after a successful save.
 *
 * Sheets do not stack in this codebase, so this is a centered Dialog over the
 * site sheet, not another sheet.
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
import { sitesApi, type UpdateDeploymentRequest } from '../api/sites';
import { SiteFormModal } from './sites/SiteFormModal';
import { useToast } from './ui/Toaster';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  deploymentId: number;
  cameraName: string;
  siteName: string | null;
  initialName: string | null;
  initialNotes: string | null;
  initialSiteId: number | null;
  // The deployment's own GPS point, used to prefill a new site's coordinates.
  deploymentLat?: number | null;
  deploymentLon?: number | null;
  editable: boolean;
  // React-Query keys to invalidate on a successful save. The caller decides
  // which views need to refetch (site detail, camera deployment history).
  invalidateKeys: QueryKey[];
}

const NAME_MAX = 100;
const NOTES_MAX = 10000;

export const DeploymentEditModal: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  deploymentId,
  cameraName,
  siteName,
  initialName,
  initialNotes,
  initialSiteId,
  deploymentLat,
  deploymentLon,
  editable,
  invalidateKeys,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(initialName ?? '');
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [siteId, setSiteId] = useState<number | null>(initialSiteId);
  const [showCreateSite, setShowCreateSite] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName ?? '');
      setNotes(initialNotes ?? '');
      setSiteId(initialSiteId);
    }
  }, [open, initialName, initialNotes, initialSiteId]);

  // Sites to choose from. Only needed when editing; reuses the page's cache.
  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
    enabled: open && editable,
  });

  const dirty =
    name !== (initialName ?? '') ||
    notes !== (initialNotes ?? '') ||
    siteId !== initialSiteId;

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: UpdateDeploymentRequest = { name, notes };
      if (siteId !== initialSiteId) body.site_id = siteId;
      return sitesApi.updateDeployment(projectId, deploymentId, body);
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      // A site reassignment changes both sites' deployment lists and the
      // camera's history; refresh those regardless of the caller's keys.
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      toast.success('Deployment updated');
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

  const title = editable ? 'Edit deployment' : 'Deployment';
  const subhead = `${cameraName} at ${siteName ?? 'unassigned site'}`;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent onClose={handleClose}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subhead}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground">Site</label>
              {editable ? (
                <div className="flex gap-2">
                  <select
                    value={siteId ?? ''}
                    onChange={(e) =>
                      setSiteId(e.target.value === '' ? null : Number(e.target.value))
                    }
                    disabled={saveMutation.isPending}
                    className="flex-1 px-3 py-2 border rounded-md text-sm disabled:bg-muted"
                  >
                    <option value="">Unassigned</option>
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
              ) : (
                <p className="text-sm mt-1">{siteName ?? 'Unassigned'}</p>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Label</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX}
                disabled={!editable || saveMutation.isPending}
                placeholder="e.g. NW, main view"
                className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={NOTES_MAX}
                rows={5}
                disabled={!editable || saveMutation.isPending}
                placeholder="e.g. Mounted at 1.5m, oak tree, lens cracked Feb 2026"
                className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
              />
            </div>
          </div>

          <DialogFooter>
            {editable ? (
              <>
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
              </>
            ) : (
              <Button onClick={handleClose}>Close</Button>
            )}
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
