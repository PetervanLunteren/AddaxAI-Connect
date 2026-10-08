/**
 * Service page: the one place to see and act on camera service.
 *
 * Two tabs over the same tables, filters and selection as the cameras and
 * sites pages. Open is planned work (overdue first), Done is the service
 * log. Marking a task done logs it as a visit and removes the task, so
 * Done is the one history. Every member can read, scoped to their sites by
 * the API; project admins plan, log and act on selected rows from the bulk
 * bar, and a row click edits a task. The camera and site slide-outs only
 * link here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ClipboardCheck } from 'lucide-react';

import { Card, CardContent } from '../components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TabStrip } from '../components/ui/TabStrip';
import { BulkActionBar } from '../components/ui/BulkActionBar';
import { SelectAllCheckbox } from '../components/ui/SelectAllCheckbox';
import { SortableHeader, type SortState } from '../components/ui/SortableHeader';
import { FilterBar, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { useToast } from '../components/ui/Toaster';
import { AssignTasksDialog, LogVisitDialog, PlanServiceDialog } from '../components/service/ServiceDialogs';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useProject } from '../contexts/ProjectContext';
import {
  serviceApi,
  serviceKeys,
  type CompleteFields,
  type ServiceTask,
  type ServiceVisit,
  type TaskFields,
} from '../api/service';
import type { MaintenanceActionType } from '../api/types';
import { ACTION_LABELS, ACTION_TYPES, formatServiceDate } from '../lib/service-actions';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';

type Tab = 'open' | 'done';
type TaskColumn = 'site' | 'due' | 'assignee';
type VisitColumn = 'date' | 'site' | 'performer';

const FILTER_SCHEMA: FilterSchema = {
  tab: 'string',
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

/** Sort by one value with empty values last, like the cameras table. No
 * column keeps the server order: overdue first for tasks, newest first for visits. */
function sortRows<T>(rows: T[], direction: 'asc' | 'desc', value: ((row: T) => string | null) | null): T[] {
  if (!value) return rows;
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return sign * va.localeCompare(vb, undefined, { sensitivity: 'base' });
  });
}

const TASK_SORT: Record<TaskColumn, (t: ServiceTask) => string | null> = {
  site: (t) => t.site_name,
  due: (t) => t.due_date,
  assignee: (t) => t.assigned_to_email,
};

const VISIT_SORT: Record<VisitColumn, (v: ServiceVisit) => string | null> = {
  date: (v) => v.event_date,
  site: (v) => v.site_name,
  performer: (v) => v.performed_by_email,
};

/** Site first, the camera id small below it. */
const SiteCell: React.FC<{ siteName: string | null; cameraLabel: string }> = ({ siteName, cameraLabel }) => (
  <div>
    <div className="font-medium">{siteName ?? 'No site'}</div>
    <div className="text-xs text-muted-foreground">{cameraLabel}</div>
  </div>
);

/** In vocabulary order, whatever order they were ticked in. */
const ActionPills: React.FC<{ actions: MaintenanceActionType[] }> = ({ actions }) => (
  <div className="flex flex-wrap gap-1">
    {ACTION_TYPES.filter((a) => actions.includes(a)).map((a) => (
      <span key={a} className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground">
        {ACTION_LABELS[a]}
      </span>
    ))}
  </div>
);

const NoteCell: React.FC<{ note: string | null }> = ({ note }) =>
  note ? <p className="text-xs whitespace-pre-wrap break-words max-w-xs">{note}</p> : <span className="text-muted-foreground">-</span>;

const RowCheckbox: React.FC<{ label: string; checked: boolean; onToggle: () => void }> = ({ label, checked, onToggle }) => (
  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onToggle}
      className="w-4 h-4 cursor-pointer accent-primary"
    />
  </TableCell>
);

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
  const f = Object.fromEntries(Object.keys(FILTER_SCHEMA).map((key) => [key, asString(parsed[key])]));
  const tab: Tab = f.tab === 'done' ? 'done' : 'open';

  const onFilterChange = (patch: Record<string, FilterValue>) =>
    setSearchParams(filtersToSearchParams({ ...filterValues, ...patch }, FILTER_SCHEMA), { replace: true });
  // Clear all keeps the tab; it is where you are, not a filter.
  const onClearAll = () =>
    setSearchParams(filtersToSearchParams({ tab: filterValues.tab }, FILTER_SCHEMA), { replace: true });

  const { selected, toggle, clear, setMany } = useBulkSelection();
  const [taskSort, setTaskSort] = useState<SortState<TaskColumn>>({ column: null, direction: 'asc' });
  const [visitSort, setVisitSort] = useState<SortState<VisitColumn>>({ column: null, direction: 'desc' });
  const nextSort = <C extends string>(prev: SortState<C>, column: C): SortState<C> =>
    prev.column === column ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' };

  // A selection belongs to one table.
  useEffect(() => clear(), [tab, clear]);

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

  // Dialog state. Task lists are snapshots taken when a dialog opens.
  const [planOpen, setPlanOpen] = useState(false);
  const [editTask, setEditTask] = useState<ServiceTask | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [doneTasks, setDoneTasks] = useState<ServiceTask[] | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = (what: { tasks?: boolean; visits?: boolean }) => {
    if (what.tasks) queryClient.invalidateQueries({ queryKey: serviceKeys.tasks(projectId) });
    if (what.visits) {
      queryClient.invalidateQueries({ queryKey: serviceKeys.visits(projectId) });
      // "Last service" on the cameras list and slide-out derives from the visits.
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    }
  };
  const onError = (what: string) => (error: any) => toast.error(`Could not ${what}. ${errorText(error)}`);
  const selectedIds = Array.from(selected);
  const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

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
    onError: onError('save the task'),
  });

  const logMutation = useMutation({
    mutationFn: ({ cameraIds, fields }: { cameraIds: number[]; fields: CompleteFields }) =>
      doneTasks
        ? serviceApi.completeTasks(projectId, doneTasks.map((t) => t.id), fields)
        : serviceApi.logVisits(projectId, cameraIds, { ...fields, action_types: fields.action_types ?? [] }),
    onSuccess: () => {
      refresh({ tasks: !!doneTasks, visits: true });
      toast.success(doneTasks ? `${plural(doneTasks.length, 'task')} done` : 'Visit logged');
      setLogOpen(false);
      setDoneTasks(null);
      clear();
    },
    onError: onError('log the visit'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ assignee, notify }: { assignee: number | null; notify: boolean }) =>
      serviceApi.assignTasks(projectId, selectedIds, assignee, notify),
    onSuccess: () => {
      refresh({ tasks: true });
      toast.success(`${plural(selectedIds.length, 'task')} assigned`);
      setAssignOpen(false);
      clear();
    },
    onError: onError('assign the tasks'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => serviceApi.cancelTasks(projectId, selectedIds),
    onSuccess: () => {
      refresh({ tasks: true });
      setConfirmCancel(false);
      clear();
    },
    onError: onError('cancel the tasks'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => serviceApi.deleteVisits(projectId, selectedIds),
    onSuccess: () => {
      refresh({ visits: true });
      setConfirmDelete(false);
      clear();
    },
    onError: onError('delete the visits'),
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

  // Shared fields first, then the one that only applies to this tab.
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
    tab === 'open'
      ? { kind: 'select', key: 'due', label: 'Due', options: [{ value: 'overdue', label: 'Overdue' }], primary: true }
      : { kind: 'date-range', fromKey: 'from', toKey: 'to', label: 'Date', primary: true },
    // Set by the links in the camera slide-out.
    { kind: 'chip', key: 'camera', chipLabel: (id) => `Camera ${cameraLabel.get(id) ?? id}` },
  ];

  const matchesShared = (row: ServiceTask | ServiceVisit, personId: number | null) =>
    (!f.site || String(row.site_id) === f.site) &&
    (!f.camera || String(row.camera_id) === f.camera) &&
    (!f.person || String(personId) === f.person) &&
    (!f.action || row.action_types.includes(f.action as MaintenanceActionType));

  const shownTasks = sortRows(
    (tasks ?? []).filter((t) => matchesShared(t, t.assigned_to_user_id) && (f.due !== 'overdue' || t.overdue)),
    taskSort.direction,
    taskSort.column ? TASK_SORT[taskSort.column] : null,
  );
  const shownVisits = sortRows(
    (visits ?? []).filter(
      (v) =>
        matchesShared(v, v.performed_by_user_id) &&
        (!f.from || v.event_date >= f.from) &&
        (!f.to || v.event_date <= f.to),
    ),
    visitSort.direction,
    visitSort.column ? VISIT_SORT[visitSort.column] : null,
  );

  const rows = tab === 'open' ? (tasks ?? []) : (visits ?? []);
  const shown = tab === 'open' ? shownTasks : shownVisits;
  const loading = tab === 'open' ? tasksLoading : visitsLoading;
  const noun = tab === 'open' ? 'tasks' : 'visits';
  const tabFilterKeys = ['site', 'person', 'action', 'camera', ...(tab === 'open' ? ['due'] : ['from', 'to'])];
  const isFiltered = tabFilterKeys.some((key) => f[key]);

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

      <div className="space-y-3">
        <FilterBar
          fields={fields}
          values={filterValues}
          onChange={onFilterChange}
          onClearAll={onClearAll}
          displayControls={[]}
          displayValues={{}}
          onDisplayChange={() => {}}
        />
        {isFiltered && rows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {shown.length} of {rows.length} {noun}
          </p>
        )}
      </div>

      <TabStrip<Tab>
        tabs={[
          { key: 'open', label: 'Open', count: tasks?.length },
          { key: 'done', label: 'Done' },
        ]}
        value={tab}
        onChange={(key) => onFilterChange({ tab: key === 'open' ? undefined : key })}
      />

      {canAdmin && selected.size > 0 && (
        <BulkActionBar selected={selected.size} total={rows.length} noun={noun} onClear={clear}>
          {tab === 'open' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDoneTasks((tasks ?? []).filter((t) => selected.has(t.id)))}
              >
                Mark done
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                Assign
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel tasks
              </Button>
            </>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </BulkActionBar>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted-foreground">Loading {noun}...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          {tab === 'done'
            ? 'No visits logged yet.'
            : canAdmin
              ? 'Nothing planned. Use Plan service to add work for the next field trip.'
              : 'Nothing planned.'}
        </p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                {tab === 'open' ? (
                  <>
                    <TableHeader>
                      <TableRow>
                        {canAdmin && (
                          <TableHead className="w-10">
                            <SelectAllCheckbox
                              visibleIds={shownTasks.map((t) => t.id)}
                              selected={selected}
                              onToggle={setMany}
                              ariaLabel="Select all visible tasks"
                            />
                          </TableHead>
                        )}
                        <TableHead>
                          <SortableHeader label="Site" column="site" sort={taskSort} onSort={(c) => setTaskSort((p) => nextSort(p, c))} />
                        </TableHead>
                        <TableHead>Actions</TableHead>
                        <TableHead>
                          <SortableHeader label="Due" column="due" sort={taskSort} onSort={(c) => setTaskSort((p) => nextSort(p, c))} />
                        </TableHead>
                        <TableHead>
                          <SortableHeader label="Assigned to" column="assignee" sort={taskSort} onSort={(c) => setTaskSort((p) => nextSort(p, c))} />
                        </TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shownTasks.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={canAdmin ? 6 : 5} className="text-center py-8 text-muted-foreground">
                            No open tasks match your filters.
                          </TableCell>
                        </TableRow>
                      )}
                      {shownTasks.map((task) => (
                        <TableRow
                          key={task.id}
                          className={canAdmin ? 'cursor-pointer' : undefined}
                          onClick={canAdmin ? () => setEditTask(task) : undefined}
                        >
                          {canAdmin && (
                            <RowCheckbox
                              label={`Select task at ${task.site_name ?? task.camera_label}`}
                              checked={selected.has(task.id)}
                              onToggle={() => toggle(task.id)}
                            />
                          )}
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                ) : (
                  <>
                    <TableHeader>
                      <TableRow>
                        {canAdmin && (
                          <TableHead className="w-10">
                            <SelectAllCheckbox
                              visibleIds={shownVisits.map((v) => v.id)}
                              selected={selected}
                              onToggle={setMany}
                              ariaLabel="Select all visible visits"
                            />
                          </TableHead>
                        )}
                        <TableHead>
                          <SortableHeader label="Date" column="date" sort={visitSort} onSort={(c) => setVisitSort((p) => nextSort(p, c))} />
                        </TableHead>
                        <TableHead>
                          <SortableHeader label="Site" column="site" sort={visitSort} onSort={(c) => setVisitSort((p) => nextSort(p, c))} />
                        </TableHead>
                        <TableHead>Actions</TableHead>
                        <TableHead>
                          <SortableHeader label="Performed by" column="performer" sort={visitSort} onSort={(c) => setVisitSort((p) => nextSort(p, c))} />
                        </TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shownVisits.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={canAdmin ? 6 : 5} className="text-center py-8 text-muted-foreground">
                            No visits match your filters.
                          </TableCell>
                        </TableRow>
                      )}
                      {shownVisits.map((visit) => (
                        <TableRow key={visit.id}>
                          {canAdmin && (
                            <RowCheckbox
                              label={`Select visit at ${visit.site_name ?? visit.camera_label}`}
                              checked={selected.has(visit.id)}
                              onToggle={() => toggle(visit.id)}
                            />
                          )}
                          <TableCell className="whitespace-nowrap">{formatServiceDate(visit.event_date)}</TableCell>
                          <TableCell><SiteCell siteName={visit.site_name} cameraLabel={visit.camera_label} /></TableCell>
                          <TableCell><ActionPills actions={visit.action_types} /></TableCell>
                          <TableCell className="text-sm">
                            {visit.performed_by_email ?? <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell><NoteCell note={visit.note} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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
            open={logOpen || doneTasks !== null}
            onClose={() => {
              setLogOpen(false);
              setDoneTasks(null);
            }}
            projectId={projectId}
            tasks={doneTasks ?? undefined}
            isPending={logMutation.isPending}
            onConfirm={(cameraIds, fields) => logMutation.mutate({ cameraIds, fields })}
          />
          <AssignTasksDialog
            open={assignOpen}
            onClose={() => setAssignOpen(false)}
            projectId={projectId}
            count={selected.size}
            isPending={assignMutation.isPending}
            onConfirm={(assignee, notify) => assignMutation.mutate({ assignee, notify })}
          />
          <ConfirmDialog
            open={confirmCancel}
            onClose={() => setConfirmCancel(false)}
            onConfirm={() => cancelMutation.mutate()}
            title={`Cancel ${plural(selected.size, 'task')}?`}
            body="The tasks are removed. Nothing is logged, because the work was not done."
            confirmLabel="Cancel tasks"
            cancelLabel="Keep tasks"
            variant="destructive"
            isPending={cancelMutation.isPending}
            focusCancel
          />
          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => deleteMutation.mutate()}
            title={`Delete ${plural(selected.size, 'visit')}?`}
            body="The visits are removed from the service history. This cannot be undone."
            confirmLabel="Delete"
            variant="destructive"
            isPending={deleteMutation.isPending}
            focusCancel
          />
        </>
      )}
    </div>
  );
};
