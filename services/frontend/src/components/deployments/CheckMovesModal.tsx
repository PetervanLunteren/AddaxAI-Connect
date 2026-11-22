/**
 * Check moves, one at a time, in the same window as image
 * verification: the evidence big on the left, the answer on the right.
 *
 * It opens on a row of the Moves page and steps through the rows
 * as the table shows them, filtered and sorted. The queue is fixed when the
 * window opens, so an answered update does not jump away. Per update:
 * - the map: the two sites of the move and the arrow between them
 * - a facts card (camera, move, date, distance) and an answer card: the
 *   last photo at the old place next to the first at the new one, then one
 *   question, did it really move, with a button per answer and its key on
 *   it. On a real camera the two photos settle most checks: same view, so
 *   it did not move.
 * - "It moved" (Enter) records that a person looked and goes on. "It stayed
 *   at Pond" (W) says the GPS was off: one correction, at once, and it
 *   stays on screen with Undo instead of a confirmation before it.
 *   A move to the wrong site is not answered here: the app making a new
 *   place where a site exists is fixed by merging the two on the Sites
 *   page, a snap to the wrong one of two close sites by Wrong site? in
 *   the camera panel.
 * - A correction from history can be undone, after a confirmation: it moves
 *   photos between sites, and you did not just make it.
 * Marking many moves right is done in the table, with its checkboxes. The
 * arrows step back and forward without answering, Esc closes. The end shows
 * a short summary.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Loader2, Undo2, X } from 'lucide-react';
import { deploymentsApi, type DeploymentPhoto } from '../../api/deployments';
import { formatDateTime } from '../../utils/datetime';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DetailRow } from '../ui/DetailRow';
import { Kbd } from '../ui/Kbd';
import { Dialog } from '../ui/Dialog';
import { REVIEW_WINDOW_CLASS } from '../ui/review-window';
import { useToast } from '../ui/Toaster';
import type { SitePin } from '../sites/SiteMarkersLayer';
import { DeploymentsMap, type MapArrow } from './DeploymentsMap';
import { SuspiciousPill } from './SuspiciousPill';
import {
  dateLabel, dayLabel, metresLabel, placeName, route, siteIds, type UpdateItem,
} from './update-items';

interface Props {
  projectId: number;
  items: UpdateItem[]; // every update, kept fresh by the page
  sites: SitePin[];
  keys: string[]; // the rows of the table as shown, in order
  startKey: string; // the row clicked
  onClose: () => void;
}

// Tall like the photo in image verification, but never taller than the screen.
const MAP_HEIGHT = 'min(65vh, 640px)';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

export const CheckMovesModal: React.FC<Props> = ({ projectId, items, sites, keys: rowKeys, startKey, onClose }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [queue] = useState<string[]>(rowKeys);
  const [current, setCurrent] = useState<string | null>(startKey);
  const [done, setDone] = useState(queue.length === 0);
  // What was answered in this check, by update, for going back and the summary.
  const [answers, setAnswers] = useState<Record<string, 'right' | 'wrong'>>({});
  // A Wrong answer is a correction: its id, for Undo right here. No
  // confirmation before Wrong, Undo after it instead: everything is
  // reversible, and a dialog on every answer slows the check down.
  const [corrections, setCorrections] = useState<Record<string, number>>({});
  const [undone, setUndone] = useState<Set<string>>(new Set());
  // An older correction, waiting for "Undo this?".
  const [confirmUndo, setConfirmUndo] = useState<UpdateItem | null>(null);

  const index = current ? queue.indexOf(current) : -1;
  const it = items.find((i) => i.key === current) ?? null;
  const d = it?.deployment;
  const p = it?.previous;

  // An update can disappear while the check is open: taking back a trip
  // out removes its way back too. The check steps over those.
  const gone = (key: string) => !answers[key] && !items.some((i) => i.key === key);
  const goTo = (target: number) => {
    const step = target < index ? -1 : 1;
    let i = target;
    while (i >= 0 && i < queue.length && gone(queue[i])) i += step;
    if (i >= queue.length) setDone(true);
    else if (i >= 0) setCurrent(queue[i]);
  };
  const next = () => goTo(index + 1);
  const answered = (how: 'right' | 'wrong') => {
    if (current) setAnswers((a) => ({ ...a, [current]: how }));
    next();
  };
  // Wrong stays on the update, so its Undo is in view.
  const corrected = (statementId: number) => {
    if (!current) return;
    setAnswers((a) => ({ ...a, [current]: 'wrong' }));
    setCorrections((c) => ({ ...c, [current]: statementId }));
    setUndone((u) => { const next = new Set(u); next.delete(current); return next; });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };

  // The evidence: the last photo before the move and the first after it,
  // or the first two at a new place.
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

  const right = useMutation({
    mutationFn: (checked: boolean) => deploymentsApi.setChecked(projectId, [d!.id], checked),
    onSuccess: (_, checked) => {
      refresh();
      if (checked) answered('right');
      else setAnswers((a) => { const { [current!]: _gone, ...rest } = a; return rest; });
    },
    onError: (error) => toast.error(`Could not save. ${errMsg(error)}`),
  });
  const notMoved = useMutation({
    mutationFn: () => deploymentsApi.notMoved(projectId, d!.id),
    onSuccess: (result) => {
      refresh();
      corrected(result.statement_id);
    },
    onError: (error) => toast.error(`Could not take the move back. ${errMsg(error)}`),
  });
  const undoCorrection = useMutation({
    mutationFn: (statementId: number) => deploymentsApi.removeFixedPeriod(projectId, statementId),
    // The answer is forgotten: a move that comes back (often with the same
    // row) asks Right or Wrong again. One that does not come back, as a
    // correction from the camera panel, says it is undone.
    onSuccess: () => {
      refresh();
      if (!current) return;
      setUndone((u) => new Set(u).add(current));
      setAnswers(({ [current]: _a, ...rest }) => rest);
      setCorrections(({ [current]: _c, ...rest }) => rest);
    },
    onError: (error) => toast.error(`Could not undo. ${errMsg(error)}`),
  });

  const busy = right.isPending || notMoved.isPending || undoCorrection.isPending;

  // Keys as in image verification: Enter "It moved" and on, W "It
  // stayed", arrows step, Esc closes (the dialog does that). Quiet while the
  // confirmation is open or a field has focus. The listener reads the latest
  // state through a ref, so it is added once.
  const answer = current ? answers[current] : undefined;
  const canStay = !!it && it.kind === 'moved' && !it.returnOfShortTrip;
  const keys = useRef({
    goTo, index, it, answer, busy, canStay,
    moved: () => right.mutate(true), stayed: () => notMoved.mutate(), blocked: false,
  });
  keys.current = {
    goTo, index, it, answer, busy, canStay,
    moved: () => right.mutate(true), stayed: () => notMoved.mutate(),
    blocked: done || confirmUndo !== null,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const el = e.target as HTMLElement;
      if (k.blocked || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); k.goTo(k.index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); k.goTo(k.index - 1); }
      else if (e.key === 'Enter' && !k.it && k.answer) {
        e.preventDefault();
        k.goTo(k.index + 1); // a corrected update: Enter goes on, as Next
      } else if (e.key === 'Enter' && k.it && !k.busy) {
        e.preventDefault();
        if (k.it.answered || k.answer || k.it.kind !== 'moved') k.goTo(k.index + 1);
        else k.moved();
      } else if ((e.key === 'w' || e.key === 'W') && k.canStay && !k.it!.answered && !k.answer && !k.busy) {
        e.preventDefault();
        k.stayed();
      }
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
    return [{ key: it!.key, from, to, label: `${placeName(p!.site_name)} to ${placeName(d!.site_name)}` }];
  }, [it, d, p, sites]);
  // The sites in this update, magenta on the map: both ends of a move, or
  // the one site of a correction.
  const active = useMemo(() => new Set(it ? siteIds(it) : []), [it]);

  const rightCount = Object.values(answers).filter((a) => a === 'right').length;
  const wrongCount = Object.entries(answers).filter(([key, a]) => a === 'wrong' && !undone.has(key)).length;
  const skipped = queue.filter((key) => !answers[key] && !gone(key)).length;

  // Previous, next, position and close, as in the image verification panel.
  const header = (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" onClick={() => goTo(index - 1)} disabled={done || index <= 0} title="Previous (←)">
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" onClick={next} disabled={done} title="Next (→)">
        <ChevronRight className="h-5 w-5" />
      </Button>
      <span className="flex-1 ml-1 text-sm text-muted-foreground tabular-nums">
        {!done && queue.length > 0 && `${index + 1} of ${queue.length}`}
      </span>
      <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)">
        <X className="h-5 w-5" />
      </Button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <div className={`${REVIEW_WINDOW_CLASS} overflow-y-auto overflow-x-hidden`} role="dialog" aria-label="Check moves">
        {done ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="pb-16 text-center space-y-3">
              <Check className="h-10 w-10 mx-auto text-primary" />
              <p className="text-lg font-medium">
                {queue.length === 0 ? 'Nothing here' : 'Done'}
              </p>
              {queue.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {rightCount} right, {wrongCount} wrong, {skipped} skipped
                </p>
              )}
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-2 min-w-0 space-y-2">
                <DeploymentsMap
                  key={current ?? 'none'}
                  sites={sites}
                  activeSiteIds={active.size === 0 ? null : active}
                  arrows={arrows}
                  height={MAP_HEIGHT}
                />
              </div>

              <div className="space-y-4 min-w-0">
                {header}
                {!it ? (
                  <Card>
                    <CardContent className="pt-4 pb-3 space-y-3 text-sm">
                      {current && corrections[current] !== undefined ? (
                        <>
                          <Button className="w-full" onClick={next}>
                            Next
                            <Kbd onPrimary>→</Kbd>
                          </Button>
                          <Button variant="outline" className="w-full" onClick={() => undoCorrection.mutate(corrections[current])} disabled={busy}>
                            <Undo2 className="h-4 w-4 mr-2" />
                            Undo
                          </Button>
                          <p className="text-muted-foreground text-center">Corrected</p>
                        </>
                      ) : current && undone.has(current) ? (
                        <p className="text-muted-foreground text-center">Undone, the GPS decides these days again</p>
                      ) : (
                        <p className="text-muted-foreground text-center">This update no longer exists</p>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* What the app says happened. */}
                    <Card>
                      <CardContent className="pt-4 pb-3 space-y-1 text-sm">
                        <DetailRow label="Camera">{it.cameraLabel}</DetailRow>
                        <DetailRow label={it.kind === 'moved' ? 'Move' : 'Set to'}>{route(it)}</DetailRow>
                        <DetailRow label={it.kind === 'moved' ? 'Date' : 'Days'}>{dateLabel(it)}</DetailRow>
                        <DetailRow label="Distance">{it.distanceM !== undefined ? metresLabel(it.distanceM) : null}</DetailRow>
                        {it.correction && (
                          <DetailRow label="By">
                            {[it.correction.created_by, dayLabel(it.correction.created_at.slice(0, 10))].filter(Boolean).join(', ')}
                          </DetailRow>
                        )}
                        {it.suspicious && (
                          <div className="pt-1 text-right">
                            <SuspiciousPill />
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* The evidence and the answer, as the verification card. */}
                    <Card>
                      <CardContent className="pt-4 pb-3 space-y-3 text-sm">
                        {d && (
                          <div className="grid grid-cols-2 gap-2">
                            {p && <Photo projectId={projectId} photo={before?.[0]} label={`Last at ${placeName(p.site_name)}`} />}
                            {(after ?? []).map((photo, i) => (
                              <Photo key={photo.uuid} projectId={projectId} photo={photo} label={i === 0 ? `First at ${placeName(d.site_name)}` : 'Next photo'} />
                            ))}
                          </div>
                        )}

                        {it.returnOfShortTrip && !it.answered && (
                          <p className="text-xs text-muted-foreground">
                            The way back of a short trip. If the trip never happened, answer It stayed on the trip out.
                          </p>
                        )}

                        <Answers
                          it={it}
                          myAnswer={answer}
                          busy={busy}
                          canStay={canStay}
                          onMoved={() => right.mutate(true)}
                          onUndo={
                            it.correction ? () => setConfirmUndo(it)
                              : current && corrections[current] !== undefined ? () => undoCorrection.mutate(corrections[current])
                                : () => right.mutate(false)
                          }
                          onStayed={() => notMoved.mutate()}
                          onNext={next}
                        />
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            </div>

          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmUndo !== null}
        onClose={() => setConfirmUndo(null)}
        onConfirm={() => {
          if (confirmUndo?.correction) undoCorrection.mutate(confirmUndo.correction.id);
          setConfirmUndo(null);
        }}
        title="Undo this correction?"
        body={confirmUndo?.correction ? (
          <>
            {confirmUndo.cameraLabel} at {confirmUndo.correction.site_name}, {dateLabel(confirmUndo)}. For these
            days the app works out the site again, from the GPS or an earlier correction. Photos
            without GPS in these days have no site until it is set again.
          </>
        ) : ''}
        confirmLabel="Undo"
        variant="destructive"
        isPending={undoCorrection.isPending}
      />
    </Dialog>
  );
};

/**
 * A small photo, no caption: what and when show on hover. A click opens it
 * in image verification in a new tab, so the check keeps its place.
 */
const Photo: React.FC<{ projectId: number; photo: DeploymentPhoto | undefined; label: string }> = ({ projectId, photo, label }) => {
  if (!photo) return <div className="w-full aspect-[4/3] rounded border bg-muted" title={label} />;
  const title = `${label}, ${formatDateTime(photo.captured_at)}`;
  return (
    <a href={`/projects/${projectId}/images?image=${photo.uuid}`} target="_blank" rel="noopener noreferrer" title={title}>
      <AuthenticatedImage
        src={`/api/images/${photo.uuid}/thumbnail`}
        alt={title}
        className="w-full aspect-[4/3] object-cover rounded border hover:opacity-90"
      />
    </a>
  );
};

const Answers: React.FC<{
  it: UpdateItem;
  myAnswer: 'right' | 'wrong' | undefined;
  busy: boolean;
  canStay: boolean; // not on the way back of a short trip
  onMoved: () => void;
  onUndo: () => void;
  onStayed: () => void;
  onNext: () => void;
}> = ({ it, myAnswer, busy, canStay, onMoved, onUndo, onStayed, onNext }) => {
  const d = it.deployment;
  // The muted line under the buttons, as "Not verified yet" under Verify.
  const status = (text: string) => <p className="text-muted-foreground text-center">{text}</p>;

  if (it.answered || myAnswer) {
    return (
      <div className="space-y-3">
        <Button variant="outline" className="w-full" onClick={onNext}>
          Next
          <Kbd>→</Kbd>
        </Button>
        {(it.answered || myAnswer === 'wrong') && (
          <Button variant="outline" className="w-full" onClick={onUndo} disabled={busy}>
            <Undo2 className="h-4 w-4 mr-2" />
            Undo
          </Button>
        )}
        {status(!it.answered || it.kind === 'corrected'
          ? 'Corrected'
          : [`Checked by ${d?.checked_by ?? 'someone'}`, d?.checked_at && dayLabel(d.checked_at.slice(0, 10))]
              .filter(Boolean).join(', '))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={onMoved} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
        It moved
        <Kbd onPrimary>⏎</Kbd>
      </Button>
      {canStay && (
        <Button variant="outline" className="w-full" onClick={onStayed} disabled={busy}>
          <X className="h-4 w-4 mr-2" />
          It stayed at {placeName(it.previous?.site_name)}
          <Kbd>W</Kbd>
        </Button>
      )}
      {status('Not checked')}
    </div>
  );
};
