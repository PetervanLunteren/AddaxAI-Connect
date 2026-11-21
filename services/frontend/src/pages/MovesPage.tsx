/**
 * Moves: what the app noticed about where cameras stood, and what
 * people decided about it. Project admins only.
 *
 * One table of every move the app saw and every correction a person made
 * (rows from update-items.ts). A camera that started somewhere is not
 * here (nothing to check; naming a place is in the site panel), nor are
 * photos without a site (a camera's problem, on the Cameras page). It opens with what waits on top, then the
 * history, newest first; a header sorts, the filter bar finds one row
 * ("corrected by Harry in November 2024"). A row click opens the check
 * window at that row, and its arrows step through the rows as shown.
 *
 * Checkboxes on every row. The bulk bar offers each action for the rows it
 * fits, with a count: Mark right and Undo checks change no data, so they
 * run at once; Undo corrections moves photos between sites, so it asks
 * first with the cameras named and a typed word.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deploymentsApi } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { CheckMovesModal } from '../components/deployments/CheckMovesModal';
import {
  STATUS_LABELS, dateLabel, dayLabel, decided, defaultOrder, route, siteIds, updateItems,
  updateStatus, type UpdateItem, type UpdateStatus,
} from '../components/deployments/update-items';
import { BulkActionBar } from '../components/ui/BulkActionBar';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { ConfirmWordField } from '../components/ui/ConfirmWordField';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { FilterBar, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { ImpactBox } from '../components/ui/ImpactBox';
import { SelectAllCheckbox } from '../components/ui/SelectAllCheckbox';
import { SortableHeader, type SortState } from '../components/ui/SortableHeader';
import { StatusPill, type PillTone } from '../components/ui/StatusPill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/Toaster';
import { useProject } from '../contexts/ProjectContext';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';

type Column = 'date' | 'camera' | 'where' | 'status';

const FILTER_SCHEMA: FilterSchema = {
  camera: 'string',
  site: 'string',
  status: 'string',
  by: 'string',
  from: 'date',
  to: 'date',
};

const UNDO_WORD = 'UNDO';

const STATUS_TONE: Record<UpdateStatus, PillTone> = {
  needsYou: 'warning',
  notChecked: 'muted',
  checked: 'neutral',
  corrected: 'neutral',
};

const asString = (v: FilterValue): string => (typeof v === 'string' ? v : '');
const errorText = (error: any) => error?.response?.data?.detail || error?.message;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SORT: Record<Column, (it: UpdateItem) => string> = {
  date: (it) => it.day,
  camera: (it) => it.cameraLabel,
  where: (it) => route(it),
  status: (it) => STATUS_LABELS[updateStatus(it)],
};

export const MovesPage: React.FC = () => {
  const { selectedProject, canAdminCurrentProject: canAdmin } = useProject();
  const projectId = selectedProject?.id ?? 0;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [searchParams, setSearchParams] = usePersistedFilterParams('moves', FILTER_SCHEMA);
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const filterValues: Record<string, FilterValue> = Object.fromEntries(
    Object.keys(FILTER_SCHEMA).map((key) => [key, asString(parsed[key]) || undefined]),
  );
  const f = Object.fromEntries(Object.keys(FILTER_SCHEMA).map((key) => [key, asString(parsed[key])]));
  const write = (values: Record<string, FilterValue>) =>
    setSearchParams(filtersToSearchParams(values, FILTER_SCHEMA), { replace: true });

  const enabled = projectId > 0 && canAdmin;
  const { data: deployments, isLoading } = useQuery({
    queryKey: ['deployments', projectId, 'overview'],
    queryFn: () => deploymentsApi.list(projectId),
    enabled,
  });
  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
    enabled,
  });
  // Keyed under 'fixed-periods', so every save and Undo refreshes it.
  const { data: corrections } = useQuery({
    queryKey: ['fixed-periods', 'project', projectId],
    queryFn: () => deploymentsApi.fixedPeriods(projectId),
    enabled,
  });
  const items = useMemo(
    () => (deployments ? updateItems(deployments, corrections) : []),
    [deployments, corrections],
  );

  const [sort, setSort] = useState<SortState<Column>>({ column: null, direction: 'asc' });
  const { selected, toggle, clear, setMany } = useBulkSelection<string>();
  const [opened, setOpened] = useState<{ keys: string[]; start: string } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoWord, setUndoWord] = useState('');

  // Filter options come from the rows, so each one can match.
  const options = useMemo(() => {
    const cameras = new Map<string, string>();
    const siteNames = new Map<string, string>();
    const people = new Set<string>();
    for (const it of items) {
      cameras.set(String(it.cameraId), it.cameraLabel);
      for (const s of [it.deployment, it.previous]) if (s?.site_id != null) siteNames.set(String(s.site_id), s.site_name ?? '');
      if (it.correction) siteNames.set(String(it.correction.site_id), it.correction.site_name);
      const by = decided(it)?.by;
      if (by) people.add(by);
    }
    const sorted = (m: Map<string, string>) =>
      [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
    return {
      cameras: sorted(cameras),
      sites: sorted(siteNames),
      people: [...people].sort().map((p) => ({ value: p, label: p })),
    };
  }, [items]);

  const fields: FilterFieldDef[] = [
    { kind: 'select', key: 'camera', label: 'Camera', options: options.cameras, primary: true },
    { kind: 'select', key: 'site', label: 'Site', options: options.sites, primary: true },
    {
      kind: 'select', key: 'status', label: 'Status', primary: true,
      options: (Object.keys(STATUS_LABELS) as UpdateStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
    },
    { kind: 'date-range', fromKey: 'from', toKey: 'to', label: 'Date', primary: true },
    { kind: 'select', key: 'by', label: 'Decided by', options: options.people, primary: false },
  ];

  const shown = useMemo(() => {
    const rows = items.filter((it) => {
      const who = decided(it);
      return (
        (!f.camera || String(it.cameraId) === f.camera) &&
        (!f.site || siteIds(it).some((id) => String(id) === f.site)) &&
        (!f.status || updateStatus(it) === f.status) &&
        (!f.by || who?.by === f.by) &&
        (!f.from || it.day >= f.from) &&
        (!f.to || it.day <= f.to)
      );
    });
    if (!sort.column) return defaultOrder(rows);
    const value = SORT[sort.column];
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => sign * value(a).localeCompare(value(b), undefined, { sensitivity: 'base' }));
  }, [items, f.camera, f.site, f.status, f.by, f.from, f.to, sort]);
  const isFiltered = Object.values(f).some(Boolean);

  // What each bulk action fits among the selected rows. A selection survives
  // filtering, so these count every selected row, shown or not.
  const chosen = items.filter((it) => selected.has(it.key));
  const toMarkRight = chosen.filter((it) => it.kind === 'moved' && !it.answered);
  const toUncheck = chosen.filter((it) => it.kind === 'moved' && it.answered);
  const toUndo = chosen.filter((it) => it.kind === 'corrected');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
    queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
  };
  const setChecked = useMutation({
    mutationFn: ({ rows, checked }: { rows: UpdateItem[]; checked: boolean }) =>
      deploymentsApi.setChecked(projectId, rows.map((it) => it.deployment!.id), checked),
    onSuccess: (_, { rows, checked }) => {
      refresh();
      clear();
      toast.success(checked ? `${plural(rows.length, 'move', 'moves')} marked right` : `${plural(rows.length, 'check', 'checks')} undone`);
    },
    onError: (error) => toast.error(`Could not save. ${errorText(error)}`),
  });
  const undoCorrections = useMutation({
    mutationFn: (rows: UpdateItem[]) => deploymentsApi.removeFixedPeriods(projectId, rows.map((it) => it.correction!.id)),
    onSuccess: (_, rows) => {
      refresh();
      clear();
      setUndoOpen(false);
      setUndoWord('');
      toast.success(`${plural(rows.length, 'correction', 'corrections')} undone`);
    },
    onError: (error) => toast.error(`Could not undo. ${errorText(error)}`),
  });
  const busy = setChecked.isPending || undoCorrections.isPending;

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view moves.</p>
      </div>
    );
  }
  if (!canAdmin) {
    return <p className="py-8 text-center text-muted-foreground">Moves are for project admins.</p>;
  }

  const onSort = (column: Column) =>
    setSort((p) => (p.column === column ? { column, direction: p.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' }));
  const header = (label: string, column: Column) => (
    <TableHead>
      <SortableHeader label={label} column={column} sort={sort} onSort={onSort} />
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Moves</h1>
        <p className="text-sm text-gray-600 mt-1">Where the app saw cameras move, and what people corrected</p>
      </div>

      <div className="space-y-3">
        <FilterBar
          fields={fields}
          values={filterValues}
          onChange={(patch) => write({ ...filterValues, ...patch })}
          onClearAll={() => write({})}
          displayControls={[]}
          displayValues={{}}
          onDisplayChange={() => {}}
        />
        {isFiltered && items.length > 0 && (
          <p className="text-sm text-muted-foreground">{shown.length} of {items.length} rows</p>
        )}
      </div>

      {selected.size > 0 && (
        <BulkActionBar selected={selected.size} total={items.length} noun="rows" onClear={clear}>
          {toMarkRight.length > 0 && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setChecked.mutate({ rows: toMarkRight, checked: true })}>
              Mark {toMarkRight.length} right
            </Button>
          )}
          {toUncheck.length > 0 && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setChecked.mutate({ rows: toUncheck, checked: false })}>
              Undo {plural(toUncheck.length, 'check', 'checks')}
            </Button>
          )}
          {toUndo.length > 0 && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => setUndoOpen(true)}>
              Undo {plural(toUndo.length, 'correction', 'corrections')}
            </Button>
          )}
        </BulkActionBar>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-muted-foreground">Loading moves...</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">No moves yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <SelectAllCheckbox<string>
                        visibleIds={shown.map((it) => it.key)}
                        selected={selected}
                        onToggle={setMany}
                        ariaLabel="Select all visible rows"
                      />
                    </TableHead>
                    {header('Date', 'date')}
                    {header('Camera', 'camera')}
                    {header('Where', 'where')}
                    {header('Status', 'status')}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No moves match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {shown.map((it) => {
                    const status = updateStatus(it);
                    const who = decided(it);
                    return (
                      <TableRow
                        key={it.key}
                        className="cursor-pointer"
                        onClick={() => setOpened({ keys: shown.map((r) => r.key), start: it.key })}
                      >
                        <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${it.cameraLabel}, ${route(it)}`}
                            checked={selected.has(it.key)}
                            onChange={() => toggle(it.key)}
                            className="w-4 h-4 cursor-pointer accent-primary"
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {it.kind === 'moved' ? dayLabel(it.day) : dateLabel(it)}
                        </TableCell>
                        <TableCell className="font-medium">{it.cameraLabel}</TableCell>
                        <TableCell>{route(it)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col items-start gap-0.5">
                            <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusPill>
                            {who && (
                              <span className="text-xs text-muted-foreground">
                                {[who.by, dayLabel(who.day)].filter(Boolean).join(', ')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {opened && (
        <CheckMovesModal
          projectId={projectId}
          items={items}
          sites={sites ?? []}
          keys={opened.keys}
          startKey={opened.start}
          onClose={() => setOpened(null)}
        />
      )}

      <Dialog open={undoOpen} onOpenChange={(o) => !o && !undoCorrections.isPending && setUndoOpen(false)}>
        <DialogContent onClose={() => setUndoOpen(false)}>
          <DialogHeader>
            <DialogTitle>Undo {plural(toUndo.length, 'correction', 'corrections')}?</DialogTitle>
            <DialogDescription>
              For these days the app works out the site again, from the GPS or an earlier correction.
            </DialogDescription>
          </DialogHeader>
          <ImpactBox
            sections={[{
              heading: 'This will',
              bullets: [
                'move photos to the site their GPS points to, or to no site when they have no GPS',
                'bring back moves that a Wrong answer took away, unchecked',
              ],
            }]}
            rows={toUndo.map((it) => ({
              key: it.key,
              name: it.cameraLabel,
              detail: `${it.correction!.site_name}, ${dateLabel(it)}`,
            }))}
          />
          <ConfirmWordField word={UNDO_WORD} value={undoWord} onChange={setUndoWord} disabled={undoCorrections.isPending} />
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setUndoOpen(false)} disabled={undoCorrections.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={undoWord !== UNDO_WORD || undoCorrections.isPending}
              onClick={() => undoCorrections.mutate(toUndo)}
            >
              Undo {plural(toUndo.length, 'correction', 'corrections')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
