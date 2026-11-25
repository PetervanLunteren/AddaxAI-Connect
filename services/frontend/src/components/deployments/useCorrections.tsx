/**
 * The corrections of one camera (what people said about where it stood),
 * shown on the deployment card each one made: what was set, by whom and
 * when ("Last day set by peter@... on 25 Nov 2026"), with Undo. Undo takes
 * back the whole edit: a correction is one fact about one period, so its
 * parts cannot be undone apart; to change one part back, edit again. Cards the app placed show nothing. A correction belongs
 * to the cards whose days it covers; usually one, two only for an old
 * correction an edit later cut. Admins only (the endpoint is).
 *
 * In the code a correction is a fixed period (a statement): the GPS does not
 * change those days. Undo gives them back to the GPS, or to what a person
 * said before (an edit replaced it). The screens never say "fixed period".
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { deploymentsApi, type FixedPeriod } from '../../api/deployments';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toaster';
import { dayLabel } from './moves';

function daysLabel(p: FixedPeriod): string {
  return p.until_date
    ? `${p.site_name}, ${dayLabel(p.from_date)} to ${dayLabel(p.until_date)}`
    : `${p.site_name} from ${dayLabel(p.from_date)}`;
}

// "Site", "Last day", "Site and first day", "Site, first and last day":
// what an edit changed, as the start of the line on the card.
function whatWasSet(changes: string[] | null): string {
  if (!changes || changes.length === 0) return '';
  const site = changes.includes('site');
  const first = changes.includes('first_day');
  const last = changes.includes('last_day');
  const days = first && last ? 'first and last day' : first ? 'first day' : last ? 'last day' : '';
  const text = site && days ? `site${days === 'first and last day' ? ', ' : ' and '}${days}` : site ? 'site' : days;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setBy(p: FixedPeriod): string {
  if (p.source === 'upload') return 'Set by an upload';
  if (p.source === 'carried_over') return 'Kept from before the update';
  const when = dayLabel(p.created_at.slice(0, 10));
  const what = whatWasSet(p.changes);
  const verb = what ? `${what} set` : 'Set';
  return p.created_by ? `${verb} by ${p.created_by} on ${when}` : `${verb} on ${when}`;
}

/** Whether a correction covers part of a deployment's days (null = open). */
const covers = (p: FixedPeriod, start: string | null, end: string | null) =>
  start !== null && (p.until_date === null || p.until_date >= start) && (end === null || p.from_date <= end);

export function useCorrections(projectId: number | undefined, cameraId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<FixedPeriod | null>(null);

  const { data: periods = [] } = useQuery({
    queryKey: ['fixed-periods', cameraId],
    queryFn: () => deploymentsApi.fixedPeriods(projectId!, cameraId),
    enabled: enabled && projectId !== undefined,
  });

  const remove = useMutation({
    mutationFn: (p: FixedPeriod) => deploymentsApi.removeFixedPeriod(projectId!, p.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
      setRemoving(null);
      toast.success('Undone');
    },
    onError: (error: any) => {
      toast.error(`Could not undo this. ${error.response?.data?.detail || error.message || ''}`);
    },
  });

  /** The lines for one deployment card, nothing when the app placed it. */
  const linesFor = (start: string | null, end: string | null) => {
    const mine = periods.filter((p) => covers(p, start, end));
    if (mine.length === 0) return null;
    return (
      <ul className="mt-2 space-y-1 border-t pt-2">
        {mine.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={daysLabel(p)}>{setBy(p)}</span>
            {/* The same look as Edit at the top of the card. */}
            <button
              type="button"
              onClick={() => setRemoving(p)}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const dialog = (
    <ConfirmDialog
      open={removing !== null}
      onClose={() => setRemoving(null)}
      onConfirm={() => removing && remove.mutate(removing)}
      title="Undo this?"
      body={
        removing ? (
          <>
            {daysLabel(removing)}. The app works out the site of these days again,
            from the GPS or an earlier correction. Photos without GPS in these days
            have no site until it is set again.
          </>
        ) : ''
      }
      confirmLabel="Undo"
      variant="destructive"
      isPending={remove.isPending}
    />
  );

  return { linesFor, dialog };
}
