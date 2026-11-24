/**
 * Edit deployment (from a deployment in the camera panel) or Set site (a
 * camera without a site, "Give it its own site"): say where a camera stood,
 * from one day until another, or until now. One form for every placement
 * fix: a wrong site, a move the GPS missed (the new site from the day of the
 * move), a camera without GPS, a camera that needs its own site, a first day
 * earlier than the first photo.
 *
 * The one form for every way to place a camera: placing a camera without
 * GPS, changing the site of a deployment the GPS made, and correcting the
 * past. It writes a fixed period on the server. The GPS does not change that
 * period, and it can be undone under Corrections in the camera panel.
 *
 * Whole days on purpose: a day belongs to one deployment, the day of a move
 * to the new one, the same rule as everywhere in the app. The caller prefills
 * the days and the site.
 *
 * A small map under the site (SitePickMap, as in Merge site) shows where the
 * sites are, the chosen one magenta, and a click on a pin chooses it: site
 * names often say nothing about place. It starts on the site the camera has
 * now and the chosen one.
 *
 * Two lines say what will happen, since the form writes only these days and
 * the app works out the rest again from the GPS: a sentence with the result,
 * and the days the camera has photos, so a wrong year stands out.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { camerasApi } from '../../api/cameras';
import type { Camera } from '../../api/types';
import { dayLabel } from './moves';
import { sitesApi } from '../../api/sites';
import { SiteFormModal } from '../sites/SiteFormModal';
import { SitePickMap } from '../sites/SitePickMap';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';

export interface SetDeploymentPrefill {
  siteId: number | null;
  fromDate: string; // YYYY-MM-DD
  untilDate: string | null; // YYYY-MM-DD, null = still there
  // Where the camera's own GPS put it, for a new site. Null without GPS.
  lat: number | null;
  lon: number | null;
}

interface Props {
  projectId: number;
  camera: Camera;
  // "Edit deployment" from a deployment, "Set site" otherwise.
  title?: string;
  prefill: SetDeploymentPrefill;
  onClose: () => void;
  // Open on "create a new site" at the prefilled spot: a click on an empty
  // spot of the map in the moves check.
  newSite?: boolean;
  // Called after a successful save, before onClose, with the statement
  // written, so the caller can offer Undo.
  onSaved?: (statementId: number) => void;
}

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

export const SetDeploymentDialog: React.FC<Props> = ({
  projectId, camera, title = 'Set site', prefill, onClose, newSite = false, onSaved,
}) => {
  const cameraId = camera.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [siteId, setSiteId] = useState<number | null>(prefill.siteId);
  const [fromDate, setFromDate] = useState(prefill.fromDate);
  const [untilDate, setUntilDate] = useState(prefill.untilDate ?? '');
  const [creatingSite, setCreatingSite] = useState(newSite);

  useEffect(() => {
    setSiteId(prefill.siteId);
    setFromDate(prefill.fromDate);
    setUntilDate(prefill.untilDate ?? '');
  }, [prefill]);

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
  });

  // The days the camera has photos: its first deployment or its first photo
  // without a site, to its last photo (camera clock).
  const { data: deployments } = useQuery({
    queryKey: ['camera-deployments', cameraId],
    queryFn: () => camerasApi.getDeployments(cameraId),
  });
  const firstPhotoDay = [...(deployments ?? []).map((d) => d.start_date), camera.unplaced_first_day]
    .filter((d): d is string => !!d)
    .sort()[0];
  const lastPhotoDay = camera.last_image_timestamp?.slice(0, 10);
  const siteName = sites?.find((s) => s.id === siteId)?.name;

  const save = useMutation({
    mutationFn: (site: number) =>
      deploymentsApi.set(projectId, {
        camera_id: cameraId,
        site_id: site,
        from_date: fromDate,
        until_date: untilDate || null,
      }),
    onSuccess: (result) => {
      // Everything that shows where a camera stood.
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
      toast.success('Site set');
      onSaved?.(result.statement_id);
      onClose();
    },
    onError: (error) => toast.error(`Could not set the site. ${errMsg(error)}`),
  });

  const untilBeforeFrom = untilDate !== '' && fromDate !== '' && untilDate < fromDate;
  const canSave = siteId != null && fromDate !== '' && !untilBeforeFrom && !save.isPending;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent onClose={onClose}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Where camera {camera.name} stood. The photos of these days move to
              this site. You can undo this in the camera panel.
            </DialogDescription>
          </DialogHeader>
          <form
            className="py-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate(siteId!);
            }}
          >
            <div>
              <label className="block text-sm font-medium mb-2">Site</label>
              <Select
                value={siteId ?? ''}
                onChange={(e) => setSiteId(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Pick a site</option>
                {(sites ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => setCreatingSite(true)}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Or create a new site
              </button>
              {sites && (
                <div className="mt-2">
                  <SitePickMap
                    sites={sites}
                    selectedId={siteId}
                    onSelect={setSiteId}
                    fitIds={[prefill.siteId, siteId]}
                    height={200}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="set-deployment-from">First day</label>
                <input
                  id="set-deployment-from"
                  type="date"
                  required
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="set-deployment-until">Last day</label>
                <input
                  id="set-deployment-until"
                  type="date"
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty when the camera is still there.</p>
              </div>
            </div>
            {firstPhotoDay && lastPhotoDay && (
              <p className="text-xs text-muted-foreground -mt-2">
                This camera has photos from {dayLabel(firstPhotoDay)} to {dayLabel(lastPhotoDay)}.
              </p>
            )}
            {untilBeforeFrom ? (
              <p className="text-sm text-destructive">The last day cannot be before the first day.</p>
            ) : (
              siteName && fromDate && (
                // What will happen. Only these days are written; the app
                // works out every other day again, so they may change too.
                <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  {siteName} from {dayLabel(fromDate)} {untilDate ? `until ${dayLabel(untilDate)}` : 'until now'}.
                  {' '}The app works out the other days again from the GPS.
                </p>
              )
            )}
            {/* Pinned to the bottom: with the map the form can be taller
                than the window, and Save must not scroll out of view. */}
            <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {creatingSite && (
        <SiteFormModal
          open
          onClose={() => setCreatingSite(false)}
          projectId={projectId}
          sites={sites ?? []}
          defaultLat={prefill.lat}
          defaultLon={prefill.lon}
          onCreated={(site) => {
            setCreatingSite(false);
            setSiteId(site.id);
          }}
        />
      )}
    </>
  );
};
