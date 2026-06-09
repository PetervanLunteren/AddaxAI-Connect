/**
 * Deployment detail slideout.
 *
 * Opened by clicking a row on the Deployments page, matching the camera and site
 * detail sheets. Shows which camera stood where and when, a few photos, and the
 * two editable fields: the site assignment and an optional position label.
 * Saving a site marks site_source='manual' (a human confirmed it); the label
 * tells apart the cameras at one site. Neither changes ingestion. Non-admins see
 * the same panel read-only (canEdit=false).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { QueryKey } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Plus, CalendarClock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from './ui/Sheet';
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
  // How the site was assigned: 'auto' (GPS-guessed) or 'manual' (human-confirmed).
  initialSiteSource?: string;
  // The deployment's current position label ("North"), or null.
  initialLabel?: string | null;
  // Whether the viewer may edit. False shows the panel read-only.
  canEdit: boolean;
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

export const DeploymentDetailSheet: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  deploymentId,
  cameraName,
  initialSiteId,
  initialSiteSource,
  initialLabel,
  canEdit,
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

  // Inputs are read-only for viewers, and locked mid-save for everyone.
  const locked = !canEdit || saveMutation.isPending;

  // Identify the deployment by camera and time range; the site lives in the
  // dropdown below, so it is not repeated here.
  const period = startDate
    ? `${fmtDate(startDate)} to ${endDate ? fmtDate(endDate) : 'now'}`
    : null;
  const subhead = period ? `Camera ${cameraName}, ${period}` : `Camera ${cameraName}`;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
        <SheetContent onClose={handleClose}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 pr-8">
              <CalendarClock className="h-5 w-5" />
              {subhead}
            </SheetTitle>
          </SheetHeader>

          <SheetBody className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Site</label>
                {initialSiteId != null && (
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      initialSiteSource === 'manual'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {initialSiteSource === 'manual' ? 'Human-confirmed' : 'GPS-guessed'}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={siteId ?? ''}
                  onChange={(e) =>
                    setSiteId(e.target.value === '' ? null : Number(e.target.value))
                  }
                  disabled={locked}
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
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateSite(true)}
                    disabled={locked}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    New site
                  </Button>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. North"
                maxLength={100}
                disabled={locked}
                className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted"
              />
            </div>

            {thumbUuids && thumbUuids.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">A few random photos</label>
                  <Link
                    to={`/projects/${projectId}/images?deployment_id=${deploymentId}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    View all images
                  </Link>
                </div>
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
          </SheetBody>

          <SheetFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={saveMutation.isPending}
            >
              {canEdit ? 'Cancel' : 'Close'}
            </Button>
            {canEdit && (
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
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
