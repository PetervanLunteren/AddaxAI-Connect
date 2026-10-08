/**
 * Service page: the one place to see and act on camera service.
 *
 * Open tasks on top (planned work, overdue first), visits below (the
 * service log). Marking a task done logs it as a visit and removes the
 * task, so the visits are the one history. Every member can read, scoped
 * to their sites by the API; project admins plan, log, complete, edit,
 * cancel and delete. The camera and site slide-outs only link here.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, ClipboardCheck, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu';
import { FilterBar, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { useToast } from '../components/ui/Toaster';
import { LogVisitDialog, PlanServiceDialog } from '../components/service/ServiceDialogs';
import { useProject } from '../contexts/ProjectContext';
import {
  serviceApi,
  serviceKeys,
  type ServiceTask,
  type ServiceVisit,
  type TaskFields,
  type VisitFields,
} from '../api/service';
import type { MaintenanceActionType } from '../api/types';
import { ACTION_LABELS, ACTION_TYPES, formatServiceDate } from '../lib/service-actions';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';

const FILTER_SCHEMA: FilterSchema = {
  site: 'string',
  camera: 'string',
  person: 'string',
  action: 'string',
  due: 'string',
  from: 'date',
  to: 'date',
};

const asString = (v: FilterValue): string => (typeof v === 'string' ? v : '');

const errorText = (error: any) => error?.response?.data?.detail || error?.message;

/** Site first, the camera id small below it. */
const SiteCell: React.FC<{ siteName: string | null; cameraLabel: string }> = ({ siteName, cameraLabel }) => (
  <div>
    <div className="font-medium">{siteName ?? 'No site'}</div>
    <div className="text-xs text-muted-foreground">{cameraLabel}</div>
  </div>
);

const ActionPills: React.FC<{ actions: MaintenanceActionType[] }> = ({ actions }) => (
  <div className="flex flex-wrap gap-1">
    {actions.map((a) => (
      <span key={a} className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground">
        {ACTION_LABELS[a] ?? a}
      </span>
    ))}
  </div>
);

const NoteCell: React.FC<{ note: string | null }> = ({ note }) =>
  note ? <p className="text-xs whitespace-pre-wrap break-words max-w-xs">{note}</p> : <span className="text-muted-foreground">-</span>;

export const ServicePage: React.FC = () => {
  const { selectedProject, canAdminCurrentProject: canAdmin } = useProject();
  const projectId = selectedProject?.id ?? 0;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [searchParams, setSearchParams] = usePersistedFilterParams('service', FILTER_SCHEMA);
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const filterValues: Record<string, FilterValue> = Object.fromEntries(
    Object.keys(FILTER_SCHEMA).map((key) => [key, asString(parsed[key]) || undefined]),
  );
  const onFilterChange = (patch: Record<string, FilterValue>) =>
    setSearchParams(filtersToSearchParams({ ...filterValues, ...patch }, FILTER_SCHEMA), { replace: true });
  const onClearAll = () => setSearchParams(new URLSearchParams(), { replace: true });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: serviceKeys.tasks(projectId),
    queryFn: () => serviceApi.listTasks(projectId),
    enabled: projectId > 0,
  });
  const { data: visits, isLoading: visitsLoading } = useQuery({
    queryKey: serviceKeys.visits(projectId),
    queryFn: () => serviceApi.listVisits(projectId),
    enabled: projectId > 0,
  });

  // Dialog state. A task set on a dialog means edit or complete that task.
  const [planOpen, setPlanOpen] = useState(false);
  const [editTask, setEditTask] = useState<ServiceTask | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [completeTask, setCompleteTask] = useState<ServiceTask | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ServiceTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceVisit | null>(null);

  const refresh = (what: { tasks?: boolean; visits?: boolean }) => {
    if (what.tasks) queryClient.invalidateQueries({ queryKey: serviceKeys.tasks(projectId) });
    if (what.visits) {
      queryClient.invalidateQueries({ queryKey: serviceKeys.visits(projectId) });
      // "Last service" on the cameras list and slide-out derives from the visits.
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    }
  };

  const planMutation = useMutation({
    mutationFn: ({ cameraIds, fields }: { cameraIds: number[]; fields: TaskFields }) =>
      editTask
        ? serviceApi.updateTask(projectId, editTask.id, fields)
        : serviceApi.planTasks(projectId, cameraIds, fields),
    onSuccess: () => {
      refresh({ tasks: true });
      toast.success(editTask ? 'Task saved' : 'Service planned');
      setPlanOpen(false);
      setEditTask(null);
    },
    onError: (error: any) => toast.error(`Could not save the task. ${errorText(error)}`),
  });

  const logMutation = useMutation({
    mutationFn: ({ cameraIds, fields }: { cameraIds: number[]; fields: VisitFields }) =>
      completeTask
        ? serviceApi.completeTask(projectId, completeTask.id, fields)
        : serviceApi.logVisits(projectId, cameraIds, fields),
    onSuccess: () => {
      refresh({ tasks: !!completeTask, visits: true });
      toast.success(completeTask ? 'Task done and logged as a visit' : 'Visit logged');
      setLogOpen(false);
      setCompleteTask(null);
    },
    onError: (error: any) => toast.error(`Could not log the visit. ${errorText(error)}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (task: ServiceTask) => serviceApi.cancelTask(projectId, task.id),
    onSuccess: () => {
      refresh({ tasks: true });
      setCancelTarget(null);
    },
    onError: (error: any) => toast.error(`Could not cancel the task. ${errorText(error)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (visit: ServiceVisit) => serviceApi.deleteVisit(projectId, visit.id),
    onSuccess: () => {
      refresh({ visits: true });
      setDeleteTarget(null);
    },
    onError: (error: any) => toast.error(`Could not delete the visit. ${errorText(error)}`),
  });

  // Filter options come from the rows themselves, so they only offer
  // values that can match.
  const siteOptions = useMemo(() => {
    const names = new Map<number, string>();
    [...(tasks ?? []), ...(visits ?? [])].forEach((r) => {
      if (r.site_id !== null && r.site_name) names.set(r.site_id, r.site_name);
    });
    return [...names.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: String(id), label: name }));
  }, [tasks, visits]);

  const personOptions = useMemo(() => {
    const people = new Map<number, string>();
    (tasks ?? []).forEach((t) => {
      if (t.assigned_to_user_id !== null && t.assigned_to_email) people.set(t.assigned_to_user_id, t.assigned_to_email);
    });
    (visits ?? []).forEach((v) => {
      if (v.performed_by_user_id !== null && v.performed_by_email) people.set(v.performed_by_user_id, v.performed_by_email);
    });
    return [...people.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, email]) => ({ value: String(id), label: email }));
  }, [tasks, visits]);

  const cameraLabel = useMemo(() => {
    const labels = new Map<string, string>();
    [...(tasks ?? []), ...(visits ?? [])].forEach((r) => labels.set(String(r.camera_id), r.camera_label));
    return labels;
  }, [tasks, visits]);

  const fields: FilterFieldDef[] = [
    { kind: 'select', key: 'site', label: 'Site', options: siteOptions, primary: true },
    { kind: 'select', key: 'person', label: 'Person', options: personOptions, primary: true },
    {
      kind: 'select',
      key: 'action',
      label: 'Action',
      options: ACTION_TYPES.map((a) => ({ value: a, label: ACTION_LABELS[a] })),
      primary: true,
    },
    { kind: 'select', key: 'due', label: 'Due', options: [{ value: 'overdue', label: 'Overdue' }], primary: true },
    { kind: 'date-range', fromKey: 'from', toKey: 'to', label: 'Visit date', primary: false },
    // Set by the "Service history" link in a camera slide-out.
    { kind: 'chip', key: 'camera', chipLabel: (id) => `Camera ${cameraLabel.get(id) ?? id}` },
  ];

  const f = {
    site: asString(parsed.site),
    camera: asString(parsed.camera),
    person: asString(parsed.person),
    action: asString(parsed.action),
    due: asString(parsed.due),
    from: asString(parsed.from),
    to: asString(parsed.to),
  };

  // The shared filters apply to both lists; due only to tasks, the date only to visits.
  const matchesShared = (row: ServiceTask | ServiceVisit, personId: number | null) =>
    (!f.site || String(row.site_id) === f.site) &&
    (!f.camera || String(row.camera_id) === f.camera) &&
    (!f.person || String(personId) === f.person) &&
    (!f.action || row.action_types.includes(f.action as MaintenanceActionType));

  const shownTasks = (tasks ?? []).filter(
    (t) => matchesShared(t, t.assigned_to_user_id) && (f.due !== 'overdue' || t.overdue),
  );
  const shownVisits = (visits ?? []).filter(
    (v) =>
      matchesShared(v, v.performed_by_user_id) &&
      (!f.from || v.event_date >= f.from) &&
      (!f.to || v.event_date <= f.to),
  );
  const isFiltered = Object.values(f).some(Boolean);

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view service.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-0">Service</h1>
          <p className="text-sm text-gray-600 mt-1">Planned work on your cameras and the visits already done</p>
        </div>
        {canAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLogOpen(true)} className="whitespace-nowrap">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Log visit
            </Button>
            <Button onClick={() => setPlanOpen(true)} className="whitespace-nowrap">
              <CalendarPlus className="h-4 w-4 mr-2" />
              Plan service
            </Button>
          </div>
        )}
      </div>

      <FilterBar
        fields={fields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
        displayControls={[]}
        displayValues={{}}
        onDisplayChange={() => {}}
      />

      {/* Open tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Open tasks
            {tasks && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {isFiltered ? `${shownTasks.length} of ${tasks.length}` : tasks.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tasksLoading ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Loading tasks...</p>
          ) : shownTasks.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {tasks && tasks.length > 0
                ? 'No open tasks match your filters.'
                : canAdmin
                  ? 'Nothing planned. Use Plan service to add work for the next field trip.'
                  : 'Nothing planned.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Actions</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Note</TableHead>
                    {canAdmin && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownTasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell><SiteCell siteName={task.site_name} cameraLabel={task.camera_label} /></TableCell>
                      <TableCell><ActionPills actions={task.action_types} /></TableCell>
                      <TableCell className="whitespace-nowrap">
                        {task.due_date ? (
                          <div className="flex flex-col items-start gap-1">
                            <span>{formatServiceDate(task.due_date)}</span>
                            {task.overdue && <StatusPill tone="error">Overdue</StatusPill>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {task.assigned_to_email ?? <span className="text-muted-foreground">Nobody yet</span>}
                      </TableCell>
                      <TableCell><NoteCell note={task.note} /></TableCell>
                      {canAdmin && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label="Task actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setCompleteTask(task)}>
                                <Check className="h-4 w-4 mr-2" />
                                Mark done
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setEditTask(task)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setCancelTarget(task)}>
                                <X className="h-4 w-4 mr-2" />
                                Cancel task
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Visits
            {visits && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {isFiltered ? `${shownVisits.length} of ${visits.length}` : visits.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {visitsLoading ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Loading visits...</p>
          ) : shownVisits.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {visits && visits.length > 0 ? 'No visits match your filters.' : 'No visits logged yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Actions</TableHead>
                    <TableHead>Performed by</TableHead>
                    <TableHead>Note</TableHead>
                    {canAdmin && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownVisits.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell className="whitespace-nowrap">{formatServiceDate(visit.event_date)}</TableCell>
                      <TableCell><SiteCell siteName={visit.site_name} cameraLabel={visit.camera_label} /></TableCell>
                      <TableCell><ActionPills actions={visit.action_types} /></TableCell>
                      <TableCell className="text-sm">
                        {visit.performed_by_email ?? <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell><NoteCell note={visit.note} /></TableCell>
                      {canAdmin && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Delete visit"
                            onClick={() => setDeleteTarget(visit)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canAdmin && (
        <>
          <PlanServiceDialog
            open={planOpen || editTask !== null}
            onClose={() => {
              setPlanOpen(false);
              setEditTask(null);
            }}
            projectId={projectId}
            task={editTask}
            isPending={planMutation.isPending}
            onConfirm={(cameraIds, fields) => planMutation.mutate({ cameraIds, fields })}
          />
          <LogVisitDialog
            open={logOpen || completeTask !== null}
            onClose={() => {
              setLogOpen(false);
              setCompleteTask(null);
            }}
            projectId={projectId}
            task={completeTask}
            isPending={logMutation.isPending}
            onConfirm={(cameraIds, fields) => logMutation.mutate({ cameraIds, fields })}
          />
          <ConfirmDialog
            open={cancelTarget !== null}
            onClose={() => setCancelTarget(null)}
            onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget)}
            title="Cancel this task?"
            body="The task is removed. Nothing is logged, because the work was not done."
            confirmLabel="Cancel task"
            cancelLabel="Keep task"
            variant="destructive"
            isPending={cancelMutation.isPending}
            focusCancel
          />
          <ConfirmDialog
            open={deleteTarget !== null}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            title="Delete this visit?"
            body="The visit is removed from the service history. This cannot be undone."
            confirmLabel="Delete visit"
            variant="destructive"
            isPending={deleteMutation.isPending}
            focusCancel
          />
        </>
      )}
    </div>
  );
};
