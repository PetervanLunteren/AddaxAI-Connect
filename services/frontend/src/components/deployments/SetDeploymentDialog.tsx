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
 * A small map under the site (SitePickMap) shows where the sites are. The
 * lines above Save say what will happen, in days: what the deployment
 * becomes, which days go back to the app, which days move here from another
 * deployment. Under the days, the days the camera has photos, so a wrong
 * year stands out.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { camerasApi, type CameraDeployment } from '../../api/cameras';
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
        <DialogContent onClose={onClose}>
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
            {/* The camera is fixed: photos belong to the camera that took them. */}
            <div className="flex items-baseline justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Camera</span>
              <span className="font-medium truncate">{camera.name}</span>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" htmlFor="set-deployment-site">Site</label>
              <Select
                id="set-deployment-site"
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
                    height={160}
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
                <p className="text-xs text-muted-foreground mt-1">Empty: the camera is still there.</p>
              </div>
            </div>
            {firstPhotoDay && lastPhotoDay && (
              <p className="text-xs text-muted-foreground -mt-2">
                Photos of this camera: {dayLabel(firstPhotoDay)} to {dayLabel(lastPhotoDay)}.
              </p>
            )}

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
