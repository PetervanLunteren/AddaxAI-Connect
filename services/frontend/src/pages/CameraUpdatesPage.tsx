/**
 * Camera updates: what the app noticed about where cameras stand. Project
 * admins only.
 *
 * A calm page: a line with how many updates are left to check and a Check
 * updates button, the map with the recent moves as arrows, and a read-only
 * log by week. The work happens in the check (CheckUpdatesModal), one update
 * at a time. A log line opens the check at that update.
 *
 * Everything comes from one list of the project's deployments, filtered in
 * the browser by the shared filter bar.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { deploymentsApi } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { CameraUpdatesLog } from '../components/deployments/CameraUpdatesLog';
import { CheckUpdatesModal } from '../components/deployments/CheckUpdatesModal';
import { DeploymentsMap, type MapArrow } from '../components/deployments/DeploymentsMap';
import {
  checkQueue, filterItems, metresLabel, placeName, updateItems, type UpdateFilters,
} from '../components/deployments/update-items';
import { Button } from '../components/ui/Button';
import { FilterBar, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';

const FILTER_SCHEMA: FilterSchema = {
  cameras: 'string[]',
  sites: 'string[]',
  date_from: 'date',
  date_to: 'date',
};

const MAP_HEIGHT = 380;

const idSet = (values: unknown): Set<number> | null =>
  Array.isArray(values) && values.length > 0 ? new Set(values.map(Number)) : null;

export const CameraUpdatesPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  // The open check and the update it starts at. Null = closed.
  const [check, setCheck] = useState<{ startKey: string | null } | null>(null);

  const [searchParams, setSearchParams] = usePersistedFilterParams('camera-updates', FILTER_SCHEMA);
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      cameras: (parsed.cameras as string[] | undefined)?.length ? (parsed.cameras as string[]) : undefined,
      sites: (parsed.sites as string[] | undefined)?.length ? (parsed.sites as string[]) : undefined,
      date_from: (parsed.date_from as string) || undefined,
      date_to: (parsed.date_to as string) || undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams],
  );
  const setFilters = (patch: Record<string, FilterValue | undefined>) =>
    setSearchParams(filtersToSearchParams({ ...filterValues, ...patch }, FILTER_SCHEMA), { replace: true });

  const { data: overview, isLoading } = useQuery({
    queryKey: ['deployments', projectId, 'overview'],
    queryFn: () => deploymentsApi.list(projectId!),
    enabled: projectId !== undefined,
  });
  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId!),
    enabled: projectId !== undefined,
  });

  const filters: UpdateFilters = {
    cameraIds: idSet(filterValues.cameras),
    siteIds: idSet(filterValues.sites),
    from: (filterValues.date_from as string | undefined) ?? null,
    to: (filterValues.date_to as string | undefined) ?? null,
  };
  const items = useMemo(
    () => filterItems(overview ? updateItems(overview) : [], filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, searchParams],
  );
  const toCheck = checkQueue(items).length;
  const needYou = items.filter((it) => it.needsYou).length;

  // The map: the sites of the updates in view stand out, the moves nobody
  // answered yet are arrows.
  const activeSiteIds = useMemo(
    () => new Set(
      items.flatMap((it) => [it.deployment?.site_id, it.previous?.site_id]).filter((id): id is number => id != null),
    ),
    [items],
  );
  const arrows: MapArrow[] = items.flatMap((it) => {
    const d = it.deployment, p = it.previous;
    if (it.kind !== 'moved' || it.answered || !d || !p || d.latitude === null || d.longitude === null ||
        p.latitude === null || p.longitude === null) return [];
    return [{
      key: it.key,
      from: [p.latitude, p.longitude] as [number, number],
      to: [d.latitude, d.longitude] as [number, number],
      warn: !!it.shortTrip,
      strong: true,
      label: `${it.cameraLabel}, ${placeName(p.site_name)} to ${placeName(d.site_name)}` +
        (it.distanceM !== undefined ? `, ${metresLabel(it.distanceM)}` : ''),
    }];
  });

  const cameraOptions = useMemo(() => {
    const labels = new Map<number, string>();
    for (const d of overview?.deployments ?? []) labels.set(d.camera_id, d.camera_label ?? `Camera ${d.camera_id}`);
    for (const u of overview?.unplaced ?? []) labels.set(u.camera_id, u.camera_label);
    return Array.from(labels.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
      .map(([id, label]) => ({ value: String(id), label }));
  }, [overview]);

  const filterFields: FilterFieldDef[] = [
    {
      kind: 'multi-select',
      key: 'cameras',
      label: 'Cameras',
      options: cameraOptions,
      placeholder: 'All cameras',
      summary: (n) => `${n} cameras`,
    },
    {
      kind: 'multi-select',
      key: 'sites',
      label: 'Sites',
      options: (sites ?? []).map((s) => ({ label: s.name, value: String(s.id) })),
      placeholder: 'All sites',
      summary: (n) => `${n} sites`,
    },
    { kind: 'date-range', fromKey: 'date_from', toKey: 'date_to', label: 'Date range' },
  ];

  // A click on a site shows only that site; a second click shows all again.
  const onSiteClick = (siteId: number) => {
    const only = filterValues.sites?.length === 1 && filterValues.sites[0] === String(siteId);
    setFilters({ sites: only ? undefined : [String(siteId)] });
  };

  let summary = 'Nothing to check.';
  if (toCheck > 0) {
    summary = `${toCheck} ${toCheck === 1 ? 'update' : 'updates'} to check`;
    if (needYou > 0) summary += `, ${needYou} ${needYou === 1 ? 'needs' : 'need'} you`;
    summary += '.';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Camera updates</h1>
        <p className="text-sm text-gray-600 mt-1">New cameras and moves the app noticed. Check them, and say so when one is wrong.</p>
      </div>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={setFilters}
        onClearAll={() => setFilters({ cameras: undefined, sites: undefined, date_from: undefined, date_to: undefined })}
      />

      {!projectId || isLoading || !overview ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
            <p className="flex-1 text-sm">{summary}</p>
            <Button onClick={() => setCheck({ startKey: null })} disabled={toCheck === 0}>
              <ListChecks className="h-4 w-4 mr-2" />
              Check updates
            </Button>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="lg:sticky lg:top-20 lg:self-start">
              <DeploymentsMap
                sites={sites ?? []}
                activeSiteIds={activeSiteIds}
                arrows={arrows}
                selected={null}
                readings={undefined}
                onSiteClick={onSiteClick}
                height={MAP_HEIGHT}
              />
            </div>
            <div className="min-w-0">
              <CameraUpdatesLog items={items} onOpen={(it) => setCheck({ startKey: it.key })} />
            </div>
          </div>
        </>
      )}

      {check && projectId !== undefined && (
        <CheckUpdatesModal
          projectId={projectId}
          items={items}
          sites={sites ?? []}
          startKey={check.startKey}
          onClose={() => setCheck(null)}
        />
      )}
    </div>
  );
};
