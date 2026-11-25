/**
 * Edit deployment, or Add deployment: a deployment is a camera, a site and
 * a period, and this form shows exactly those. The camera is fixed (photos
 * belong to the camera that took them); the site and the first and last day
 * can change. Opened from Edit on a deployment card (camera or site panel)
 * or for a camera without a site (Set site, which adds one).
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
 * Two columns from laptop width, one below: on the left what you change,
 * the site (SiteField, shared with the bulk upload) and the two days, each
 * with a caption (how to pick a site, the camera's first and last photo, so
 * a wrong year stands out); on the right, on grey, Now (the deployment as
 * it is, as the same card as in the panels) and After saving: the cards the
 * save leaves, only those that differ from now. They come from the
 * server, which does the edit and rolls it back (preview), so they are the
 * rebuild's own answer: a shortened deployment shows as two cards, days
 * taken from a neighbour show as that neighbour, shorter. Two lines say
 * what a card cannot: photos left without a site, a deployment that goes.
 */
import React, { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { camerasApi, type CameraDeployment } from '../../api/cameras';
import type { Camera } from '../../api/types';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { DeploymentJourney, type JourneyItem } from '../DeploymentJourney';
import { dayLabel } from './moves';
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
  // Called after a successful save, before onClose, with the statement
  // written, so the caller can offer Undo.
  onSaved?: (statementId: number) => void;
}

const inputClass = 'w-full px-3 py-2 border rounded-md text-sm';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

// Days a person can set, the same bounds as the server (FIRST_SETTABLE_DAY,
// DAYS_AHEAD in routers/deployments.py). A year typed digit by digit (0002,
// 0202) is a real date the preview must not send.
const FIRST_DAY = '2000-01-01';
const lastSettableDay = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 366);
  return d.toISOString().slice(0, 10);
};
const settable = (day: string) => day >= FIRST_DAY && day <= lastSettableDay();

const card = (cameraName: string) => (d: CameraDeployment): JourneyItem => ({
  id: d.id,
  siteName: d.site_name,
  cameraName,
  startDate: d.start_date,
  endDate: d.end_date,
  imageCount: d.image_count,
});

// A card's content: what it shows. Two cards of one camera never share days,
// so equal content is the same deployment. Ids are not compared: after a
// split the old id can go to either part.
const same = (a: CameraDeployment, b: CameraDeployment) =>
  a.site_id === b.site_id && a.start_date === b.start_date && a.end_date === b.end_date &&
  a.image_count === b.image_count;
const overlaps = (a: CameraDeployment, b: CameraDeployment) =>
  (a.end_date === null || b.start_date === null || b.start_date <= a.end_date) &&
  (b.end_date === null || a.start_date === null || a.start_date <= b.end_date);
const span = (d: CameraDeployment) =>
  `${d.start_date ? dayLabel(d.start_date) : '-'} to ${d.end_date ? dayLabel(d.end_date) : 'now'}`;

export const SetDeploymentDialog: React.FC<Props> = ({
  projectId, camera, prefill, onClose, onSaved,
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
  const editedCard = deployments.find((d) => d.id === prefill.deploymentId);

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

  const until = untilDate || null;
  const unchanged = editing && siteId === prefill.siteId && fromDate === prefill.fromDate &&
    until === prefill.untilDate;
  const untilBeforeFrom = until !== null && fromDate !== '' && until < fromDate;
  const daysSettable = fromDate !== '' && settable(fromDate) && (until === null || settable(until));
  const canSave = siteId != null && daysSettable && !untilBeforeFrom && !unchanged && !save.isPending;

  // After saving: the server's answer for the form as it is, asked once the
  // form stopped changing for a moment. Never cached or retried: a stale or
  // repeated preview would not be what Save does. A newer edit cancels the
  // request before it.
  // As text, so a re-render with the same values is the same value.
  const current = JSON.stringify({ site_id: siteId, from_date: fromDate, until_date: until, ok: canSave });
  const askedKey = useDebouncedValue(current, 400);
  const asked = JSON.parse(askedKey) as { site_id: number | null; from_date: string; until_date: string | null; ok: boolean };
  const preview = useQuery({
    queryKey: ['camera-deployments', cameraId, 'preview', prefill.deploymentId, askedKey],
    queryFn: ({ signal }) => deploymentsApi.preview(projectId, {
      camera_id: cameraId,
      site_id: asked.site_id!,
      from_date: asked.from_date,
      until_date: asked.until_date,
      deployment_id: prefill.deploymentId,
    }, signal),
    enabled: asked.ok && asked.site_id != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const before = preview.data?.before ?? [];
  const after = preview.data?.after ?? [];
  const changed = after.filter((a) => !before.some((b) => same(a, b)));
  // A card cannot show these: photos left without a site (a camera without
  // GPS), and a neighbour the edit takes whole.
  const lostPhotos = before.reduce((n, d) => n + d.image_count, 0) - after.reduce((n, d) => n + d.image_count, 0);
  const gone = before.filter((b) =>
    b.id !== prefill.deploymentId && !after.some((a) => a.site_id === b.site_id && overlaps(a, b)));
  const showPreview = canSave && preview.data !== undefined;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent onClose={onClose} className="max-w-2xl lg:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit deployment' : 'Add deployment'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Camera ${camera.name} at one site, from a first day to a last day.`
                : `Where camera ${camera.name} stood, from a first day to a last day.`}
            </DialogDescription>
          </DialogHeader>
          <form
            className="py-2 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate(siteId!);
            }}
          >
            {/* Two columns on a laptop and wider: what you change on the
                left, Now and After saving on the right, so the result stays
                in view while you edit. One column, edits first, below that. */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="space-y-4 min-w-0">
                <SiteField
                  projectId={projectId}
                  value={siteId}
                  onChange={setSiteId}
                  caption="Where the camera stood. Pick it from the list or click its pin on the map."
                  fitIds={[prefill.siteId]}
                  newSiteAt={{ lat: prefill.lat, lon: prefill.lon }}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="set-deployment-from">First day</label>
                    <input
                      id="set-deployment-from"
                      type="date"
                      required
                      min={FIRST_DAY}
                      max={lastSettableDay()}
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
                      min={FIRST_DAY}
                      max={lastSettableDay()}
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                      className={inputClass}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave empty while it is still there.
                      {lastPhotoDay && ` Its last photo is from ${dayLabel(lastPhotoDay)}.`}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-md bg-muted/50 p-3 self-start">
                {editing && editedCard && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Now</p>
                    <DeploymentJourney items={[card(camera.name)(editedCard)]} emptyText="" />
                  </div>
                )}
                {showPreview && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">After saving</p>
                    {changed.length > 0 && (
                      <DeploymentJourney
                        items={changed.map(card(camera.name))}
                        emptyText=""
                        dimmed={preview.isPlaceholderData || askedKey !== current}
                      />
                    )}
                    {lostPhotos > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {lostPhotos} {lostPhotos === 1 ? 'photo has' : 'photos have'} no site then.
                      </p>
                    )}
                    {gone.map((d) => (
                      <p key={d.id} className="text-xs text-muted-foreground">
                        The deployment at {d.site_name ?? 'no site'}, {span(d)}, goes.
                      </p>
                    ))}
                    {changed.length === 0 && lostPhotos <= 0 && gone.length === 0 && (
                      <p className="text-sm text-muted-foreground">Nothing changes.</p>
                    )}
                  </div>
                )}
                {!(editing && editedCard) && !showPreview && (
                  <p className="text-sm text-muted-foreground">What Save does shows here.</p>
                )}
              </div>
            </div>

            {/* Pinned to the bottom: with the map the form can be taller
                than the window. One status line and Save stay in view; the
                cards above scroll with the form. */}
            <div className="sticky -bottom-6 -mx-6 -mb-6 space-y-3 border-t bg-background px-6 py-4">
              {untilBeforeFrom ? (
                <p className="text-sm text-destructive">The last day cannot be before the first day.</p>
              ) : fromDate !== '' && !daysSettable ? (
                <p className="text-sm text-destructive">Days must lie between 1 January 2000 and a year from now.</p>
              ) : unchanged ? (
                <p className="text-sm text-muted-foreground">Nothing changed yet.</p>
              ) : preview.isError ? (
                <p className="text-sm text-destructive">Could not work out the result. {errMsg(preview.error)}</p>
              ) : canSave && (preview.isFetching || !showPreview) ? (
                <p className="text-sm text-muted-foreground">Working out the result</p>
              ) : null}
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
