/**
 * Maintenance tab of the camera detail sheet (admins only).
 *
 * A short form to log a service visit (date, actions, who did it,
 * optional note) with the event history below it, newest first. Fetches
 * its own data, the same pattern as CameraHealthHistoryChart.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { camerasApi } from '../api/cameras';
import { projectsApi } from '../api/projects';
import type { MaintenanceActionType, MaintenanceEvent } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './ui/Toaster';
import { Button } from './ui/Button';

export const ACTION_LABELS: Record<MaintenanceActionType, string> = {
  battery_change: 'Battery change',
  sd_card_swap: 'SD card swap',
  cleaning: 'Cleaning',
  vegetation_clearing: 'Vegetation clearing',
  inspection: 'Inspection / check',
  // In-place angle change only. Moving a camera to a new site is a
  // placement change, handled on the Placements tab, not here.
  angle_adjustment: 'Adjusted angle',
  repair: 'Repair',
  other: 'Other',
};

/** Today as YYYY-MM-DD in the browser's local timezone. toISOString()
 * would be UTC and one day off in the evening east of Greenwich. */
export function localToday(): string {
  return new Date().toLocaleDateString('sv');
}

// Keep in sync with NOTE_MAX_LENGTH in services/api/routers/camera_maintenance.py.
export const NOTE_MAX_LENGTH = 2000;

interface CameraMaintenanceTabProps {
  cameraId: number;
  projectId: number;
}

export const CameraMaintenanceTab: React.FC<CameraMaintenanceTabProps> = ({
  cameraId,
  projectId,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const [eventDate, setEventDate] = useState<string>(localToday());
  const [actions, setActions] = useState<MaintenanceActionType[]>([]);
  const [performedBy, setPerformedBy] = useState<number | ''>(user?.id ?? '');
  const [note, setNote] = useState('');

  const { data: events, isLoading } = useQuery({
    queryKey: ['camera-maintenance', cameraId],
    queryFn: () => camerasApi.getMaintenanceEvents(cameraId),
  });

  // Members for the performed-by dropdown. Pending invitations have no
  // user id yet, so only registered members are listed.
  const { data: projectUsers } = useQuery({
    queryKey: ['project-users', projectId],
    queryFn: () => projectsApi.getUsers(projectId),
  });
  const members = (projectUsers ?? []).filter(
    (u): u is typeof u & { user_id: number } => u.is_registered && u.user_id !== null
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['camera-maintenance', cameraId] });
    // The list column and the overview line derive from the log.
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };

  const logMutation = useMutation({
    mutationFn: () =>
      camerasApi.logMaintenance(cameraId, {
        event_date: eventDate,
        action_types: actions,
        performed_by_user_id: performedBy === '' ? null : performedBy,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      invalidate();
      setActions([]);
      setNote('');
      setEventDate(localToday());
    },
    onError: (error: any) => {
      toast.error(`Failed to log service visit: ${error.response?.data?.detail || error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: number) => camerasApi.deleteMaintenanceEvent(cameraId, eventId),
    onSuccess: invalidate,
    onError: (error: any) => {
      toast.error(`Failed to delete event: ${error.response?.data?.detail || error.message}`);
    },
  });

  const toggleAction = (action: MaintenanceActionType) => {
    setActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  // The server rejects future dates (against its own timezone). Catch the
  // obvious case here so the user is not surprised by an error toast; the
  // server stays the source of truth for the timezone-boundary edge.
  const dateInFuture = eventDate !== '' && eventDate > localToday();
  const canSubmit =
    actions.length > 0 && eventDate !== '' && !dateInFuture && !logMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Log form */}
      <div className="rounded-lg border p-4 space-y-4">
        <p className="text-sm font-medium">Log a service visit</p>
        <div>
          <label className="text-xs text-muted-foreground">Date</label>
          <input
            type="date"
            value={eventDate}
            max={localToday()}
            onChange={(e) => setEventDate(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
          {dateInFuture && (
            <p className="text-xs text-destructive mt-1">The date cannot be in the future.</p>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Actions</label>
          <div className="mt-1 space-y-1.5">
            {(Object.keys(ACTION_LABELS) as MaintenanceActionType[]).map((action) => (
              <label key={action} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={actions.includes(action)}
                  onChange={() => toggleAction(action)}
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
                {ACTION_LABELS[action]}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Performed by</label>
          <select
            value={performedBy}
            onChange={(e) => setPerformedBy(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full px-3 py-2 border rounded-md text-sm bg-background"
          >
            <option value="">Not specified</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional, e.g. lens fogged up, replaced the desiccant"
            className="w-full px-3 py-2 border rounded-md text-sm"
            rows={2}
            maxLength={NOTE_MAX_LENGTH}
          />
        </div>
        <Button onClick={() => logMutation.mutate()} disabled={!canSubmit} className="w-full">
          {logMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Log visit
        </Button>
      </div>

      {/* Event history */}
      <div>
        <label className="text-xs text-muted-foreground">History</label>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-1">No service visits logged yet</p>
        ) : (
          <div className="mt-1 space-y-2">
            {events.map((event: MaintenanceEvent) => (
              <div key={event.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1.5">
                    <p className="font-medium">{event.event_date}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {event.action_types.map((action) => (
                        <span
                          key={action}
                          className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground"
                        >
                          {ACTION_LABELS[action] ?? action}
                        </span>
                      ))}
                    </div>
                    {event.performed_by_email && (
                      <p className="text-xs text-muted-foreground">
                        Performed by {event.performed_by_email}
                      </p>
                    )}
                    {event.note && (
                      <p className="text-xs whitespace-pre-wrap break-words">{event.note}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(event.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-accent shrink-0"
                    title="Delete this event"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
