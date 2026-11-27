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
 *   - Right (Enter, PUT .../deployments/{id}/checked) clears the warning and
 *     records who said so. The window then shows that, with Undo.
 *   - Wrong (W, POST .../deployments/{id}/not-moved): the GPS was off, the
 *     camera stayed. One correction at the old site, at once, with Undo on
 *     the spot instead of a confirmation before it. After Undo the
 *     deployment comes back under the same key and asks again.
 * Every other deployment asks nothing; a person fixes it with Edit.
 *
 * The answers and their mutations are in useDeploymentAnswers; the photos
 * and the question are the Evidence card below.
 *
 * The arrows step without answering, Esc closes, and past the last row the
 * window closes, as image verification does.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Loader2, Undo2, X } from 'lucide-react';
import { deploymentKeys, deploymentsApi, type DeploymentListItem, type DeploymentPhoto } from '../../api/deployments';
import { imageHref } from '../../lib/panel-links';
import { formatDateTime } from '../../utils/datetime';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import { REVIEW_WINDOW_CLASS } from '../ui/review-window';
import { openOverlayCount } from '../ui/useOverlayLayer';
import type { SitePin } from '../sites/SiteMarkersLayer';
import { DeploymentCards, type DeploymentCardData } from './DeploymentCards';
import { DeploymentStatus } from './DeploymentStatus';
import { DeploymentsMap, type MapArrow } from './DeploymentsMap';
import { cameraLabel, dayLabel, daysOverlap, metresLabel, placeName } from './format';
import { SUSPICIOUS_REASON, type DeploymentRow } from './rows';
import { useDeploymentAnswers } from './useDeploymentAnswers';

interface Props {
  projectId: number;
  rows: DeploymentRow[]; // every deployment, kept fresh by the page
  sites: SitePin[];
  keys: string[]; // the rows of the table as shown, in order
  startKey: string; // the row clicked
  onClose: () => void;
}

const toCard = (d: DeploymentListItem): DeploymentCardData => ({
  id: d.id,
  cameraId: d.camera_id,
  cameraName: cameraLabel(d.camera_label, d.camera_id),
  siteId: d.site_id,
  siteName: d.site_name,
  startDate: d.start_date,
  endDate: d.end_date,
  imageCount: d.image_count,
  lat: d.latitude,
  lon: d.longitude,
});

export const DeploymentWindow: React.FC<Props> = ({ projectId, rows, sites, keys: rowKeys, startKey, onClose }) => {
  // Fixed when the window opens: the rows to step through, and every
  // deployment as it was then, to say what a deployment that changed is now.
  const [queue] = useState<string[]>(rowKeys);
  const [atOpen] = useState(() => new Map(rows.map((r) => [r.key, r.deployment])));
  const [current, setCurrent] = useState<string>(startKey);
  const [shown, setShown] = useState(() => new Set([startKey]));
  const answers = useDeploymentAnswers(projectId);

  const index = queue.indexOf(current);
  const row = rows.find((r) => r.key === current) ?? null;
  const wrong = answers.wrongs[current];
  const d = row?.deployment;
  const p = row?.previous;

  // An Edit or an Undo can change where a deployment starts, and with that
  // its key. The window then shows what those days are now, as cards with
  // Edit, so a split is seen and its new part can be edited next.
  const was = atOpen.get(current);
  const changed = !row && was
    ? rows.map((r) => r.deployment)
      .filter((x) => x.camera_id === was.camera_id &&
        daysOverlap(x.start_date, x.end_date, was.start_date, was.end_date))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
    : [];

  // A deployment can disappear while the window is open (an Edit or an
  // Undo on its card, a Wrong on its neighbour). Stepping skips those the
  // window has not shown yet; one it did show stays, with what it is now.
  const gone = (key: string) => !answers.wrongs[key] && !shown.has(key) && !rows.some((r) => r.key === key);
  const goTo = (target: number) => {
    const step = target < index ? -1 : 1;
    let i = target;
    while (i >= 0 && i < queue.length && gone(queue[i])) i += step;
    if (i >= queue.length) onClose();
    else if (i >= 0) {
      setCurrent(queue[i]);
      setShown((s) => new Set(s).add(queue[i]));
    }
  };
  const next = () => goTo(index + 1);

  const answerRight = () => d && answers.right.mutate({ id: d.id, checked: true });
  const answerWrong = () => d && answers.wrong.mutate({ id: d.id, key: current, oldSite: placeName(p?.site_name) });
  const asks = !!row?.suspicious && !wrong;
  const { busy } = answers;

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
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => answers.undoWrong.mutate({ correctionId: wrong.correctionId, key: current })}
                    disabled={busy}
                  >
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
            ) : !row ? (
              <Card>
                <CardContent className="pt-4 pb-3 text-sm text-center text-muted-foreground">
                  This deployment no longer exists
                </CardContent>
              </Card>
            ) : (
              <>
                <DeploymentCards
                  projectId={projectId}
                  deployments={[toCard(row.deployment)]}
                  canEdit={!asks}
                  emptyText=""
                  hideSuspicious
                />
                <Evidence
                  projectId={projectId}
                  row={row}
                  asks={asks}
                  busy={busy}
                  savingRight={answers.right.isPending}
                  onRight={answerRight}
                  onWrong={answerWrong}
                  onUndoRight={() => answers.right.mutate({ id: row.deployment.id, checked: false })}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};

interface EvidenceProps {
  projectId: number;
  row: DeploymentRow;
  asks: boolean; // suspicious and not answered yet
  busy: boolean;
  savingRight: boolean;
  onRight: () => void;
  onWrong: () => void;
  onUndoRight: () => void;
}

/**
 * What tells whether a deployment is right: where it moved from, and the
 * last photo there next to the first one here (or its first two photos,
 * when it did not move). Under it the question of a suspicious deployment,
 * or who marked it right.
 */
const Evidence: React.FC<EvidenceProps> = ({
  projectId, row, asks, busy, savingRight, onRight, onWrong, onUndoRight,
}) => {
  const d = row.deployment;
  const p = row.previous;
  const firstCount = p ? 1 : 2;
  const { data: before } = useQuery({
    queryKey: deploymentKeys.photos(projectId, p?.id, 'last', 1),
    queryFn: () => deploymentsApi.photos(projectId, p!.id, 'last', 1),
    enabled: !!p,
  });
  const { data: after } = useQuery({
    queryKey: deploymentKeys.photos(projectId, d.id, 'first', firstCount),
    queryFn: () => deploymentsApi.photos(projectId, d.id, 'first', firstCount),
  });

  return (
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
            <Button className="w-full" onClick={onRight} disabled={busy}>
              {savingRight ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Right, it went there
              <Kbd onPrimary>⏎</Kbd>
            </Button>
            <Button variant="outline" className="w-full" onClick={onWrong} disabled={busy}>
              <X className="h-4 w-4 mr-2" />
              Wrong, it stayed at {placeName(p?.site_name)}
              <Kbd>W</Kbd>
            </Button>
          </div>
        )}

        {/* A short trip somebody marked right: who and when, with Undo,
            which makes it suspicious again. */}
        {row.shortTrip && d.checked_at && (
          <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
            <span className="min-w-0 break-words">
              Marked right by {d.checked_by ?? 'someone'} on {dayLabel(d.checked_at.slice(0, 10))}
            </span>
            <button
              type="button"
              onClick={onUndoRight}
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
        <a href={imageHref(projectId, photo.uuid)} target="_blank" rel="noopener noreferrer" title={title}>
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
