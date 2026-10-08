/**
 * The Service page dialogs: plan (and edit) a task, log a visit or mark
 * tasks done, and assign tasks.
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
import { Callout } from '../ui/Callout';
import { MultiSelect, type Option } from '../ui/MultiSelect';
import { MapSelectButton, MapSelectDialog } from '../map/MapSelectDialog';
import { camerasApi } from '../../api/cameras';
import { projectsApi } from '../../api/projects';
import type { Camera, MaintenanceActionType } from '../../api/types';
import type { CompleteFields, ServiceTask, TaskFields } from '../../api/service';
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
  /** Cameras to start with, from a selection on the Cameras or Sites page. */
  initialCameraIds?: number[];
  /** A line above the fields, e.g. which selected sites have no camera. */
  notice?: string;
  isPending: boolean;
  onConfirm: (cameraIds: number[], fields: TaskFields) => void;
}

export const PlanServiceDialog: React.FC<PlanServiceDialogProps> = ({
  open, onClose, projectId, task, initialCameraIds, notice, isPending, onConfirm,
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
    setCameraIds(task ? [task.camera_id] : (initialCameraIds ?? []));
    setActions(task?.action_types ?? []);
    setDueDate(task?.due_date ?? '');
    setAssignee(task?.assigned_to_user_id ?? '');
    setNotify(false);
    setNote(task?.note ?? '');
  }, [open, task, initialCameraIds]);

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
          {notice && <Callout variant="info">{notice}</Callout>}
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
// Log a visit, or mark tasks done
// ---------------------------------------------------------------------------

/** The person all the tasks share, else nobody. */
function sharedAssignee(tasks: ServiceTask[]): number | '' {
  const ids = new Set(tasks.map((t) => t.assigned_to_user_id));
  const [only] = [...ids];
  return ids.size === 1 && only !== null ? only : '';
}

interface LogVisitDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Set when marking tasks done. One task shows its planned actions and
   * note to adjust; several keep their own and only share date and person. */
  tasks?: ServiceTask[];
  isPending: boolean;
  onConfirm: (cameraIds: number[], fields: CompleteFields) => void;
}

export const LogVisitDialog: React.FC<LogVisitDialogProps> = ({
  open, onClose, projectId, tasks, isPending, onConfirm,
}) => {
  const { user } = useAuth();
  const members = useMembers(projectId, open);
  const completing = tasks !== undefined && tasks.length > 0;
  const single = completing && tasks.length === 1 ? tasks[0] : null;
  const showDetails = !completing || single !== null;

  const [cameraIds, setCameraIds] = useState<number[]>([]);
  const [date, setDate] = useState(localToday());
  const [actions, setActions] = useState<MaintenanceActionType[]>([]);
  const [performedBy, setPerformedBy] = useState<number | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setCameraIds([]);
    setDate(localToday());
    setActions(single?.action_types ?? []);
    setPerformedBy(completing ? sharedAssignee(tasks) : (user?.id ?? ''));
    setNote(single?.note ?? '');
  }, [open, tasks, single, completing, user?.id]);

  // The default performer is you, but only a project member can be picked.
  // A server admin without a membership falls back to "Not specified"
  // instead of a hidden value the server would refuse.
  const performer = members.some((m) => m.user_id === performedBy) ? performedBy : '';

  // The server rejects future dates against its own timezone; catch the
  // obvious case here, the server stays the source of truth at midnight.
  const dateInFuture = date !== '' && date > localToday();
  const canConfirm =
    (completing || cameraIds.length > 0) &&
    (!showDetails || actions.length > 0) &&
    date !== '' &&
    !dateInFuture &&
    !isPending;

  const title = !completing
    ? 'Log visit'
    : single
      ? `Mark done at ${single.site_name ?? single.camera_label}`
      : `Mark ${tasks.length} tasks done`;
  const description = !completing
    ? 'One visit with the same date and actions is logged on every camera you pick.'
    : single
      ? 'The task moves to Done with what was actually done.'
      : 'Each task moves to Done with its own planned actions and note.';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {!completing && (
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
          {showDetails && (
            <Field label="Actions">
              <ActionCheckboxes value={actions} onChange={setActions} />
            </Field>
          )}
          <Field label="Performed by">
            <MemberSelect value={performer} onChange={setPerformedBy} members={members} emptyLabel="Not specified" />
          </Field>
          {showDetails && (
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
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            disabled={!canConfirm}
            onClick={() =>
              onConfirm(cameraIds, {
                event_date: date,
                performed_by_user_id: performer === '' ? null : performer,
                action_types: showDetails ? actions : null,
                note: showDetails ? note.trim() || null : null,
              })
            }
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {completing ? 'Mark done' : 'Log visit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Assign tasks
// ---------------------------------------------------------------------------

interface AssignTasksDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  count: number;
  isPending: boolean;
  onConfirm: (assignedToUserId: number | null, notify: boolean) => void;
}

export const AssignTasksDialog: React.FC<AssignTasksDialogProps> = ({
  open, onClose, projectId, count, isPending, onConfirm,
}) => {
  const { user } = useAuth();
  const members = useMembers(projectId, open);
  const [assignee, setAssignee] = useState<number | ''>('');
  const [notify, setNotify] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAssignee('');
    setNotify(false);
  }, [open]);

  const canEmail = assignee !== '' && assignee !== user?.id;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Assign {count === 1 ? '1 task' : `${count} tasks`}</DialogTitle>
          <DialogDescription>Every selected task goes to the same person. Pick nobody to unassign them.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <Field label="Assigned to">
            <MemberSelect value={assignee} onChange={setAssignee} members={members} emptyLabel="Nobody" />
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={isPending} onClick={() => onConfirm(assignee === '' ? null : assignee, canEmail && notify)}>
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
