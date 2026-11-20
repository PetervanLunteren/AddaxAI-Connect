/**
 * The "To check" list of the Deployments page: what the app noticed and
 * nobody looked at yet. New cameras, moves and photos without a site,
 * newest first, grouped by day. Replaces the camera updates panel.
 *
 * The answers per entry:
 * - Correct: records that a person looked. It fixes nothing, the GPS can
 *   still change the deployment later.
 * - Name this site: for a site the app made and named by its coordinates.
 * - Change site (Set site for photos without a site): the page puts the map
 *   in pick mode, the existing Set deployment form does the rest.
 * - It did not move: the camera stood at the site before the move all
 *   along. Written as a fixed period over both deployments.
 *
 * The entries come from review-items.ts. This component only shows them
 * and sends the answers.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Pencil, Undo2 } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { sitesApi } from '../../api/sites';
import { isAutoSiteName } from '../../utils/site-names';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';
import { dayLabel } from './FixedPeriodsList';
import { metresLabel, type ReviewItem } from './review-items';

interface Props {
  projectId: number;
  items: ReviewItem[]; // already filtered
  showAll: boolean;
  onShowAll: (all: boolean) => void;
  selectedId: number | null; // the selected deployment
  onSelect: (item: ReviewItem | null) => void;
  onChangeSite: (item: ReviewItem) => void;
}

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

const placeName = (name: string | null | undefined) =>
  !name ? 'no site' : isAutoSiteName(name) ? 'a new place' : name;

function headline(it: ReviewItem): string {
  if (it.kind === 'unplaced') return 'has photos without a site';
  const site = placeName(it.deployment?.site_name);
  if (it.kind === 'started') return `started sending ${site === 'a new place' ? 'from a new place' : `at ${site}`}`;
  return `moved from ${placeName(it.previous?.site_name)} to ${site}`;
}

function context(it: ReviewItem): string {
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

export const DeploymentsReview: React.FC<Props> = ({
  projectId, items, showAll, onShowAll, selectedId, onSelect, onChangeSite,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [naming, setNaming] = useState<ReviewItem | null>(null);
  const [notMoving, setNotMoving] = useState<ReviewItem | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };

  const check = useMutation({
    mutationFn: ({ ids, checked }: { ids: number[]; checked: boolean }) =>
      deploymentsApi.setChecked(projectId, ids, checked),
    onSuccess: (_, { ids, checked }) => {
      refresh();
      setCheckingAll(false);
      if (ids.length > 1) toast.success(`${ids.length} entries checked`);
      else if (!checked) toast.success('Back on the list');
    },
    onError: (error) => toast.error(`Could not save. ${errMsg(error)}`),
  });

  const rename = useMutation({
    mutationFn: async ({ it, name }: { it: ReviewItem; name: string }) => {
      await sitesApi.update(projectId, it.deployment!.site_id!, { name });
      // Naming the site is looking at it, so the entry is checked too.
      await deploymentsApi.setChecked(projectId, [it.deployment!.id], true);
    },
    onSuccess: () => {
      refresh();
      setNaming(null);
      toast.success('Site named');
    },
    onError: (error) => toast.error(`Could not name the site. ${errMsg(error)}`),
  });

  const notMoved = useMutation({
    mutationFn: (it: ReviewItem) => deploymentsApi.notMoved(projectId, it.deployment!.id),
    onSuccess: () => {
      refresh();
      setNotMoving(null);
      onSelect(null);
      toast.success('The move is taken back');
    },
    onError: (error) => toast.error(`Could not take the move back. ${errMsg(error)}`),
  });

  const open = items.filter((it) => !it.checked);
  const checkable = open.filter((it) => it.deployment);
  const shown = showAll ? items : open;

  const groups: { day: string; items: ReviewItem[] }[] = [];
  for (const it of shown) {
    const last = groups[groups.length - 1];
    if (last && last.day === it.day) last.items.push(it);
    else groups.push({ day: it.day, items: [it] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5 text-sm">
          {[false, true].map((all) => (
            <button
              key={String(all)}
              type="button"
              onClick={() => onShowAll(all)}
              className={`px-3 py-1 rounded ${showAll === all ? 'bg-accent font-medium' : 'text-muted-foreground'}`}
            >
              {all ? 'All' : `To check (${open.length})`}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {checkable.length > 1 && (
          <Button size="sm" variant="outline" onClick={() => setCheckingAll(true)}>
            <Check className="h-4 w-4 mr-1.5" />
            Mark all as checked
          </Button>
        )}
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {showAll
            ? 'Nothing the app noticed matches the filters.'
            : 'Nothing to check. New cameras, moves and photos without a site show up here.'}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.day} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.day ? dayLabel(g.day) : ''}
          </h3>
          {g.items.map((it) => (
            <Entry
              key={it.key}
              it={it}
              projectId={projectId}
              selected={it.deployment !== undefined && it.deployment.id === selectedId}
              busy={check.isPending || rename.isPending || notMoved.isPending}
              onSelect={() => onSelect(it.deployment && it.deployment.id === selectedId ? null : it)}
              onCheck={(checked) => check.mutate({ ids: [it.deployment!.id], checked })}
              onName={() => setNaming(it)}
              onChangeSite={() => onChangeSite(it)}
              onNotMoved={() => setNotMoving(it)}
            />
          ))}
        </div>
      ))}

      {naming && (
        <NameSiteDialog
          initialName={naming.deployment!.site_name ?? ''}
          isPending={rename.isPending}
          onClose={() => setNaming(null)}
          onConfirm={(name) => rename.mutate({ it: naming, name })}
        />
      )}

      <ConfirmDialog
        open={notMoving !== null}
        onClose={() => setNotMoving(null)}
        onConfirm={() => notMoving && notMoved.mutate(notMoving)}
        title="Did the camera stay where it was?"
        body={notMoving ? (
          <>
            Camera {notMoving.cameraLabel} then stood at {placeName(notMoving.previous?.site_name)} the
            whole time, from {dayLabel(notMoving.previous!.start_at.slice(0, 10))} to{' '}
            {notMoving.deployment!.end_date ? dayLabel(notMoving.deployment!.end_date) : 'now'}. The two
            deployments become one. You can take this back under Fixed periods.
          </>
        ) : ''}
        confirmLabel="Yes, it did not move"
        isPending={notMoved.isPending}
        focusCancel
      />

      <ConfirmDialog
        open={checkingAll}
        onClose={() => setCheckingAll(false)}
        onConfirm={() => check.mutate({ ids: checkable.map((it) => it.deployment!.id), checked: true })}
        title={`Mark ${checkable.length} entries as checked?`}
        body="Every new camera and move in view counts as checked. Photos without a site stay on the list until they have one."
        confirmLabel="Mark all as checked"
        isPending={check.isPending}
      />
    </div>
  );
};

const Entry: React.FC<{
  it: ReviewItem;
  projectId: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onCheck: (checked: boolean) => void;
  onName: () => void;
  onChangeSite: () => void;
  onNotMoved: () => void;
}> = ({ it, projectId, selected, busy, onSelect, onCheck, onName, onChangeSite, onNotMoved }) => {
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
      } ${it.checked ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold tabular-nums">{it.cameraLabel}</span>
        <span>{headline(it)}</span>
        {it.shortTrip && (
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-[#ff8945]/20">Back within a week</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{context(it)}</p>
      {it.returnOfShortTrip && !it.checked && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Back where it was. If the trip itself was wrong, answer It did not move on the trip out.
        </p>
      )}
      {it.checked && d?.checked_at && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Checked {dayLabel(d.checked_at.slice(0, 10))}{d.checked_by ? ` by ${d.checked_by}` : ''}
        </p>
      )}

      {selected && thumbs && thumbs.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {thumbs.map((u) => (
            <AuthenticatedImage
              key={u}
              src={`/api/images/${u}/thumbnail`}
              alt="Photo from this deployment"
              className="w-full h-16 object-cover rounded border"
            />
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {it.kind === 'unplaced' ? (
          <Button size="sm" variant="outline" onClick={stop(onChangeSite)} disabled={busy}>
            <MapPin className="h-3.5 w-3.5 mr-1.5" />
            Set site
          </Button>
        ) : it.checked ? (
          <Button size="sm" variant="ghost" onClick={stop(() => onCheck(false))} disabled={busy}>
            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
            Undo
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={stop(() => onCheck(true))} disabled={busy}>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Correct
            </Button>
            {unnamed && (
              <Button size="sm" variant="outline" onClick={stop(onName)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Name this site
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={stop(onChangeSite)} disabled={busy}>
              <MapPin className="h-3.5 w-3.5 mr-1.5" />
              Change site
            </Button>
            {it.kind === 'moved' && !it.returnOfShortTrip && (
              <Button size="sm" variant="outline" onClick={stop(onNotMoved)} disabled={busy}>
                It did not move
              </Button>
            )}
          </>
        )}
      </div>
    </div>
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
            <DialogDescription>Give the site a real name. The entry counts as checked.</DialogDescription>
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
