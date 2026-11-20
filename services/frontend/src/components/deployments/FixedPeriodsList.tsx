/**
 * The fixed periods of one camera, with who set them and Remove on each.
 * Shared by the camera panel and the Deployments page, admins only (the
 * endpoint is).
 *
 * A fixed period is a person's word about where the camera stood. The GPS
 * does not change those days. Removing one gives them back to the GPS, or
 * to an older fixed period.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deploymentsApi, type FixedPeriod } from '../../api/deployments';
import { formatDate } from '../../utils/datetime';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toaster';

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

function sourceLabel(p: FixedPeriod): string {
  if (p.source === 'upload') return 'set by an upload';
  if (p.source === 'carried_over') return 'kept from before the update';
  const when = dayLabel(p.created_at.slice(0, 10));
  return p.created_by ? `set by ${p.created_by} on ${when}` : `set on ${when}`;
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
      toast.success('Fixed period removed');
    },
    onError: (error: any) => {
      toast.error(`Could not remove the fixed period. ${error.response?.data?.detail || error.message || ''}`);
    },
  });

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Fixed periods</h3>
      <p className="text-xs text-muted-foreground">
        Periods where someone said where the camera stood. The GPS does not
        change them. Remove one and the camera follows its GPS again for those days.
      </p>
      {(fixedPeriods ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {(fixedPeriods ?? []).map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{p.site_name}</div>
                <div className="text-xs text-muted-foreground">
                  {dayLabel(p.from_date)} to {p.until_date ? dayLabel(p.until_date) : 'now'}, {sourceLabel(p)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Remove this fixed period?"
        body={
          removing ? (
            <>
              {removing.site_name}, {dayLabel(removing.from_date)} to{' '}
              {removing.until_date ? dayLabel(removing.until_date) : 'now'}. For these
              days the camera follows its GPS again, or an older fixed period. Photos
              without GPS in these days have no site until it is set again.
            </>
          ) : ''
        }
        confirmLabel="Remove"
        variant="destructive"
        isPending={remove.isPending}
      />
    </div>
  );
};
