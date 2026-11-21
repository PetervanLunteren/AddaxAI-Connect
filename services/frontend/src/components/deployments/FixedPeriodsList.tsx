/**
 * What people said about where one camera stood, with who and when, and
 * Undo on each. In the camera panel, admins only (the endpoint is). Shows
 * nothing until someone set one: there is nothing to undo.
 *
 * In the code this is a fixed period (a statement): the GPS does not change
 * those days. Undo gives them back to the GPS, or to what a person said
 * before. The screens call them corrections, never "fixed period".
 *
 * A row says what was set and who set it, not what the app had before: that
 * is worked out again on every rebuild, is not stored, and one correction
 * can cover several earlier sites.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deploymentsApi, type FixedPeriod } from '../../api/deployments';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toaster';

import { dayLabel } from './update-items';

function daysLabel(p: FixedPeriod): string {
  return p.until_date
    ? `${p.site_name}, ${dayLabel(p.from_date)} to ${dayLabel(p.until_date)}`
    : `${p.site_name} from ${dayLabel(p.from_date)}`;
}

function sourceLabel(p: FixedPeriod): string {
  if (p.source === 'upload') return 'by an upload';
  if (p.source === 'carried_over') return 'kept from before the update';
  const when = dayLabel(p.created_at.slice(0, 10));
  return p.created_by ? `by ${p.created_by}, ${when}` : when;
}

export const FixedPeriodsList: React.FC<{ projectId: number; cameraId: number }> = ({ projectId, cameraId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<FixedPeriod | null>(null);

  const { data: fixedPeriods } = useQuery({
    queryKey: ['fixed-periods', cameraId],
    queryFn: () => deploymentsApi.fixedPeriods(projectId, cameraId),
  });

  const remove = useMutation({
    mutationFn: (p: FixedPeriod) => deploymentsApi.removeFixedPeriod(projectId, p.id),
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

  const periods = fixedPeriods ?? [];
  if (periods.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Corrections</h3>
      <p className="text-xs text-muted-foreground">
        Undo one and the app works out the site again.
      </p>
      <ul className="divide-y border rounded-md">
        {periods.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{daysLabel(p)}</div>
              <div className="text-xs text-muted-foreground truncate">{sourceLabel(p)}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
              Undo
            </Button>
          </li>
        ))}
      </ul>

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
    </div>
  );
};
