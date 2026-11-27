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
import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { deploymentKeys, deploymentsApi, invalidateDeployments } from '../../api/deployments';
import { camerasApi, type CameraDeployment } from '../../api/cameras';
import type { PhotoSet } from '../../lib/panel-links';
import { errorDetail } from '../../lib/utils';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { DeploymentJourney, type JourneyItem } from '../DeploymentJourney';
import { dayLabel, daySpan, daysOverlap, placeName, today } from './format';
import { PhotoLinks } from './PhotoLinks';
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
  cameraId: number;
  cameraName: string;
  prefill: SetDeploymentPrefill;
  // Add deployment only: the days of the camera's first and last photo
  // without a site, for the hints under the two days.
  unplacedDays?: { first: string | null; last: string | null };
  onClose: () => void;
}

const inputClass = 'w-full px-3 py-2 border rounded-md text-sm';

// Days a person can set, the same bounds as the server (check_days in
// utils/deployment_edits.py): no day after today. The server takes today in
// its own timezone and has the last word. A year typed digit by digit
// (0002, 0202) is a real date the preview must not send.
const FIRST_DAY = '2000-01-01';
const settable = (day: string) => day >= FIRST_DAY && day <= today();

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
const shareDays = (a: CameraDeployment, b: CameraDeployment) =>
  daysOverlap(a.start_date, a.end_date, b.start_date, b.end_date);

export const SetDeploymentDialog: React.FC<Props> = ({
  projectId, cameraId, cameraName, prefill, unplacedDays, onClose,
}) => {
  const editing = prefill.deploymentId !== null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [siteId, setSiteId] = useState<number | null>(prefill.siteId);
  const [fromDate, setFromDate] = useState(prefill.fromDate);
  const [untilDate, setUntilDate] = useState(prefill.untilDate ?? '');

  const { data: deployments = [] } = useQuery({
    queryKey: deploymentKeys.ofCamera(cameraId),
    queryFn: () => camerasApi.getDeployments(cameraId),
  });

  const editedCard = deployments.find((d) => d.id === prefill.deploymentId);
  // The photos the hints under the days talk about: those of the deployment
  // being edited ("here"), or, when adding one, the camera's photos without
  // a site, which is what Add deployment is for.
  const photosWhere = editing ? 'here' : 'without a site';
  const firstPhotoDay = editing ? editedCard?.first_photo_day : unplacedDays?.first;
  const lastPhotoDay = editing ? editedCard?.last_photo_day : unplacedDays?.last;
  // The photos this form is about, for the links to Images and Curation:
  // the deployment as it is now, or the camera's photos without a site.
  const shownPhotos: PhotoSet | null = editing
    ? editedCard ? { cameraId, firstDay: editedCard.start_date, lastDay: editedCard.end_date } : null
    : unplacedDays?.first ? { cameraId, firstDay: unplacedDays.first, lastDay: unplacedDays.last, noSite: true } : null;

  const save = useMutation({
    mutationFn: (site: number) =>
      deploymentsApi.set(projectId, {
        camera_id: cameraId,
        site_id: site,
        from_date: fromDate,
        until_date: untilDate || null,
        deployment_id: prefill.deploymentId,
      }),
    onSuccess: () => {
      invalidateDeployments(queryClient, projectId);
      toast.success('Deployment saved');
      onClose();
    },
    onError: (error) => toast.error(`Could not save the deployment. ${errorDetail(error)}`),
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
    queryKey: [...deploymentKeys.ofCamera(cameraId), 'preview', prefill.deploymentId, askedKey],
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
    b.id !== prefill.deploymentId && !after.some((a) => a.site_id === b.site_id && shareDays(a, b)));
  const showPreview = canSave && preview.data !== undefined;

  return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent onClose={onClose} className="max-w-2xl lg:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit deployment' : 'Add deployment'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Camera ${cameraName} at one site, from a first day to a last day.`
                : `Where camera ${cameraName} stood, from a first day to a last day.`}
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
                      max={today()}
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className={inputClass}
                    />
                    <p className="text-xs text-muted-foreground">
                      The day the camera was put here.
                      {firstPhotoDay && ` The first photo ${photosWhere} is from ${dayLabel(firstPhotoDay)}.`}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="set-deployment-until">Last day</label>
                    <input
                      id="set-deployment-until"
                      type="date"
                      min={FIRST_DAY}
                      max={today()}
                      value={untilDate}
                      onChange={(e) => setUntilDate(e.target.value)}
                      className={inputClass}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave empty while it is still there.
                      {lastPhotoDay && ` The last photo ${photosWhere} is from ${dayLabel(lastPhotoDay)}.`}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-md bg-muted/50 p-3 self-start">
                {editing && editedCard && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Now</p>
                    <DeploymentJourney items={[card(cameraName)(editedCard)]} emptyText="" />
                  </div>
                )}
                {shownPhotos && (
                  <p className="text-xs text-muted-foreground">
                    {editing ? 'Its photos' : 'The photos without a site'}{' '}
                    <PhotoLinks projectId={projectId} photos={shownPhotos} />
                  </p>
                )}
                {showPreview && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">After saving</p>
                    {changed.length > 0 && (
                      <DeploymentJourney
                        items={changed.map(card(cameraName))}
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
                        The deployment at {placeName(d.site_name)}, {daySpan(d.start_date, d.end_date)}, goes.
                      </p>
                    ))}
                    {changed.length === 0 && lostPhotos <= 0 && gone.length === 0 && (
                      <p className="text-sm text-muted-foreground">Nothing changes.</p>
                    )}
                  </div>
                )}
                {!(editing && editedCard) && !showPreview && !shownPhotos && (
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
                <p className="text-sm text-destructive">Days must lie between 1 January 2000 and today.</p>
              ) : unchanged ? (
                <p className="text-sm text-muted-foreground">Nothing changed yet.</p>
              ) : preview.isError ? (
                <p className="text-sm text-destructive">Could not work out the result. {errorDetail(preview.error)}</p>
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
  );
};
