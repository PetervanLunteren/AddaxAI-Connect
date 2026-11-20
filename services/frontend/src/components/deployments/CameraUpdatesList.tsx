/**
 * The list of the Camera updates page: what the app noticed, newest first,
 * by week. A camera started somewhere, a camera moved, or photos have no
 * site. The visual successor of the camera updates panel.
 *
 * Per entry two answers, and nobody has to give one:
 * - Right: records that a person looked. It changes nothing.
 * - Wrong: asks what happened. Either the camera stands at another site
 *   (the page lets the user click it on the map, then the Set site form
 *   opens), or it did not move (one fixed period at the site before).
 * Two entries ask for information instead: a place the app named itself
 * gets Name this site, photos without a site get Set site.
 *
 * Entries that need a person carry a mark and count for the sidebar badge.
 * The entries come from update-items.ts. This component only shows them
 * and sends the answers.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Pencil, Undo2, X } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { sitesApi } from '../../api/sites';
import { isAutoSiteName } from '../../utils/site-names';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';
import { dayLabel } from './FixedPeriodsList';
import { metresLabel, weekOf, type UpdateItem } from './update-items';

interface Props {
  projectId: number;
  items: UpdateItem[]; // already filtered
  selectedId: number | null; // the selected deployment
  onSelect: (item: UpdateItem | null) => void;
  // The camera stands at another site: the page lets the user pick it.
  onOtherSite: (item: UpdateItem) => void;
}

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

const placeName = (name: string | null | undefined) =>
  !name ? 'no site' : isAutoSiteName(name) ? 'a new place' : name;

function headline(it: UpdateItem): string {
  if (it.kind === 'unplaced') return 'has photos without a site';
  const site = placeName(it.deployment?.site_name);
  if (it.kind === 'started') return `started sending ${site === 'a new place' ? 'from a new place' : `at ${site}`}`;
  return `moved from ${placeName(it.previous?.site_name)} to ${site}`;
}

function context(it: UpdateItem): string {
  if (it.kind === 'unplaced') {
    const days = it.unplaced!.photo_days;
    return `From ${dayLabel(days[0].start)} to ${dayLabel(days[days.length - 1].end)}. This camera sent no GPS on these days.`;
  }
  const d = it.deployment!;
  const unnamed = isAutoSiteName(d.site_name);
  if (it.kind === 'started') {
    return unnamed ? 'No site within 250 m, so the app made one.' : 'A site you already have.';
  }
  const p = it.previous!;
  const parts = [
    it.distanceM !== undefined ? metresLabel(it.distanceM) : null,
    p.last_photo_at ? `last photo at ${placeName(p.site_name)} ${dayLabel(p.last_photo_at.slice(0, 10))}` : null,
    `first at ${placeName(d.site_name)} ${dayLabel(d.start_at.slice(0, 10))}`,
  ];
  return parts.filter(Boolean).join(', ');
}

export const CameraUpdatesList: React.FC<Props> = ({ projectId, items, selectedId, onSelect, onOtherSite }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [naming, setNaming] = useState<UpdateItem | null>(null);
  const [wrong, setWrong] = useState<UpdateItem | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };

  const answer = useMutation({
    mutationFn: ({ ids, right }: { ids: number[]; right: boolean }) =>
      deploymentsApi.setChecked(projectId, ids, right),
    onSuccess: (_, { ids }) => {
      refresh();
      setMarkingAll(false);
      if (ids.length > 1) toast.success(`${ids.length} updates marked as right`);
    },
    onError: (error) => toast.error(`Could not save. ${errMsg(error)}`),
  });

  const rename = useMutation({
    mutationFn: ({ it, name }: { it: UpdateItem; name: string }) =>
      sitesApi.update(projectId, it.deployment!.site_id!, { name }),
    onSuccess: () => {
      refresh();
      setNaming(null);
      toast.success('Site named');
    },
    onError: (error) => toast.error(`Could not name the site. ${errMsg(error)}`),
  });

  const notMoved = useMutation({
    mutationFn: (it: UpdateItem) => deploymentsApi.notMoved(projectId, it.deployment!.id),
    onSuccess: () => {
      refresh();
      setWrong(null);
      onSelect(null);
      toast.success('The move is taken back');
    },
    onError: (error) => toast.error(`Could not take the move back. ${errMsg(error)}`),
  });

  const open = items.filter((it) => it.deployment && !it.answered);
  const needYou = items.filter((it) => it.needsYou).length;
  // Older entries stay out of the way, except the ones that need a person.
  const earlier = items.filter((it) => weekOf(it.day) === 'Earlier' && !it.needsYou);
  const shown = showEarlier ? items : items.filter((it) => !earlier.includes(it));

  const groups: { week: string; items: UpdateItem[] }[] = [];
  for (const it of shown) {
    const week = weekOf(it.day);
    const last = groups[groups.length - 1];
    if (last && last.week === week) last.items.push(it);
    else groups.push({ week, items: [it] });
  }
  const busy = answer.isPending || rename.isPending || notMoved.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {needYou === 0 ? 'Nothing needs you.' : `${needYou} ${needYou === 1 ? 'update needs' : 'updates need'} you.`}
        </span>
        <span className="flex-1" />
        {open.length > 1 && (
          <Button size="sm" variant="outline" onClick={() => setMarkingAll(true)}>
            <Check className="h-4 w-4 mr-1.5" />
            Mark all as right
          </Button>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No camera updates. New cameras, moves and photos without a site show up here.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.week} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.week}</h3>
          {g.items.map((it) => (
            <Entry
              key={it.key}
              it={it}
              projectId={projectId}
              selected={it.deployment !== undefined && it.deployment.id === selectedId}
              busy={busy}
              onSelect={() => onSelect(it.deployment && it.deployment.id === selectedId ? null : it)}
              onAnswer={(right) => answer.mutate({ ids: [it.deployment!.id], right })}
              onWrong={() => setWrong(it)}
              onName={() => setNaming(it)}
              onSetSite={() => onOtherSite(it)}
            />
          ))}
        </div>
      ))}

      {earlier.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowEarlier(!showEarlier)}>
          {showEarlier ? 'Hide earlier updates' : `Show ${earlier.length} earlier ${earlier.length === 1 ? 'update' : 'updates'}`}
        </Button>
      )}

      {naming && (
        <NameSiteDialog
          initialName={naming.deployment!.site_name ?? ''}
          isPending={rename.isPending}
          onClose={() => setNaming(null)}
          onConfirm={(name) => rename.mutate({ it: naming, name })}
        />
      )}

      {wrong && (
        <WrongDialog
          it={wrong}
          isPending={notMoved.isPending}
          onClose={() => setWrong(null)}
          onOtherSite={() => {
            setWrong(null);
            onOtherSite(wrong);
          }}
          onNotMoved={() => notMoved.mutate(wrong)}
        />
      )}

      <ConfirmDialog
        open={markingAll}
        onClose={() => setMarkingAll(false)}
        onConfirm={() => answer.mutate({ ids: open.map((it) => it.deployment!.id), right: true })}
        title={`Mark ${open.length} updates as right?`}
        body="Every new camera and move in view counts as right. Photos without a site stay until they have one."
        confirmLabel="Mark all as right"
        isPending={answer.isPending}
      />
    </div>
  );
};

const Entry: React.FC<{
  it: UpdateItem;
  projectId: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAnswer: (right: boolean) => void;
  onWrong: () => void;
  onName: () => void;
  onSetSite: () => void;
}> = ({ it, projectId, selected, busy, onSelect, onAnswer, onWrong, onName, onSetSite }) => {
  const d = it.deployment;
  const { data: thumbs } = useQuery({
    queryKey: ['deployment-thumbnails', projectId, d?.id],
    queryFn: () => deploymentsApi.thumbnails(projectId, d!.id, 3),
    enabled: selected && d !== undefined,
  });
  const unnamed = d !== undefined && isAutoSiteName(d.site_name);
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      className={`rounded-md border p-3 text-sm cursor-pointer transition-colors ${
        selected ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/50'
      } ${it.answered ? 'opacity-60' : ''} ${it.needsYou ? 'border-l-4 border-l-[#ff8945]' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold tabular-nums">{it.cameraLabel}</span>
        <span>{headline(it)}</span>
        {it.shortTrip && (
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-[#ff8945]/20">Back within a week</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{context(it)}</p>
      {it.answered && d?.checked_at && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Right, said {d.checked_by ?? 'someone'} on {dayLabel(d.checked_at.slice(0, 10))}
        </p>
      )}

      {selected && thumbs && thumbs.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {thumbs.map((u) => (
            <AuthenticatedImage
              key={u}
              src={`/api/images/${u}/thumbnail`}
              alt="Photo from this camera at this place"
              className="w-full h-16 object-cover rounded border"
            />
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {it.kind === 'unplaced' ? (
          <Button size="sm" onClick={stop(onSetSite)} disabled={busy}>
            <MapPin className="h-3.5 w-3.5 mr-1.5" />
            Set site
          </Button>
        ) : it.answered ? (
          <Button size="sm" variant="ghost" onClick={stop(() => onAnswer(false))} disabled={busy}>
            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
            Undo
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={stop(() => onAnswer(true))} disabled={busy}>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Right
            </Button>
            <Button size="sm" variant="outline" onClick={stop(onWrong)} disabled={busy}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              Wrong
            </Button>
            {unnamed && (
              <Button size="sm" onClick={stop(onName)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Name this site
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/** Wrong: what happened instead. The camera stands at another site, or, for
 * a move, it never moved. */
const WrongDialog: React.FC<{
  it: UpdateItem;
  isPending: boolean;
  onClose: () => void;
  onOtherSite: () => void;
  onNotMoved: () => void;
}> = ({ it, isPending, onClose, onOtherSite, onNotMoved }) => {
  const d = it.deployment!;
  // The way back of a short trip is not offered "it did not move": that
  // would leave the camera at the place of the trip. The trip out has it.
  const canNotMove = it.kind === 'moved' && !it.returnOfShortTrip;
  const choice = 'w-full text-left rounded-md border p-3 hover:bg-accent/50 disabled:opacity-50';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>What happened?</DialogTitle>
          <DialogDescription>
            Camera {it.cameraLabel} {headline(it)} on {dayLabel(d.start_at.slice(0, 10))}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <button type="button" className={choice} onClick={onOtherSite} disabled={isPending}>
            <div className="font-medium text-sm">It stands at another site</div>
            <div className="text-xs text-muted-foreground">Click the right site on the map, then check the days.</div>
          </button>
          {canNotMove && (
            <button type="button" className={choice} onClick={onNotMoved} disabled={isPending}>
              <div className="font-medium text-sm">It did not move</div>
              <div className="text-xs text-muted-foreground">
                It stood at {placeName(it.previous?.site_name)} the whole time, from{' '}
                {dayLabel(it.previous!.start_at.slice(0, 10))} to {d.end_date ? dayLabel(d.end_date) : 'now'}.
                You can undo this in the camera panel.
              </div>
            </button>
          )}
          {it.returnOfShortTrip && (
            <p className="text-xs text-muted-foreground">
              This is the way back of a short trip. If the trip itself never happened, choose Wrong on the trip out.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** A name for a site the app named by its coordinates. The suggestion starts
 * selected, so typing replaces it. */
const NameSiteDialog: React.FC<{
  initialName: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}> = ({ initialName, isPending, onClose, onConfirm }) => {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!isPending && name.trim()) onConfirm(name.trim());
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Name this site</DialogTitle>
            <DialogDescription>Give the site a real name.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-xs text-muted-foreground" htmlFor="name-site-input">Site name</label>
            <input
              id="name-site-input"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
              autoFocus
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
