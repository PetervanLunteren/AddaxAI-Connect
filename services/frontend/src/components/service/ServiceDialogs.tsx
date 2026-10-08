/**
 * The Service page dialogs: plan (and edit) a task, log (and complete)
 * a visit.
 *
 * Co-located because they share the camera picker, the action checkboxes
 * and the member dropdown, the same reasoning as BulkEditDialogs. Both
 * dialogs only collect values; the page owns the mutations.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { MultiSelect, type Option } from '../ui/MultiSelect';
import { MapSelectButton, MapSelectDialog } from '../map/MapSelectDialog';
import { camerasApi } from '../../api/cameras';
import { projectsApi } from '../../api/projects';
import type { Camera, MaintenanceActionType } from '../../api/types';
import type { ServiceTask, TaskFields, VisitFields } from '../../api/service';
import { useAuth } from '../../hooks/useAuth';
import { ACTION_LABELS, ACTION_TYPES, NOTE_MAX_LENGTH, localToday } from '../../lib/service-actions';

const inputClass = 'w-full px-3 py-2 border rounded-md text-sm bg-background';

/** "Big Oak North · 8612", site first because people know places, not IMEIs. */
function cameraOptionLabel(camera: Camera): string {
  return camera.current_site ? `${camera.current_site.name} · ${camera.name}` : camera.name;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-xs text-muted-foreground">{label}</label>
    <div className="mt-1">{children}</div>
  </div>
);

const ActionCheckboxes: React.FC<{
  value: MaintenanceActionType[];
  onChange: (value: MaintenanceActionType[]) => void;
}> = ({ value, onChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
    {ACTION_TYPES.map((action) => (
      <label key={action} className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={value.includes(action)}
          onChange={() =>
            onChange(value.includes(action) ? value.filter((a) => a !== action) : [...value, action])
          }
          className="h-4 w-4 cursor-pointer accent-primary"
        />
        {ACTION_LABELS[action]}
      </label>
    ))}
  </div>
);

/** Registered project members, for the assignee and performer dropdowns.
 * Pending invitations have no user id yet. */
function useMembers(projectId: number, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['project-users', projectId],
    queryFn: () => projectsApi.getUsers(projectId),
    enabled,
  });
  return (data ?? []).filter(
    (u): u is typeof u & { user_id: number } => u.is_registered && u.user_id !== null,
  );
}

const MemberSelect: React.FC<{
  value: number | '';
  onChange: (value: number | '') => void;
  members: { user_id: number; email: string }[];
  emptyLabel: string;
}> = ({ value, onChange, members, emptyLabel }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    className={inputClass}
  >
    <option value="">{emptyLabel}</option>
    {members.map((m) => (
      <option key={m.user_id} value={m.user_id}>{m.email}</option>
    ))}
  </select>
);

/** Pick cameras by site name, from a list or on the map. */
const CameraPicker: React.FC<{
  projectId: number;
  enabled: boolean;
  value: number[];
  onChange: (ids: number[]) => void;
}> = ({ projectId, enabled, value, onChange }) => {
  const [mapOpen, setMapOpen] = useState(false);
  const { data: cameras, isLoading } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled,
  });

  // Cameras with a site first, by site name; cameras without one after.
  const sorted = useMemo(
    () =>
      [...(cameras ?? [])].sort((a, b) => {
        if (!a.current_site !== !b.current_site) return a.current_site ? -1 : 1;
        return cameraOptionLabel(a).localeCompare(cameraOptionLabel(b));
      }),
    [cameras],
  );
  const options: Option[] = sorted.map((c) => ({ value: c.id, label: cameraOptionLabel(c) }));
  const selected = options.filter((o) => value.includes(o.value as number));

  return (
    <div className="flex items-start gap-2">
      <MultiSelect
        options={options}
        value={selected}
        onChange={(next) => onChange(next.map((o) => o.value as number))}
        isLoading={isLoading}
        selectedNoun="cameras"
        className="flex-1 min-w-0"
      />
      <MapSelectButton onClick={() => setMapOpen(true)} />
      <MapSelectDialog
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        noun="camera"
        items={sorted.map((c) => ({
          id: c.id,
          label: cameraOptionLabel(c),
          latitude: c.location?.lat ?? null,
          longitude: c.location?.lon ?? null,
        }))}
        initialSelected={new Set(value)}
        onConfirm={(on) => {
          onChange(on);
          setMapOpen(false);
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plan or edit a task
// ---------------------------------------------------------------------------

interface PlanServiceDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  // Set when editing; the camera is then fixed.
  task?: ServiceTask | null;
  isPending: boolean;
  onConfirm: (cameraIds: number[], fields: TaskFields) => void;
}

export const PlanServiceDialog: React.FC<PlanServiceDialogProps> = ({
  open, onClose, projectId, task, isPending, onConfirm,
}) => {
  const { user } = useAuth();
  const members = useMembers(projectId, open);
  const [cameraIds, setCameraIds] = useState<number[]>([]);
  const [actions, setActions] = useState<MaintenanceActionType[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState<number | ''>('');
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setCameraIds(task ? [task.camera_id] : []);
    setActions(task?.action_types ?? []);
    setDueDate(task?.due_date ?? '');
    setAssignee(task?.assigned_to_user_id ?? '');
    setNotify(false);
    setNote(task?.note ?? '');
  }, [open, task]);

  const canEmail = assignee !== '' && assignee !== user?.id;
  const canConfirm = cameraIds.length > 0 && actions.length > 0 && !isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>
            {task ? `Edit task for ${task.site_name ?? task.camera_label}` : 'Plan service'}
          </DialogTitle>
          <DialogDescription>
            {task
              ? 'Change what needs doing, when, or who does it.'
              : 'One task is made for every camera you pick. Mark each one done when the work is finished.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {!task && (
            <Field label="Cameras">
              <CameraPicker projectId={projectId} enabled={open} value={cameraIds} onChange={setCameraIds} />
            </Field>
          )}
          <Field label="Actions">
            <ActionCheckboxes value={actions} onChange={setActions} />
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Assigned to">
            <MemberSelect value={assignee} onChange={setAssignee} members={members} emptyLabel="Nobody yet" />
          </Field>
          {canEmail && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-primary"
              />
              Send email to assignee
            </label>
          )}
          <Field label="Note">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional, e.g. bramble grows in front of the lens"
              className={inputClass}
              rows={2}
              maxLength={NOTE_MAX_LENGTH}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            disabled={!canConfirm}
            onClick={() =>
              onConfirm(cameraIds, {
                action_types: actions,
                note: note.trim() || null,
                due_date: dueDate || null,
                assigned_to_user_id: assignee === '' ? null : assignee,
                notify: canEmail && notify,
              })
            }
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {task ? 'Save task' : cameraIds.length > 1 ? `Plan ${cameraIds.length} tasks` : 'Plan task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Log a visit, or complete a task as one
// ---------------------------------------------------------------------------

interface LogVisitDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  // Set when completing; the visit is prefilled from it and its camera is fixed.
  task?: ServiceTask | null;
  isPending: boolean;
  onConfirm: (cameraIds: number[], fields: VisitFields) => void;
}

export const LogVisitDialog: React.FC<LogVisitDialogProps> = ({
  open, onClose, projectId, task, isPending, onConfirm,
}) => {
  const { user } = useAuth();
  const members = useMembers(projectId, open);
  const [cameraIds, setCameraIds] = useState<number[]>([]);
  const [date, setDate] = useState(localToday());
  const [actions, setActions] = useState<MaintenanceActionType[]>([]);
  const [performedBy, setPerformedBy] = useState<number | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setCameraIds(task ? [task.camera_id] : []);
    setDate(localToday());
    setActions(task?.action_types ?? []);
    setPerformedBy(task ? (task.assigned_to_user_id ?? '') : (user?.id ?? ''));
    setNote(task?.note ?? '');
  }, [open, task, user?.id]);

  // The server rejects future dates against its own timezone; catch the
  // obvious case here, the server stays the source of truth at midnight.
  const dateInFuture = date !== '' && date > localToday();
  const canConfirm = cameraIds.length > 0 && actions.length > 0 && date !== '' && !dateInFuture && !isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>
            {task ? `Mark done at ${task.site_name ?? task.camera_label}` : 'Log visit'}
          </DialogTitle>
          <DialogDescription>
            {task
              ? 'The task moves to the visits with what was actually done.'
              : 'One visit with the same date and actions is logged on every camera you pick.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {!task && (
            <Field label="Cameras">
              <CameraPicker projectId={projectId} enabled={open} value={cameraIds} onChange={setCameraIds} />
            </Field>
          )}
          <Field label="Date">
            <input
              type="date"
              value={date}
              max={localToday()}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
            {dateInFuture && <p className="text-xs text-destructive mt-1">The date cannot be in the future.</p>}
          </Field>
          <Field label="Actions">
            <ActionCheckboxes value={actions} onChange={setActions} />
          </Field>
          <Field label="Performed by">
            <MemberSelect value={performedBy} onChange={setPerformedBy} members={members} emptyLabel="Not specified" />
          </Field>
          <Field label="Note">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional, e.g. lens fogged up, replaced the desiccant"
              className={inputClass}
              rows={2}
              maxLength={NOTE_MAX_LENGTH}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            disabled={!canConfirm}
            onClick={() =>
              onConfirm(cameraIds, {
                event_date: date,
                action_types: actions,
                performed_by_user_id: performedBy === '' ? null : performedBy,
                note: note.trim() || null,
              })
            }
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {task ? 'Mark done' : 'Log visit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
