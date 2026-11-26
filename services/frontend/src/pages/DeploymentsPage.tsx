/**
 * Deployments: every camera at a site for a period, one row each, with the
 * same facts as the deployment card. Project admins only, under Admin
 * tools: the app is automatic first, so this is an overview for
 * administration and history, not a to-do list.
 *
 * A move is not a row of its own but how a deployment started: the Moved
 * from column (rows.ts). Status is quiet: only Suspicious (the app doubts
 * the deployment) and Corrected (a person set it) show a pill. To do and
 * the card's Suspicious line link here with the right filter or window.
 *
 * A row click opens the deployment's window (DeploymentWindow): the map,
 * the photos and the card with Edit. Only a suspicious deployment asks a
 * question there. No checkboxes and no bulk actions: nothing here has to
 * be answered, so there is nothing to answer in bulk. It opens newest
 * first, and stays in that order while you work, so rows do not jump; a
 * header sorts.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { deploymentsApi } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { DeploymentStatus } from '../components/deployments/DeploymentStatus';
import { DeploymentWindow } from '../components/deployments/DeploymentWindow';
import { dayLabel, deploymentRows, metresLabel, type DeploymentRow } from '../components/deployments/rows';
import { UnnamedSiteChip } from '../components/sites/UnnamedSiteChip';
import { Card, CardContent } from '../components/ui/Card';
import { FilterBar, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { SortableHeader, type SortState } from '../components/ui/SortableHeader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useProject } from '../contexts/ProjectContext';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';
import { DEPLOYMENT_WINDOW_PARAM, useOpenPanelFromLink } from '../lib/panel-links';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';

type Column = 'camera' | 'site' | 'first' | 'last' | 'photos' | 'from' | 'status';

const FILTER_SCHEMA: FilterSchema = {
  camera: 'string',
  site: 'string',
  status: 'string',
  moved: 'string',
  from: 'date',
  to: 'date',
};

const asString = (v: FilterValue): string => (typeof v === 'string' ? v : '');

const STATUS_OPTIONS = [
  { value: 'suspicious', label: 'Suspicious' },
  { value: 'corrected', label: 'Corrected' },
];
const MOVED_OPTIONS = [
  { value: 'yes', label: 'From another site' },
  { value: 'no', label: 'Did not move' },
];

const statusOrder = (row: DeploymentRow) => (row.suspicious ? 0 : row.corrected ? 1 : 2);

// Null sorts last either way: one that did not move has no Moved from. An
// open deployment (no end) sorts as the latest last day: "now".
const SORT: Record<Column, (row: DeploymentRow) => string | number | null> = {
  camera: (row) => row.deployment.camera_label ?? '',
  site: (row) => row.deployment.site_name ?? '',
  first: (row) => row.deployment.start_at,
  last: (row) => row.deployment.end_at ?? '9999',
  photos: (row) => row.deployment.image_count,
  from: (row) => row.previous?.site_name ?? null,
  status: statusOrder,
};

const cameraLabel = (row: DeploymentRow) => row.deployment.camera_label ?? `Camera ${row.deployment.camera_id}`;

/** One line of text, cut with "…" at the column's width, the whole text on hover. */
const Clip: React.FC<{ text: string }> = ({ text }) => (
  <span className="block truncate" title={text}>{text}</span>
);

// A site in a cell: its name, cut to fit, and the Unnamed marker of the
// Sites page while it still has its automatic name.
const SiteCell: React.FC<{ name: string | null }> = ({ name }) =>
  name === null ? <span className="text-muted-foreground">No site</span> : (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate" title={name}>{name}</span>
      <span className="shrink-0"><UnnamedSiteChip name={name} /></span>
    </span>
  );

// A fixed layout: the short columns get a set width, the three text
// columns (camera, site, moved from; undefined here) share the rest, and
// long text is cut to fit. Every row is one line. Below the minimum width
// the table scrolls sideways instead.
const COLUMN_WIDTHS = [undefined, undefined, '8.5rem', '8.5rem', '5.5rem', undefined, '8rem'];

export const DeploymentsPage: React.FC = () => {
  const { selectedProject, canAdminCurrentProject: canAdmin } = useProject();
  const projectId = selectedProject?.id ?? 0;

  const [searchParams, setSearchParams] = usePersistedFilterParams('deployments', FILTER_SCHEMA);
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
  const rows = useMemo(
    () => (deployments ? deploymentRows(deployments, corrections) : []),
    [deployments, corrections],
  );

  const [sort, setSort] = useState<SortState<Column>>({ column: 'first', direction: 'desc' });
  const [opened, setOpened] = useState<{ keys: string[]; start: string } | null>(null);

  // Filter options come from the rows, so each one can match.
  const options = useMemo(() => {
    const cameras = new Map<string, string>();
    const siteNames = new Map<string, string>();
    for (const row of rows) {
      cameras.set(String(row.deployment.camera_id), cameraLabel(row));
      for (const d of [row.deployment, row.previous]) {
        if (d?.site_id != null) siteNames.set(String(d.site_id), d.site_name ?? '');
      }
    }
    const sorted = (m: Map<string, string>) =>
      [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
    return { cameras: sorted(cameras), sites: sorted(siteNames) };
  }, [rows]);

  const fields: FilterFieldDef[] = [
    { kind: 'select', key: 'camera', label: 'Camera', options: options.cameras, primary: true },
    { kind: 'select', key: 'site', label: 'Site', options: options.sites, primary: true },
    { kind: 'select', key: 'status', label: 'Status', options: STATUS_OPTIONS, primary: true },
    { kind: 'date-range', fromKey: 'from', toKey: 'to', label: 'Date', primary: true },
    { kind: 'select', key: 'moved', label: 'Moved', options: MOVED_OPTIONS, primary: false },
  ];

  const shown = useMemo(() => {
    const matches = rows.filter(({ deployment: d, previous, suspicious, corrected }) =>
      (!f.camera || String(d.camera_id) === f.camera) &&
      // A site matches where the camera stood and where it came from.
      (!f.site || String(d.site_id) === f.site || String(previous?.site_id) === f.site) &&
      (!f.status || (f.status === 'suspicious' ? suspicious : corrected)) &&
      (!f.moved || (f.moved === 'yes') === !!previous) &&
      // Days in the range: the deployment's period overlaps it.
      (!f.to || (d.start_date !== null && d.start_date <= f.to)) &&
      (!f.from || d.end_date === null || d.end_date >= f.from));
    const value = SORT[sort.column ?? 'first'];
    const sign = sort.direction === 'asc' ? 1 : -1;
    const compare = (va: string | number | null, vb: string | number | null) => {
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      if (typeof va === 'number' && typeof vb === 'number') return sign * (va - vb);
      return sign * String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
    };
    // Ties go by camera, then by key, so equal rows never swap places when
    // the list reloads after an answer.
    return [...matches].sort((a, b) =>
      compare(value(a), value(b)) || cameraLabel(a).localeCompare(cameraLabel(b)) || a.key.localeCompare(b.key));
  }, [rows, f.camera, f.site, f.status, f.moved, f.from, f.to, sort]);
  const isFiltered = Object.values(f).some(Boolean);

  // Open one deployment's window straight from a link (deploymentWindowHref),
  // the Suspicious line of a card. It steps through the rows as shown when
  // the deployment is among them.
  useOpenPanelFromLink(DEPLOYMENT_WINDOW_PARAM, searchParams, setSearchParams, !!deployments, (id) => {
    const row = rows.find((r) => r.deployment.id === id);
    if (!row) return;
    const keys = shown.map((r) => r.key);
    setOpened({ keys: keys.includes(row.key) ? keys : [row.key], start: row.key });
  });

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view deployments.</p>
      </div>
    );
  }
  if (!canAdmin) {
    return <p className="py-8 text-center text-muted-foreground">Deployments are for project admins.</p>;
  }

  const onSort = (column: Column) =>
    setSort((p) => (p.column === column ? { column, direction: p.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' }));
  const header = (label: string, column: Column, className = '') => (
    <TableHead className={`whitespace-nowrap ${className}`}>
      <SortableHeader label={label} column={column} sort={sort} onSort={onSort} />
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Deployments</h1>
        <p className="text-sm text-gray-600 mt-1">Every camera at a site for a period</p>
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
        {isFiltered && rows.length > 0 && (
          <p className="text-sm text-muted-foreground">{shown.length} of {rows.length} deployments</p>
        )}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-muted-foreground">Loading deployments...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">No deployments yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="table-fixed min-w-[60rem]">
                <colgroup>
                  {COLUMN_WIDTHS.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    {header('Camera', 'camera')}
                    {header('Site', 'site')}
                    {header('First day', 'first')}
                    {header('Last day', 'last')}
                    {header('Photos', 'photos')}
                    {header('Moved from', 'from')}
                    {header('Status', 'status')}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No deployments match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {shown.map((row) => {
                    const d = row.deployment;
                    return (
                      <TableRow
                        key={row.key}
                        className="cursor-pointer"
                        onClick={() => setOpened({ keys: shown.map((r) => r.key), start: row.key })}
                      >
                        <TableCell className="font-medium"><Clip text={cameraLabel(row)} /></TableCell>
                        <TableCell><SiteCell name={d.site_name} /></TableCell>
                        <TableCell className="whitespace-nowrap">{d.start_date ? dayLabel(d.start_date) : '-'}</TableCell>
                        <TableCell className="whitespace-nowrap">{d.end_date ? dayLabel(d.end_date) : 'now'}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{d.image_count.toLocaleString()}</TableCell>
                        <TableCell>
                          {row.previous && (
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0"><SiteCell name={row.previous.site_name} /></span>
                              {row.distanceM !== undefined && (
                                <span className="shrink-0 text-muted-foreground tabular-nums">{metresLabel(row.distanceM)}</span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <DeploymentStatus row={row} />
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
        <DeploymentWindow
          projectId={projectId}
          rows={rows}
          sites={sites ?? []}
          keys={opened.keys}
          startKey={opened.start}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
};
