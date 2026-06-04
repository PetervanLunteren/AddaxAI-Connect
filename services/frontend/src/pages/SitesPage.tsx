/**
 * Sites page.
 *
 * Lists the project's sites (physical places that group camera deployments)
 * with their camera, deployment and image counts. Project admins can add,
 * rename, merge and delete sites. Clicking a site opens the SiteDetailSheet
 * with its deployments. Filter, sort and view-mode are URL-synced so links
 * and refreshes preserve state, same as CamerasPage.
 */
import React, { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin,
  Plus,
  Loader2,
  Map as MapIcon,
  Table as TableIcon,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/Dialog';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
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
import { sitesApi, type SiteListItem } from '../api/sites';
import { SitesMapView } from '../components/sites/SitesMapView';
import { SiteFormModal } from '../components/sites/SiteFormModal';
import { SiteMergePicker } from '../components/sites/SiteMergePicker';
import { SiteDetailSheet } from '../components/SiteDetailSheet';

type SortColumn = 'name' | 'cameras' | 'deployments' | 'images' | 'last_activity';

const FILTER_SCHEMA: FilterSchema = {
  search: 'string',
  habitat: 'string',
  tag: 'string',
  view_mode: 'string',
};

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

function fmtCoords(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '-';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';

function siteSortValue(site: SiteListItem, column: SortColumn): string | number | null {
  switch (column) {
    case 'name':
      return site.name.toLowerCase();
    case 'cameras':
      return site.camera_count;
    case 'deployments':
      return site.deployment_count;
    case 'images':
      return site.image_count;
    case 'last_activity':
      return site.last_activity ?? null;
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

export const SitesPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { selectedProject, isProjectAdmin, isServerAdmin } = useProject();
  const canEdit = isProjectAdmin || isServerAdmin;
  const toast = useToast();
  const queryClient = useQueryClient();

  // Filter and view-mode live in the URL so refreshing or sharing a link
  // preserves state. Same pattern as CamerasPage.
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedFilters = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const searchQuery = asString(parsedFilters.search);
  const habitatFilter = asString(parsedFilters.habitat);
  const tagFilter = asString(parsedFilters.tag);
  const viewMode = (parsedFilters.view_mode === 'map' ? 'map' : 'table') as
    | 'table'
    | 'map';

  // Local UI state
  const [detailSiteId, setDetailSiteId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [mergeSite, setMergeSite] = useState<{ id: number; name: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [deleteSite, setDeleteSite] = useState<{ id: number; name: string } | null>(null);

  // Sort state stays local, like cameras. Default Name asc.
  const [sort, setSort] = useState<{
    column: SortColumn | null;
    direction: 'asc' | 'desc';
  }>({ column: 'name', direction: 'asc' });

  const { data: sites, isLoading } = useQuery({
    queryKey: ['sites', pid],
    queryFn: () => sitesApi.list(pid),
    enabled: Number.isFinite(pid),
  });

  // Tag autocomplete + filter options, project-wide. Loads in parallel with the
  // sites list.
  const { data: tagSuggestions } = useQuery({
    queryKey: ['site-tags', pid],
    queryFn: () => sitesApi.getTags(pid),
    enabled: Number.isFinite(pid),
  });

  // Habitat options: distinct non-null habitat_type values across the project.
  const habitatOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sites ?? []) {
      if (s.habitat_type) set.add(s.habitat_type);
    }
    return Array.from(set).sort();
  }, [sites]);

  const filterValues: Record<string, FilterValue> = {
    search: searchQuery || undefined,
    habitat: habitatFilter || undefined,
    tag: tagFilter || undefined,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      view_mode: viewMode === 'table' ? undefined : viewMode,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), {
      replace: true,
    });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({ search: undefined, habitat: undefined, tag: undefined });
  const setViewMode = (m: 'table' | 'map') =>
    writeAll({ view_mode: m === 'table' ? undefined : m });

  const filterFields: FilterFieldDef[] = useMemo(
    () => [
      {
        kind: 'search',
        key: 'search',
        label: 'Search',
        placeholder: 'Name, habitat, tag...',
      },
      {
        kind: 'select',
        key: 'habitat',
        label: 'Habitat',
        options: habitatOptions.map((h) => ({ value: h, label: h })),
      },
      {
        kind: 'select',
        key: 'tag',
        label: 'Tag',
        options: (tagSuggestions ?? []).map((t) => ({ value: t, label: t })),
      },
    ],
    [habitatOptions, tagSuggestions],
  );

  // Filter then sort. Nulls last regardless of direction.
  const filteredSites = useMemo(() => {
    let result = sites ?? [];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.habitat_type ?? '').toLowerCase().includes(q) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (habitatFilter) {
      result = result.filter((s) => s.habitat_type === habitatFilter);
    }
    if (tagFilter) {
      result = result.filter((s) => (s.tags ?? []).includes(tagFilter));
    }
    return result;
  }, [sites, searchQuery, habitatFilter, tagFilter]);

  const sortedSites = useMemo(() => {
    if (!sort.column) return filteredSites;
    const dir = sort.direction === 'asc' ? 1 : -1;
    const col = sort.column;
    return [...filteredSites].sort((a, b) => {
      const av = siteSortValue(a, col);
      const bv = siteSortValue(b, col);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filteredSites, sort]);

  const handleSort = (column: SortColumn) =>
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sites', pid] });
    queryClient.invalidateQueries({ queryKey: ['site', pid] });
    queryClient.invalidateQueries({ queryKey: ['site-tags', pid] });
  };

  const mergeMutation = useMutation({
    mutationFn: () => sitesApi.merge(pid, mergeSite!.id, Number(mergeTargetId)),
    onSuccess: () => {
      invalidate();
      setMergeSite(null);
      setMergeTargetId('');
      setDetailSiteId(null);
      toast.success('Sites merged');
    },
    onError: (err) => toast.error(`Could not merge sites, ${errMsg(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => sitesApi.remove(pid, deleteSite!.id),
    onSuccess: () => {
      invalidate();
      setDeleteSite(null);
      setDetailSiteId(null);
      toast.success('Site deleted');
    },
    onError: (err) => toast.error(`Could not delete site, ${errMsg(err)}`),
  });

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view sites.</p>
      </div>
    );
  }

  const hasSites = !isLoading && sites && sites.length > 0;
  const isFiltered = !!(searchQuery || habitatFilter || tagFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-0">Sites</h1>
          <p className="text-sm text-gray-600 mt-1">
            Physical places where cameras are deployed. Each site groups the
            deployments at that location.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add site
          </Button>
        )}
      </div>

      {/* Filter bar (drives both table and map views) */}
      {hasSites && (
        <div className="space-y-3">
          <FilterBar
            fields={filterFields}
            values={filterValues}
            onChange={onFilterChange}
            onClearAll={onClearAll}
          />
          {isFiltered && (
            <p className="text-sm text-muted-foreground">
              {sortedSites.length} of {sites.length} sites
            </p>
          )}

          {/* Table / map switcher */}
          <div className="flex border-b">
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors',
                viewMode === 'table'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <TableIcon className="h-4 w-4" />
              Table
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors',
                viewMode === 'map'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <MapIcon className="h-4 w-4" />
              Map
            </button>
          </div>
        </div>
      )}

      {/* List / empty / loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading sites
        </div>
      ) : !sites || sites.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>
              No sites yet. Sites are created automatically as cameras report
              their location, or you can add one.
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'map' ? (
        <SitesMapView
          sites={sortedSites}
          onSiteClick={(id) => setDetailSiteId(id)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortableHeader
                      label="Name"
                      column="name"
                      sort={sort}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Cameras"
                      column="cameras"
                      align="right"
                      sort={sort}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Deployments"
                      column="deployments"
                      align="right"
                      sort={sort}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Images"
                      column="images"
                      align="right"
                      sort={sort}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead>
                    <SortableHeader
                      label="Last activity"
                      column="last_activity"
                      sort={sort}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead>Coordinates</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSites.map((site) => (
                  <TableRow
                    key={site.id}
                    className="cursor-pointer"
                    onClick={() => setDetailSiteId(site.id)}
                  >
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell className="text-right">{site.camera_count}</TableCell>
                    <TableCell className="text-right">{site.deployment_count}</TableCell>
                    <TableCell className="text-right">
                      {site.image_count.toLocaleString()}
                    </TableCell>
                    <TableCell>{fmtDate(site.last_activity)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {fmtCoords(site.latitude, site.longitude)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <SiteDetailSheet
        open={detailSiteId != null}
        onClose={() => setDetailSiteId(null)}
        projectId={pid}
        siteId={detailSiteId}
        canEdit={canEdit}
        onMergeRequested={(s) => {
          setMergeSite(s);
          setMergeTargetId('');
        }}
        onDeleteRequested={setDeleteSite}
      />

      <SiteFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projectId={pid}
        sites={sites ?? []}
      />

      {/* Merge dialog */}
      <Dialog open={mergeSite != null} onOpenChange={(o) => !o && setMergeSite(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Merge site</DialogTitle>
            <DialogDescription>
              Pick the site to keep. "{mergeSite?.name}" will be merged into it
              and then removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {mergeSite && (
            <SiteMergePicker
              sites={sites ?? []}
              sourceSiteId={mergeSite.id}
              selectedTargetId={mergeTargetId ? Number(mergeTargetId) : null}
              onSelectTarget={(id) => setMergeTargetId(String(id))}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeSite(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => mergeMutation.mutate()}
              disabled={mergeMutation.isPending || mergeTargetId === ''}
            >
              {mergeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteSite != null}
        onClose={() => setDeleteSite(null)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete site"
        body={
          <>
            Delete "{deleteSite?.name}"? Its deployments keep their data but lose
            the site link. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
      />
    </div>
  );
};
