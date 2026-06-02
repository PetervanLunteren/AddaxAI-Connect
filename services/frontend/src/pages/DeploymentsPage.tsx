/**
 * Deployments page.
 *
 * One flat, filterable, sortable list of every deployment in the project. A
 * deployment is one camera at one site for a time range, auto-created by GPS
 * ingestion. This is the canonical place to find and fix where photos landed:
 * reassign a single deployment via the assign-site modal, or select several and
 * move them all to one site at once. The camera and site slideouts show the same
 * deployments read-only and link back here. Filter and sort are URL-synced so a
 * link or refresh keeps state, same pattern as CamerasPage and SitesPage.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  CalendarClock,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MapPin,
  X,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import {
  FilterBar,
  type FilterFieldDef,
  type FilterValue,
} from '../components/ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../lib/filter-url';
import { useProject } from '../contexts/ProjectContext';
import { useToast } from '../components/ui/Toaster';
import { cn } from '../lib/utils';
import { deploymentsApi, type DeploymentListItem } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { DeploymentEditModal } from '../components/DeploymentEditModal';

type SortColumn = 'camera' | 'site' | 'start' | 'end' | 'images';

const FILTER_SCHEMA: FilterSchema = {
  search: 'string',
  site: 'string',
  camera: 'string',
  source: 'string',
};

// Special site-filter value: deployments with no site assigned.
const UNASSIGNED = '__none__';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const asString = (v: FilterValue): string => (typeof v === 'string' ? v : '');

function depSortValue(d: DeploymentListItem, column: SortColumn): string | number | null {
  switch (column) {
    case 'camera':
      return (d.camera_label ?? '').toLowerCase();
    case 'site':
      return (d.site_name ?? '').toLowerCase();
    case 'start':
      return d.start_date ?? null;
    case 'end':
      return d.end_date ?? null;
    case 'images':
      return d.image_count;
  }
}

const SortableHeader: React.FC<{
  label: string;
  column: SortColumn;
  align?: 'left' | 'right';
  sort: { column: SortColumn | null; direction: 'asc' | 'desc' };
  onSort: (column: SortColumn) => void;
}> = ({ label, column, align, sort, onSort }) => {
  const isActive = sort.column === column;
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 hover:text-foreground transition-colors -my-1',
        align === 'right' ? 'ml-auto' : '',
      )}
      onClick={() => onSort(column)}
    >
      {label}
      {isActive ? (
        sort.direction === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
      )}
    </button>
  );
};

const SourceBadge: React.FC<{ source: string }> = ({ source }) => {
  const manual = source === 'manual';
  return (
    <span
      className={cn(
        'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
        manual
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {manual ? 'Manual' : 'Auto'}
    </span>
  );
};

export const DeploymentsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { selectedProject, isProjectAdmin, isServerAdmin } = useProject();
  const canEdit = isProjectAdmin || isServerAdmin;
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const searchQuery = asString(parsed.search);
  const siteFilter = asString(parsed.site);
  const cameraFilter = asString(parsed.camera);
  const sourceFilter = asString(parsed.source);

  const [sort, setSort] = useState<{
    column: SortColumn | null;
    direction: 'asc' | 'desc';
  }>({ column: 'start', direction: 'desc' });

  const [editDep, setEditDep] = useState<DeploymentListItem | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkChoice, setBulkChoice] = useState('');
  const selectAllRef = useRef<HTMLInputElement>(null);

  const { data: deployments, isLoading } = useQuery({
    queryKey: ['deployments', pid],
    queryFn: () => deploymentsApi.list(pid),
    enabled: Number.isFinite(pid),
  });

  const { data: sites } = useQuery({
    queryKey: ['sites', pid],
    queryFn: () => sitesApi.list(pid),
    enabled: Number.isFinite(pid),
  });

  // Camera options come from the deployment rows themselves, so the dropdown
  // only lists cameras that actually have a deployment.
  const cameraOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deployments ?? []) {
      if (d.camera_label) set.add(d.camera_label);
    }
    return Array.from(set).sort();
  }, [deployments]);

  const filterValues: Record<string, FilterValue> = {
    search: searchQuery || undefined,
    site: siteFilter || undefined,
    camera: cameraFilter || undefined,
    source: sourceFilter || undefined,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged = { ...filterValues, ...next };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), { replace: true });
  };
  const onClearAll = () =>
    writeAll({ search: undefined, site: undefined, camera: undefined, source: undefined });

  const filterFields: FilterFieldDef[] = useMemo(
    () => [
      {
        kind: 'search',
        key: 'search',
        label: 'Search',
        placeholder: 'Camera or site...',
      },
      {
        kind: 'select',
        key: 'site',
        label: 'Site',
        options: [
          { value: UNASSIGNED, label: 'Unassigned' },
          ...(sites ?? []).map((s) => ({ value: String(s.id), label: s.name })),
        ],
      },
      {
        kind: 'select',
        key: 'camera',
        label: 'Camera',
        options: cameraOptions.map((c) => ({ value: c, label: c })),
      },
      {
        kind: 'select',
        key: 'source',
        label: 'Site source',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'manual', label: 'Manual' },
        ],
      },
    ],
    [sites, cameraOptions],
  );

  const filtered = useMemo(() => {
    let result = deployments ?? [];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          (d.camera_label ?? '').toLowerCase().includes(q) ||
          (d.site_name ?? '').toLowerCase().includes(q),
      );
    }
    if (siteFilter) {
      result =
        siteFilter === UNASSIGNED
          ? result.filter((d) => d.site_id == null)
          : result.filter((d) => String(d.site_id) === siteFilter);
    }
    if (cameraFilter) {
      result = result.filter((d) => d.camera_label === cameraFilter);
    }
    if (sourceFilter) {
      result = result.filter((d) => d.site_source === sourceFilter);
    }
    return result;
  }, [deployments, searchQuery, siteFilter, cameraFilter, sourceFilter]);

  const sorted = useMemo(() => {
    if (!sort.column) return filtered;
    const dir = sort.direction === 'asc' ? 1 : -1;
    const col = sort.column;
    return [...filtered].sort((a, b) => {
      const av = depSortValue(a, col);
      const bv = depSortValue(b, col);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sort]);

  const handleSort = (column: SortColumn) =>
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    );

  // Selection works on the currently visible (filtered + sorted) rows.
  const visibleIds = useMemo(() => sorted.map((d) => d.id), [sorted]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someVisibleSelected =
    selectedVisible.length > 0 && !allVisibleSelected;

  if (selectAllRef.current) {
    selectAllRef.current.indeterminate = someVisibleSelected;
  }

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['deployments', pid] });
    queryClient.invalidateQueries({ queryKey: ['sites', pid] });
    queryClient.invalidateQueries({ queryKey: ['site', pid] });
    queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
  };

  const bulkMutation = useMutation({
    mutationFn: () => {
      const siteId = bulkChoice === UNASSIGNED ? null : Number(bulkChoice);
      return deploymentsApi.bulkAssignSite(pid, Array.from(selected), siteId);
    },
    onSuccess: (res) => {
      invalidate();
      clearSelection();
      setBulkChoice('');
      toast.success(`${res.updated} deployment${res.updated === 1 ? '' : 's'} updated`);
    },
    onError: (err) => toast.error(`Could not reassign, ${errMsg(err)}`),
  });

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">
          Please select a project to view deployments.
        </p>
      </div>
    );
  }

  const isFiltered = !!(searchQuery || siteFilter || cameraFilter || sourceFilter);
  const total = deployments?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-0">Deployments</h1>
        <p className="text-sm text-gray-600 mt-1">
          Each deployment is one camera at one site for a time range. The site is
          set automatically from the GPS in the photos. Fix where photos landed by
          reassigning a deployment to the right site.
        </p>
      </div>

      {/* Filters */}
      {total > 0 && (
        <div className="flex items-end gap-3">
          <FilterBar
            fields={filterFields}
            values={filterValues}
            onChange={(patch) => writeAll(patch)}
            onClearAll={onClearAll}
          />
          {isFiltered && (
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {sorted.length} of {total} deployments
            </span>
          )}
        </div>
      )}

      {/* List / empty / loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading deployments
        </div>
      ) : total === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>
              No deployments yet. They are created automatically as cameras report
              photos with a location.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-10">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label="Select all"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        className="w-4 h-4 rounded border-border accent-primary cursor-pointer align-middle"
                      />
                    </TableHead>
                  )}
                  <TableHead>
                    <SortableHeader label="Camera" column="camera" sort={sort} onSort={handleSort} />
                  </TableHead>
                  <TableHead>
                    <SortableHeader label="Site" column="site" sort={sort} onSort={handleSort} />
                  </TableHead>
                  <TableHead>
                    <SortableHeader label="Start" column="start" sort={sort} onSort={handleSort} />
                  </TableHead>
                  <TableHead>
                    <SortableHeader label="End" column="end" sort={sort} onSort={handleSort} />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader label="Images" column="images" align="right" sort={sort} onSort={handleSort} />
                  </TableHead>
                  <TableHead>Site source</TableHead>
                  {canEdit && <TableHead className="w-px" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((d) => (
                  <TableRow key={d.id}>
                    {canEdit && (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select deployment ${d.deployment_number}`}
                          checked={selected.has(d.id)}
                          onChange={() => toggleOne(d.id)}
                          className="w-4 h-4 rounded border-border accent-primary cursor-pointer align-middle"
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{d.camera_label ?? '-'}</TableCell>
                    <TableCell>
                      {d.site_name ?? (
                        <span className="text-muted-foreground italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(d.start_date)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(d.end_date)}</TableCell>
                    <TableCell className="text-right">{d.image_count.toLocaleString()}</TableCell>
                    <TableCell>
                      <SourceBadge source={d.site_source} />
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditDep(d)}
                        >
                          <MapPin className="h-4 w-4 mr-1.5" />
                          Assign site
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Bulk reassign bar. Appears when rows are selected. */}
      {canEdit && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-lg border bg-card shadow-lg px-4 py-3">
          <span className="text-sm font-medium whitespace-nowrap">
            {selected.size} selected
          </span>
          <select
            value={bulkChoice}
            onChange={(e) => setBulkChoice(e.target.value)}
            disabled={bulkMutation.isPending}
            className="px-3 py-2 border rounded-md text-sm disabled:bg-muted"
          >
            <option value="">Assign to site...</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            onClick={() => bulkMutation.mutate()}
            disabled={bulkChoice === '' || bulkMutation.isPending}
          >
            {bulkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply
          </Button>
          <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Clear selection">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {editDep && (
        <DeploymentEditModal
          open={editDep != null}
          onClose={() => setEditDep(null)}
          projectId={pid}
          deploymentId={editDep.id}
          cameraName={editDep.camera_label ?? 'camera'}
          siteName={editDep.site_name}
          initialSiteId={editDep.site_id}
          deploymentLat={editDep.latitude}
          deploymentLon={editDep.longitude}
          invalidateKeys={[['deployments', pid]]}
        />
      )}
    </div>
  );
};
