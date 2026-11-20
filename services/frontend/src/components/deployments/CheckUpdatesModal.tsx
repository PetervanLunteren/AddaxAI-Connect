/**
 * Check camera updates, one at a time, the way images are verified.
 *
 * The queue is fixed when the check opens (checkQueue in update-items.ts),
 * so an answered update does not jump away under the user. Per update:
 * - the map of this camera: the arrow of the move, both places, the GPS of
 *   its photos and the ring of the move rule
 * - one sentence, the last photo at the old place next to the first at the
 *   new one, and one line of reason
 * - Right (Enter) records that a person looked and goes on. Wrong (W) asks
 *   what happened: it did not move, or it stands at another site, which
 *   puts the map in pick mode; the Set site form does the rest. A place the
 *   app named itself also gets Name this site. Photos without a site only
 *   get Set site.
 * The arrows step back and forward without answering, Esc closes. The last
 * answer shows a short summary.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Loader2, MapPin, Pencil, Undo2, X } from 'lucide-react';
import { deploymentsApi, type DeploymentPhoto, type DeploymentStart } from '../../api/deployments';
import { sitesApi } from '../../api/sites';
import { formatDateTime } from '../../utils/datetime';
import { isAutoSiteName } from '../../utils/site-names';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';
import type { SitePin } from '../sites/SiteMarkersLayer';
import { DeploymentsMap, type MapArrow } from './DeploymentsMap';
import { SetDeploymentDialog, type SetDeploymentPrefill } from './SetDeploymentDialog';
import {
  checkQueue, context, dayLabel, headline, metresLabel, placeName, type UpdateItem,
} from './update-items';

interface Props {
  projectId: number;
  items: UpdateItem[]; // every update in view, kept fresh by the page
  sites: SitePin[];
  startKey: string | null; // open at this update, else at the first in the queue
  onClose: () => void;
}

const MAP_HEIGHT = 460;

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

/** Why the app decided so, in one line. */
function reason(start: DeploymentStart | undefined, thresholdM: number | undefined): string | null {
  if (!start || thresholdM === undefined) return null;
  if (start.kind === 'moved' && start.distance_m !== null && start.readings !== null && start.first_at) {
    return (
      `${start.readings} photos in a row were ${metresLabel(start.distance_m)} from where the camera stood before ` +
      `(more than ${metresLabel(thresholdM)} counts as a move). The first was taken ${formatDateTime(start.first_at)}.`
    );
  }
  if (start.kind === 'fixed') return 'A person set this site.';
  return 'The first photos of this camera here.';
}

export const CheckUpdatesModal: React.FC<Props> = ({ projectId, items, sites, startKey, onClose }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [queue] = useState<string[]>(() => {
    const keys = checkQueue(items).map((it) => it.key);
    return startKey && !keys.includes(startKey) ? [startKey, ...keys] : keys;
  });
  const [current, setCurrent] = useState<string | null>(startKey ?? queue[0] ?? null);
  const [done, setDone] = useState(queue.length === 0);
  // What was answered in this check, by update, for going back and the summary.
  const [answers, setAnswers] = useState<Record<string, 'right' | 'wrong'>>({});
  const [wrongOpen, setWrongOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ prefill: SetDeploymentPrefill; newSite: boolean } | null>(null);
  const [naming, setNaming] = useState(false);

  const index = current ? queue.indexOf(current) : -1;
  const it = items.find((i) => i.key === current) ?? null;
  const d = it?.deployment;
  const p = it?.previous;

  const goTo = (i: number) => {
    setWrongOpen(false);
    setPicking(false);
    setNaming(false);
    if (i >= queue.length) setDone(true);
    else if (i >= 0) setCurrent(queue[i]);
  };
  const next = () => goTo(index + 1);
  const answered = (how: 'right' | 'wrong') => {
    if (current) setAnswers((a) => ({ ...a, [current]: how }));
    next();
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };

  const { data: readings } = useQuery({
    queryKey: ['deployments', projectId, 'readings', it?.cameraId],
    queryFn: () => deploymentsApi.readings(projectId, it!.cameraId),
    enabled: !!d,
  });
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
    onSuccess: () => {
      refresh();
      toast.success('The move is taken back');
      answered('wrong');
    },
    onError: (error) => toast.error(`Could not take the move back. ${errMsg(error)}`),
  });
  const rename = useMutation({
    mutationFn: async (name: string) => {
      await sitesApi.update(projectId, d!.site_id!, { name });
      // Naming the place is looking at it.
      await deploymentsApi.setChecked(projectId, [d!.id], true);
    },
    onSuccess: () => {
      refresh();
      toast.success('Site named');
      answered('right');
    },
    onError: (error) => toast.error(`Could not name the site. ${errMsg(error)}`),
  });
  const busy = right.isPending || notMoved.isPending || rename.isPending;

  const startPicking = () => {
    setWrongOpen(false);
    setPicking(true);
  };
  const picked = (siteId: number | null, lat: number | null, lon: number | null) => {
    setPicking(false);
    const prefill: SetDeploymentPrefill = d
      ? { siteId, fromDate: d.start_date ?? d.start_at.slice(0, 10), untilDate: d.end_date,
          lat: lat ?? d.latitude, lon: lon ?? d.longitude }
      : { siteId, fromDate: it!.unplaced!.photo_days[0].start, untilDate: null, lat, lon };
    setEditing({ prefill, newSite: siteId === null });
  };

  // Keys as in image verification: Enter right and on, arrows step, Esc
  // closes (the dialog does that). W opens Wrong. Quiet while a form on top
  // is open, the map waits for a pick, or a field has focus. The listener
  // reads the latest state through a ref, so it is added once.
  const answer = current ? answers[current] : undefined;
  const keys = useRef({ goTo, index, it, answer, busy, rightNow: () => right.mutate(true), blocked: false });
  keys.current = {
    goTo, index, it, answer, busy, rightNow: () => right.mutate(true),
    blocked: done || !!editing || naming || picking,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const el = e.target as HTMLElement;
      if (k.blocked || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); k.goTo(k.index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); k.goTo(k.index - 1); }
      else if (e.key === 'Enter' && k.it && !k.busy) {
        e.preventDefault();
        if (k.it.answered || k.answer) k.goTo(k.index + 1);
        else if (k.it.deployment) k.rightNow();
      } else if ((e.key === 'w' || e.key === 'W') && k.it?.deployment && !k.it.answered && !k.answer) {
        e.preventDefault();
        setWrongOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const arrows: MapArrow[] = useMemo(() => {
    if (!d || !p || d.latitude === null || d.longitude === null || p.latitude === null || p.longitude === null) return [];
    return [{
      key: it!.key, from: [p.latitude, p.longitude], to: [d.latitude, d.longitude],
      warn: !!it!.shortTrip, strong: true, label: `${placeName(p.site_name)} to ${placeName(d.site_name)}`,
    }];
  }, [it, d, p]);
  const active = useMemo(
    () => new Set([d?.site_id, p?.site_id].filter((id): id is number => id != null)),
    [d, p],
  );

  const rightCount = Object.values(answers).filter((a) => a === 'right').length;
  const wrongCount = Object.values(answers).filter((a) => a === 'wrong').length;
  const myAnswer = answer;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <div
        className="fixed left-1/2 top-[calc(50%_+_env(safe-area-inset-top)/2)] -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-1rem)] sm:w-full sm:max-w-6xl max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] sm:max-h-[90vh] overflow-y-auto bg-background rounded-lg border shadow-lg p-3 sm:p-6"
        role="dialog"
        aria-label="Check camera updates"
      >
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold flex-1">Check camera updates</h2>
          {!done && queue.length > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">{index + 1} of {queue.length}</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => goTo(index - 1)} disabled={done || index <= 0} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={next} disabled={done} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {done ? (
          <div className="py-16 text-center space-y-3">
            <Check className="h-10 w-10 mx-auto text-primary" />
            <p className="text-lg font-medium">
              {queue.length === 0 ? 'Nothing to check.' : 'All checked.'}
            </p>
            {queue.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {rightCount} right, {wrongCount} wrong, {queue.length - rightCount - wrongCount} skipped.
              </p>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-6">
            <div className="md:col-span-2 space-y-2">
              {picking && (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-accent/50 px-3 py-2 text-sm">
                  <span>Click the site where camera {it?.cameraLabel} stood, or an empty spot to make a new site there.</span>
                  <Button size="sm" variant="outline" onClick={() => setPicking(false)}>Cancel</Button>
                </div>
              )}
              <DeploymentsMap
                key={current ?? 'none'}
                sites={sites}
                activeSiteIds={picking || !d ? null : active}
                arrows={picking ? [] : arrows}
                selected={picking ? null : d ?? null}
                readings={readings}
                onSiteClick={(siteId) => picking && picked(siteId, null, null)}
                onSpotClick={picking ? (lat, lon) => picked(null, lat, lon) : undefined}
                height={MAP_HEIGHT}
              />
            </div>

            <div className="space-y-4 text-sm min-w-0">
              {!it ? (
                <p className="text-muted-foreground">
                  {myAnswer === 'wrong'
                    ? 'Corrected. This update is gone, the camera follows what you said.'
                    : 'This update no longer exists.'}
                </p>
              ) : (
                <>
                  <div>
                    <p className="text-base">
                      <span className="font-semibold">{it.cameraLabel}</span> {headline(it)}
                      {d && <> on {dayLabel(d.start_at.slice(0, 10))}</>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{context(it)}</p>
                    {it.shortTrip && (
                      <p className="mt-2 inline-block px-2 py-0.5 rounded-full text-xs bg-[#ff8945]/20">
                        Back within a week, often a sign of a false move
                      </p>
                    )}
                  </div>

                  {d && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ...(p ? [{ photo: before?.[0], label: `Last at ${placeName(p.site_name)}` }] : []),
                        ...(after ?? []).map((photo, i) => ({
                          photo, label: i === 0 ? `First at ${placeName(d.site_name)}` : 'Next photo',
                        })),
                      ].map(({ photo, label }) => (
                        <Photo key={label} photo={photo} label={label} />
                      ))}
                    </div>
                  )}

                  {d && <p className="text-xs text-muted-foreground">{reason(readings?.starts.find((s) => s.deployment_id === d.id), readings?.threshold_m) ?? ''}</p>}

                  {it.returnOfShortTrip && !it.answered && (
                    <p className="text-xs text-muted-foreground">
                      This is the way back of a short trip. If the trip never happened, answer Wrong on the trip out.
                    </p>
                  )}

                  <Answers
                    it={it}
                    myAnswer={myAnswer}
                    busy={busy}
                    wrongOpen={wrongOpen}
                    onRight={() => right.mutate(true)}
                    onUndo={() => right.mutate(false)}
                    onWrong={() => setWrongOpen(true)}
                    onNotMoved={() => notMoved.mutate()}
                    onOtherSite={startPicking}
                    onName={() => setNaming(true)}
                    onNext={next}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {naming && d && (
          <NameSite
            initialName={d.site_name ?? ''}
            isPending={rename.isPending}
            onCancel={() => setNaming(false)}
            onSave={(name) => rename.mutate(name)}
          />
        )}
      </div>

      {editing && it && (
        <SetDeploymentDialog
          projectId={projectId}
          cameraId={it.cameraId}
          cameraName={it.cameraLabel}
          prefill={editing.prefill}
          newSite={editing.newSite}
          onSaved={() => answered('wrong')}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  );
};

const Photo: React.FC<{ photo: DeploymentPhoto | undefined; label: string }> = ({ photo, label }) => (
  <figure className="space-y-1">
    {photo ? (
      <AuthenticatedImage
        src={`/api/images/${photo.uuid}/thumbnail`}
        alt={label}
        className="w-full aspect-[4/3] object-cover rounded border"
      />
    ) : (
      <div className="w-full aspect-[4/3] rounded border bg-muted" />
    )}
    <figcaption className="text-xs text-muted-foreground">
      {label}
      {photo && <>, {formatDateTime(photo.captured_at)}</>}
    </figcaption>
  </figure>
);

const Answers: React.FC<{
  it: UpdateItem;
  myAnswer: 'right' | 'wrong' | undefined;
  busy: boolean;
  wrongOpen: boolean;
  onRight: () => void;
  onUndo: () => void;
  onWrong: () => void;
  onNotMoved: () => void;
  onOtherSite: () => void;
  onName: () => void;
  onNext: () => void;
}> = ({ it, myAnswer, busy, wrongOpen, onRight, onUndo, onWrong, onNotMoved, onOtherSite, onName, onNext }) => {
  const d = it.deployment;
  if (it.kind === 'unplaced') {
    return (
      <Button onClick={onOtherSite} disabled={busy}>
        <MapPin className="h-4 w-4 mr-2" />
        Set site
      </Button>
    );
  }
  if (it.answered || myAnswer) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">
          {it.answered
            ? `Right, said ${d?.checked_by ?? 'someone'}${d?.checked_at ? ` on ${dayLabel(d.checked_at.slice(0, 10))}` : ''}.`
            : 'Corrected.'}
        </p>
        <div className="flex gap-2">
          {it.answered && (
            <Button size="sm" variant="ghost" onClick={onUndo} disabled={busy}>
              <Undo2 className="h-4 w-4 mr-1.5" />
              Undo
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onNext}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }
  const canNotMove = it.kind === 'moved' && !it.returnOfShortTrip;
  const choice = 'w-full text-left rounded-md border p-3 hover:bg-accent/50 disabled:opacity-50';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onRight} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          Right
          <kbd className="ml-2 text-[10px] opacity-70">Enter</kbd>
        </Button>
        <Button variant="outline" onClick={onWrong} disabled={busy}>
          <X className="h-4 w-4 mr-2" />
          Wrong
          <kbd className="ml-2 text-[10px] opacity-70">W</kbd>
        </Button>
        {isAutoSiteName(d?.site_name) && (
          <Button variant="outline" onClick={onName} disabled={busy}>
            <Pencil className="h-4 w-4 mr-2" />
            Name this site
          </Button>
        )}
      </div>
      {wrongOpen && (
        <div className="space-y-2">
          <p className="font-medium">What happened?</p>
          {canNotMove && (
            <button type="button" className={choice} onClick={onNotMoved} disabled={busy}>
              <div className="font-medium">It did not move</div>
              <div className="text-xs text-muted-foreground">
                It stood at {placeName(it.previous?.site_name)} the whole time, from{' '}
                {dayLabel(it.previous!.start_at.slice(0, 10))} to {d!.end_date ? dayLabel(d!.end_date) : 'now'}.
              </div>
            </button>
          )}
          <button type="button" className={choice} onClick={onOtherSite} disabled={busy}>
            <div className="font-medium">It stands at another site</div>
            <div className="text-xs text-muted-foreground">Click the right site on the map, then check the days.</div>
          </button>
        </div>
      )}
    </div>
  );
};

const NameSite: React.FC<{
  initialName: string;
  isPending: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}> = ({ initialName, isPending, onCancel, onSave }) => {
  const [name, setName] = useState(initialName);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending && name.trim()) onSave(name.trim());
      }}
    >
      <label className="flex-1 min-w-[12rem] text-xs text-muted-foreground" htmlFor="check-site-name">
        Name for this site
        <input
          id="check-site-name"
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          className="mt-1 w-full px-3 py-2 border rounded-md text-sm text-foreground"
        />
      </label>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
      <Button type="submit" disabled={isPending || !name.trim()}>
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save name
      </Button>
    </form>
  );
};
