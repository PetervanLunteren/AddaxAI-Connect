/**
 * Edit deployment, or Add deployment: a deployment is a camera, a site and
 * a period, and this form shows exactly those. The camera is fixed (photos
 * belong to the camera that took them); the site and the first and last day
 * can change. Opened from a deployment in the camera panel (Edit), from
 * "Give it its own site" in the site panel (an edit too), or for a camera
 * without a site (Add).
 *
 * One rule makes it cover every placement fix: the days given are at that
 * site, and days an edit leaves out go back to the app, which places them
 * from the GPS. So a wrong site is a change of site, a move the GPS missed
 * is a later first day (the days before go back to the app), a first photo a
 * week late is an earlier first day. An edit replaces the corrections that
 * made the deployment (deployment_id on the request), so leaving days out
 * really gives them back; Undo restores what it replaced.
 *
 * Whole days on purpose: a day belongs to one deployment, the day of a move
 * to the new one, the same rule as everywhere in the app.
 *
 * One field per row, each with a caption that says what it is and one thing
 * you cannot see: why the camera is locked, how to pick a site (SiteField,
 * shared with the bulk upload), the camera's first and last photo under the
 * days, so a wrong year stands out. On top a "Now" card with the deployment
 * as it is. The lines above Save say what will happen, in days: what the
 * deployment becomes, which days go back to the app, which days move here
 * from another deployment.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { camerasApi, type CameraDeployment } from '../../api/cameras';
import type { Camera } from '../../api/types';
import { dayLabel } from './moves';
import { sitesApi } from '../../api/sites';
import { SiteField } from '../sites/SiteField';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';

export interface SetDeploymentPrefill {
  // The deployment being edited; null when adding one.
  deploymentId: number | null;
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
  prefill: SetDeploymentPrefill;
  onClose: () => void;
  // Open on "create a new site" at the prefilled spot.
  newSite?: boolean;
  // Called after a successful save, before onClose, with the statement
  // written, so the caller can offer Undo.
  onSaved?: (statementId: number) => void;
}

const inputClass = 'w-full px-3 py-2 border rounded-md text-sm';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

// Days as YYYY-MM-DD strings, compared as text; 'now' stands for an open end.
const shift = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
const span = (from: string, to: string | null) =>
  to === null ? `${dayLabel(from)} to now` : from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`;

/** The sites of the camera's other deployments that cover part of these days. */
function sitesIn(deployments: CameraDeployment[], skipId: number | null, from: string, to: string | null): string {
  const names = deployments
    .filter((d) => d.id !== skipId && d.start_date !== null)
    .filter((d) => (to === null || d.start_date! <= to) && (d.end_date === null || d.end_date >= from))
    .map((d) => d.site_name ?? 'no site');
  return [...new Set(names)].join(' and ');
}

export const SetDeploymentDialog: React.FC<Props> = ({
  projectId, camera, prefill, onClose, newSite = false, onSaved,
}) => {
  const cameraId = camera.id;
  const editing = prefill.deploymentId !== null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [siteId, setSiteId] = useState<number | null>(prefill.siteId);
  const [fromDate, setFromDate] = useState(prefill.fromDate);
  const [untilDate, setUntilDate] = useState(prefill.untilDate ?? '');

  useEffect(() => {
    setSiteId(prefill.siteId);
    setFromDate(prefill.fromDate);
    setUntilDate(prefill.untilDate ?? '');
  }, [prefill]);

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
  });
  const { data: deployments = [] } = useQuery({
    queryKey: ['camera-deployments', cameraId],
    queryFn: () => camerasApi.getDeployments(cameraId),
  });

  // The days the camera has photos: its first deployment or its first photo
  // without a site, to its last photo (camera clock).
  const firstPhotoDay = [...deployments.map((d) => d.start_date), camera.unplaced_first_day]
    .filter((d): d is string => !!d)
    .sort()[0];
  const lastPhotoDay = camera.last_image_timestamp?.slice(0, 10);
  const siteName = sites?.find((s) => s.id === siteId)?.name;
  const originalSiteName = sites?.find((s) => s.id === prefill.siteId)?.name;

  const save = useMutation({
    mutationFn: (site: number) =>
      deploymentsApi.set(projectId, {
        camera_id: cameraId,
        site_id: site,
        from_date: fromDate,
        until_date: untilDate || null,
        deployment_id: prefill.deploymentId,
      }),
    onSuccess: (result) => {
      // Everything that shows where a camera stood.
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
      toast.success('Deployment saved');
      onSaved?.(result.statement_id);
      onClose();
    },
    onError: (error) => toast.error(`Could not save the deployment. ${errMsg(error)}`),
  });

  // What will happen, in days.
  const until = untilDate || null;
  const orig = { from: prefill.fromDate, until: prefill.untilDate };
  const unchanged = editing && siteId === prefill.siteId && fromDate === orig.from && until === orig.until;
  const untilBeforeFrom = until !== null && fromDate !== '' && until < fromDate;
  const effects: string[] = [];
  if (siteName && fromDate && !untilBeforeFrom && !unchanged) {
    effects.push(`${siteName}, ${span(fromDate, until)}.`);
    if (editing) {
      // Left out: the edit no longer covers them.
      if (fromDate > orig.from) {
        effects.push(`${span(orig.from, shift(fromDate, -1))} go back to the app, which places them from the GPS.`);
      }
      if (until !== null && (orig.until === null || until < orig.until)) {
        effects.push(`${span(shift(until, 1), orig.until)} go back to the app, which places them from the GPS.`);
      }
    }
    // Taken: days another deployment of this camera had.
    const takenRanges: [string, string | null][] = editing
      ? [
          ...(fromDate < orig.from ? [[fromDate, shift(orig.from, -1)] as [string, string | null]] : []),
          ...(orig.until !== null && (until === null || until > orig.until)
            ? [[shift(orig.until, 1), until] as [string, string | null]]
            : []),
        ]
      : [[fromDate, until]];
    for (const [from, to] of takenRanges) {
      const from_ = sitesIn(deployments, prefill.deploymentId, from, to);
      if (from_) effects.push(`${span(from, to)} move here from ${from_}.`);
    }
  }
  const canSave = siteId != null && fromDate !== '' && !untilBeforeFrom && !unchanged && !save.isPending;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent onClose={onClose} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit deployment' : 'Add deployment'}</DialogTitle>
            <DialogDescription>One camera at one site, from a first day to a last day.</DialogDescription>
          </DialogHeader>
          <form
            className="py-2 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate(siteId!);
            }}
          >
            {editing && (
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">Now</p>
                <p className="text-sm">
                  {camera.name} at <span className="font-medium">{originalSiteName ?? 'no site'}</span>,{' '}
                  {span(prefill.fromDate, prefill.untilDate)}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="set-deployment-camera">Camera</label>
              <input id="set-deployment-camera" value={camera.name} disabled className={`${inputClass} bg-muted/50 text-muted-foreground`} />
              <p className="text-xs text-muted-foreground">Cannot change. Photos stay with the camera that took them.</p>
            </div>

            <SiteField
              projectId={projectId}
              value={siteId}
              onChange={setSiteId}
              caption="Where the camera stood. Pick it from the list or click its pin on the map."
              fitIds={[prefill.siteId]}
              newSiteAt={{ lat: prefill.lat, lon: prefill.lon }}
              startCreating={newSite}
            />

            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="set-deployment-from">First day</label>
              <input
                id="set-deployment-from"
                type="date"
                required
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-muted-foreground">
                The day the camera was put here.
                {firstPhotoDay && ` Its first photo is from ${dayLabel(firstPhotoDay)}.`}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="set-deployment-until">Last day</label>
              <input
                id="set-deployment-until"
                type="date"
                value={untilDate}
                onChange={(e) => setUntilDate(e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty while it is still there.
                {lastPhotoDay && ` Its last photo is from ${dayLabel(lastPhotoDay)}.`}
              </p>
            </div>

            {/* Pinned to the bottom: with the map the form can be taller
                than the window. What will happen and Save stay in view
                together, so the result is read before the click. */}
            <div className="sticky -bottom-6 -mx-6 -mb-6 space-y-3 border-t bg-background px-6 py-4">
              {untilBeforeFrom ? (
                <p className="text-sm text-destructive">The last day cannot be before the first day.</p>
              ) : unchanged ? (
                <p className="text-sm text-muted-foreground">Nothing changed yet.</p>
              ) : (
                effects.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {effects.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSave}>
                  {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </>
  );
};
