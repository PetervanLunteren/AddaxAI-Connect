/**
 * One deployment in the frame of image verification: the map big on the
 * left, the deployment right. It opens on a row of the Deployments page and
 * steps through the rows as the table shows them, filtered and sorted. The
 * queue is fixed when the window opens, so a changed row does not jump away.
 *
 * Right, top to bottom:
 * - the deployment's card (DeploymentCards), the same as in the camera and
 *   site panels: Edit, the corrections with Undo, links to the camera, the
 *   site and the photos;
 * - the evidence: where it moved from, the last photo there next to the
 *   first one here (or the first two photos, when it did not move);
 * - only for a suspicious deployment (rows.ts), one question, did the camera
 *   really go there. The card has no Edit then, so the question stands
 *   alone:
 *   - Right (Enter, PUT .../deployments/checked) clears the warning and
 *     records who said so. The window then shows that, with Undo.
 *   - Wrong (W, POST .../deployments/{id}/not-moved): the GPS was off, the
 *     camera stayed. One correction at the old site, at once, with Undo on
 *     the spot instead of a confirmation before it. After Undo the
 *     deployment comes back under the same key and asks again.
 * Every other deployment asks nothing; a person fixes it with Edit.
 *
 * The arrows step without answering, Esc closes, and past the last row the
 * window closes, as image verification does.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Loader2, Undo2, X } from 'lucide-react';
import { deploymentsApi, type DeploymentListItem, type DeploymentPhoto } from '../../api/deployments';
import { formatDateTime } from '../../utils/datetime';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import { REVIEW_WINDOW_CLASS } from '../ui/review-window';
import { useToast } from '../ui/Toaster';
import { openOverlayCount } from '../ui/useOverlayLayer';
import type { SitePin } from '../sites/SiteMarkersLayer';
import { DeploymentCards, type DeploymentCardData } from './DeploymentCards';
import { DeploymentStatus } from './DeploymentStatus';
import { DeploymentsMap, type MapArrow } from './DeploymentsMap';
import { dayLabel, metresLabel, placeName, SUSPICIOUS_REASON, type DeploymentRow } from './rows';

interface Props {
  projectId: number;
  rows: DeploymentRow[]; // every deployment, kept fresh by the page
  sites: SitePin[];
  keys: string[]; // the rows of the table as shown, in order
  startKey: string; // the row clicked
  onClose: () => void;
}

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

const toCard = (d: DeploymentListItem): DeploymentCardData => ({
  id: d.id,
  cameraId: d.camera_id,
  cameraName: d.camera_label ?? `Camera ${d.camera_id}`,
  siteId: d.site_id,
  siteName: d.site_name,
  startDate: d.start_date,
  endDate: d.end_date,
  imageCount: d.image_count,
  lat: d.latitude,
  lon: d.longitude,
});

/** Whether two deployments share a day (YYYY-MM-DD, null end = open). */
const sharesDays = (a: DeploymentListItem, b: DeploymentListItem) =>
  a.start_date !== null && b.start_date !== null &&
  (a.end_date === null || a.end_date >= b.start_date) &&
  (b.end_date === null || b.end_date >= a.start_date);

/** A Wrong answered in this window: the correction it made, for Undo. */
interface Wrong {
  statementId: number;
  oldSite: string;
}

export const DeploymentWindow: React.FC<Props> = ({ projectId, rows, sites, keys: rowKeys, startKey, onClose }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [queue] = useState<string[]>(rowKeys);
  const [current, setCurrent] = useState<string>(startKey);
  const [wrongs, setWrongs] = useState<Record<string, Wrong>>({});

  const index = queue.indexOf(current);
  const row = rows.find((r) => r.key === current) ?? null;
  const wrong = wrongs[current];
  const d = row?.deployment;
  const p = row?.previous;

  // An Edit or an Undo can change where a deployment starts, and with that
  // its key. The window then shows what those days are now, as cards with
  // Edit, so a split is seen and its new part can be edited next. It
  // remembers each deployment it showed for that.
  const seen = useRef(new Map<string, DeploymentListItem>());
  if (d) seen.current.set(current, d);
  const was = seen.current.get(current);
  const changed = !row && was
    ? rows.map((r) => r.deployment).filter((x) => x.camera_id === was.camera_id && sharesDays(x, was))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
    : [];

  // A deployment can disappear while the window is open (an Edit or an
  // Undo on its card, a Wrong on its neighbour): stepping skips those.
  const gone = (key: string) => !wrongs[key] && !seen.current.has(key) && !rows.some((r) => r.key === key);
  const goTo = (target: number) => {
    const step = target < index ? -1 : 1;
    let i = target;
    while (i >= 0 && i < queue.length && gone(queue[i])) i += step;
    if (i >= queue.length) onClose();
    else if (i >= 0) setCurrent(queue[i]);
  };
  const next = () => goTo(index + 1);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['site', projectId] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };

  // The evidence: the last photo before the move and the first after it,
  // or the first two photos of a deployment that did not move.
  const { data: before } = useQuery({
    queryKey: ['deployment-photos', projectId, p?.id, 'last'],
    queryFn: () => deploymentsApi.photos(projectId, p!.id, 'last', 1),
    enabled: !!p,
  });
  const { data: after } = useQuery({
    queryKey: ['deployment-photos', projectId, d?.id, 'first', p ? 1 : 2],
    queryFn: () => deploymentsApi.photos(projectId, d!.id, 'first', p ? 1 : 2),
    enabled: !!d,
  });

  // Each answer carries its own row: the window may have stepped on by the
  // time the server answers, so `current` is not the row it was about.
  const right = useMutation({
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) =>
      deploymentsApi.setChecked(projectId, [id], checked),
    onSuccess: refresh,
    onError: (error) => toast.error(`Could not save. ${errMsg(error)}`),
  });
  const notMoved = useMutation({
    mutationFn: ({ id }: { id: number; key: string; oldSite: string }) => deploymentsApi.notMoved(projectId, id),
    onSuccess: (result, { key, oldSite }) => {
      setWrongs((w) => ({ ...w, [key]: { statementId: result.statement_id, oldSite } }));
      refresh();
    },
    onError: (error) => toast.error(`Could not save. ${errMsg(error)}`),
  });
  const undoWrong = useMutation({
    mutationFn: ({ statementId }: { statementId: number; key: string }) =>
      deploymentsApi.removeFixedPeriod(projectId, statementId),
    onSuccess: (_, { key }) => {
      setWrongs(({ [key]: _done, ...rest }) => rest);
      refresh();
    },
    onError: (error) => toast.error(`Could not undo. ${errMsg(error)}`),
  });
  const answerRight = () => d && right.mutate({ id: d.id, checked: true });
  const answerWrong = () => d && notMoved.mutate({ id: d.id, key: current, oldSite: placeName(p?.site_name) });
  const busy = right.isPending || notMoved.isPending || undoWrong.isPending;
  const asks = !!row?.suspicious && !wrong;

  // Keys as in image verification: Enter Right (or on, when there is no
  // question), W Wrong, arrows step, Esc closes (the dialog does that).
  // Quiet while a field has focus or a window above this one is open. The
  // listener reads the latest state through a ref, so it is added once.
  const latest = useRef({ goTo, index, asks, busy, right: answerRight, wrong: answerWrong });
  latest.current = { goTo, index, asks, busy, right: answerRight, wrong: answerWrong };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = latest.current;
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (openOverlayCount() > 1) return; // the Edit form or a confirmation on top
      // Enter on a focused button presses that button, nothing more.
      if (e.key === 'Enter' && el.tagName === 'BUTTON') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); k.goTo(k.index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); k.goTo(k.index - 1); }
      else if (e.key === 'Enter' && !k.busy) { e.preventDefault(); if (k.asks) k.right(); else k.goTo(k.index + 1); }
      else if ((e.key === 'w' || e.key === 'W') && k.asks && !k.busy) { e.preventDefault(); k.wrong(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // From site to site, so the arrow meets the two magenta markers.
  const arrows: MapArrow[] = useMemo(() => {
    const at = (siteId: number | null | undefined): [number, number] | null => {
      const site = sites.find((s) => s.id === siteId);
      return site && site.latitude != null && site.longitude != null ? [site.latitude, site.longitude] : null;
    };
    const from = at(p?.site_id);
    const to = at(d?.site_id);
    if (!from || !to) return [];
    return [{ key: current, from, to, label: `${placeName(p!.site_name)} to ${placeName(d!.site_name)}` }];
  }, [current, d, p, sites]);
  // Magenta on the map: both ends of a move, or the one site, or the sites
  // of what a changed deployment is now.
  const active = useMemo(
    () => new Set([d?.site_id, p?.site_id, ...changed.map((x) => x.site_id)].filter((id): id is number => id != null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, p, changed.map((x) => x.id).join()],
  );

  // Previous, next, position and close, as in the image verification panel.
  const header = (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" onClick={() => goTo(index - 1)} disabled={index <= 0} title="Previous (←)">
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" onClick={next} title="Next (→)">
        <ChevronRight className="h-5 w-5" />
      </Button>
      <span className="flex-1 ml-1 text-sm text-muted-foreground tabular-nums">
        {`${index + 1} of ${queue.length}`}
      </span>
      <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)">
        <X className="h-5 w-5" />
      </Button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <div className={`${REVIEW_WINDOW_CLASS} overflow-y-auto overflow-x-hidden`} role="dialog" aria-label="Deployment">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-6">
          {/* The map fills its column, as tall as the cards next to it and
              never lower than now. On a phone, where the columns stack, it
              has that height. */}
          <div className="md:col-span-2 min-w-0 h-[min(65vh,640px)] md:h-auto md:min-h-[min(65vh,640px)]">
            {/* A new map per row and per set of highlighted sites: it fits
                once when it opens, so after an edit moves the deployment to
                another site it fits again on the new one. */}
            <DeploymentsMap
              key={`${current}|${[...active].sort().join()}`}
              sites={sites}
              activeSiteIds={active.size === 0 ? null : active}
              arrows={arrows}
              height="100%"
            />
          </div>

          <div className="space-y-4 min-w-0">
            {header}
            {wrong ? (
              <Card>
                <CardContent className="pt-4 pb-3 space-y-3 text-sm">
                  <p>The camera stayed at {wrong.oldSite}. Its photos are back there.</p>
                  <Button className="w-full" onClick={next}>
                    Next
                    <Kbd onPrimary>→</Kbd>
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => undoWrong.mutate({ statementId: wrong.statementId, key: current })} disabled={busy}>
                    <Undo2 className="h-4 w-4 mr-2" />
                    Undo
                  </Button>
                </CardContent>
              </Card>
            ) : !row && changed.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">This deployment is now</p>
                <DeploymentCards
                  projectId={projectId}
                  deployments={changed.map(toCard)}
                  canEdit
                  emptyText=""
                />
              </>
            ) : !row || !d ? (
              <Card>
                <CardContent className="pt-4 pb-3 text-sm text-center text-muted-foreground">
                  This deployment no longer exists
                </CardContent>
              </Card>
            ) : (
              <>
                <DeploymentCards
                  projectId={projectId}
                  deployments={[toCard(d)]}
                  canEdit={!asks}
                  emptyText=""
                  hideSuspicious
                />

                <Card>
                  <CardContent className="pt-4 pb-3 space-y-3 text-sm">
                    {p && (
                      <p>
                        Moved from {placeName(p.site_name)}
                        {row.distanceM !== undefined && <span className="text-muted-foreground"> · {metresLabel(row.distanceM)}</span>}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {p && <Photo projectId={projectId} photo={before?.[0]} label={`Last photo at ${placeName(p.site_name)}`} />}
                      {(after ?? []).map((photo, i) => (
                        <Photo
                          key={photo.uuid}
                          projectId={projectId}
                          photo={photo}
                          label={i === 0 ? `First photo at ${placeName(d.site_name)}` : 'Next photo'}
                        />
                      ))}
                    </div>

                    {asks && (
                      <div className="space-y-3 border-t pt-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <DeploymentStatus row={row} />
                          <span>{SUSPICIOUS_REASON}</span>
                        </div>
                        <p className="font-medium">
                          Did the camera really go to {placeName(d.site_name)}?
                        </p>
                        <Button className="w-full" onClick={answerRight} disabled={busy}>
                          {right.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                          Right, it went there
                          <Kbd onPrimary>⏎</Kbd>
                        </Button>
                        <Button variant="outline" className="w-full" onClick={answerWrong} disabled={busy}>
                          <X className="h-4 w-4 mr-2" />
                          Wrong, it stayed at {placeName(p?.site_name)}
                          <Kbd>W</Kbd>
                        </Button>
                      </div>
                    )}

                    {/* A short trip somebody marked right: who and when,
                        with Undo, which makes it suspicious again. */}
                    {row.shortTrip && d.checked_at && (
                      <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                        <span className="min-w-0 break-words">
                          Marked right by {d.checked_by ?? 'someone'} on {dayLabel(d.checked_at.slice(0, 10))}
                        </span>
                        <button
                          type="button"
                          onClick={() => right.mutate({ id: d.id, checked: false })}
                          disabled={busy}
                          className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Undo
                        </button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};

/**
 * A small photo with one short caption under it ("Last photo at Pond"), so
 * it is clear what it shows, also on a phone where nothing hovers. A long
 * site name is cut; the full caption and the time show on hover. A click
 * opens the photo in image verification in a new tab, so the window keeps
 * its place.
 */
const Photo: React.FC<{ projectId: number; photo: DeploymentPhoto | undefined; label: string }> = ({ projectId, photo, label }) => {
  const title = photo ? `${label}, ${formatDateTime(photo.captured_at)}` : label;
  return (
    <figure className="min-w-0 space-y-1">
      {photo ? (
        <a href={`/projects/${projectId}/images?image=${photo.uuid}`} target="_blank" rel="noopener noreferrer" title={title}>
          <AuthenticatedImage
            src={`/api/images/${photo.uuid}/thumbnail`}
            alt={title}
            className="w-full aspect-[4/3] object-cover rounded border hover:opacity-90"
          />
        </a>
      ) : (
        <div className="w-full aspect-[4/3] rounded border bg-muted" />
      )}
      <figcaption className="text-xs text-muted-foreground truncate" title={title}>{label}</figcaption>
    </figure>
  );
};
