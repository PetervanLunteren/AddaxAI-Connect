/**
 * Deployments page: where every camera stood and when, and why the app
 * thinks so. Project admins only, read only (changes go through the camera
 * panel).
 *
 * Laid out like the other pages: title, the shared filter bar, then the
 * content. On a wide screen the map and the details of the selected
 * deployment sit left, the timeline right. A tablet stacks them. A phone
 * gets a list and a map as tabs.
 *
 * Everything comes from one list of the project's deployments, filtered in
 * the browser. A selection loads that camera's GPS and the reason each of
 * its deployments starts where it does.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, List, Map as MapIcon } from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { deploymentsApi } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { DeploymentsTimeline } from '../components/deployments/DeploymentsTimeline';
import { DeploymentsMap } from '../components/deployments/DeploymentsMap';
import { DeploymentDetailCard } from '../components/deployments/DeploymentDetailCard';
import { buildRows, rowsDomain, type RowFilters, type RowMode } from '../components/deployments/deployment-rows';
import { DeploymentJourney } from '../components/DeploymentJourney';
import { FilterBar, type DisplayControlDef, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { TabStrip } from '../components/ui/TabStrip';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';
import { useMediaQuery } from '../hooks/useMediaQuery';

const FILTER_SCHEMA: FilterSchema = {
  cameras: 'string[]',
  sites: 'string[]',
  date_from: 'date',
  date_to: 'date',
  rows: 'string',
};

// The open deployment is part of the address, so a link shows it, but it is
// not a filter: it is never remembered for the next visit.
const SELECTED_PARAM = 'deployment';

const MAP_HEIGHT = 420;

type PhoneTab = 'list' | 'map';

const idSet = (values: unknown): Set<number> | null =>
  Array.isArray(values) && values.length > 0 ? new Set(values.map(Number)) : null;

export const DeploymentsPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const wide = useMediaQuery('(min-width: 768px)');
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('list');

  const [searchParams, setSearchParams] = usePersistedFilterParams('deployments', FILTER_SCHEMA);
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const rowMode: RowMode = parsed.rows === 'site' ? 'site' : 'camera';
  const selectedId = Number(searchParams.get(SELECTED_PARAM)) || null;

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

  const write = (filters: Record<string, FilterValue | undefined>, selected: number | null) => {
    const params = filtersToSearchParams(
      { ...filterValues, rows: rowMode === 'camera' ? undefined : rowMode, ...filters },
      FILTER_SCHEMA,
    );
    if (selected !== null) params.set(SELECTED_PARAM, String(selected));
    setSearchParams(params, { replace: true });
  };
  const setFilters = (patch: Record<string, FilterValue | undefined>) => write(patch, selectedId);
  const select = (id: number | null) => write({}, id);

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

  const selected = overview?.deployments.find((d) => d.id === selectedId) ?? null;
  const { data: readings } = useQuery({
    queryKey: ['deployments', projectId, 'readings', selected?.camera_id],
    queryFn: () => deploymentsApi.readings(projectId!, selected!.camera_id),
    enabled: projectId !== undefined && selected !== null,
  });
  const { data: fixedPeriods } = useQuery({
    queryKey: ['fixed-periods', selected?.camera_id],
    queryFn: () => deploymentsApi.fixedPeriods(projectId!, selected!.camera_id),
    enabled: projectId !== undefined && selected !== null,
  });

  const rowFilters: RowFilters = {
    cameraIds: idSet(filterValues.cameras),
    siteIds: idSet(filterValues.sites),
    from: (filterValues.date_from as string | undefined) ?? null,
    to: (filterValues.date_to as string | undefined) ?? null,
  };
  const rows = useMemo(
    () => (overview ? buildRows(overview, rowMode, rowFilters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, rowMode, searchParams],
  );
  const domain = rowsDomain(rows, rowFilters);

  // The map shows the sites of the bars in view.
  const mapSites = useMemo(() => {
    const inView = new Set(rows.flatMap((r) => r.lanes.flat().map((b) => b.deployment.site_id)));
    return (sites ?? []).filter((s) => inView.has(s.id));
  }, [rows, sites]);

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
  const displayControls: DisplayControlDef[] = [
    {
      key: 'rows',
      label: 'Rows',
      options: [
        { value: 'camera', label: 'One per camera' },
        { value: 'site', label: 'One per site' },
      ],
    },
  ];

  // A click on a site shows only that site; a second click shows all again.
  const onSiteClick = (siteId: number) => {
    const only = filterValues.sites?.length === 1 && filterValues.sites[0] === String(siteId);
    setFilters({ sites: only ? undefined : [String(siteId)] });
  };

  const card = selected && projectId !== undefined && (
    <DeploymentDetailCard
      projectId={projectId}
      deployment={selected}
      start={readings?.starts.find((s) => s.deployment_id === selected.id)}
      thresholdM={readings?.threshold_m}
      fixedPeriods={fixedPeriods}
      onClose={() => select(null)}
    />
  );
  const map = (
    <DeploymentsMap
      sites={mapSites}
      selected={selected}
      readings={readings}
      onSiteClick={onSiteClick}
      height={MAP_HEIGHT}
    />
  );

  let content: React.ReactNode;
  if (!projectId || isLoading || !overview) {
    content = <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">Loading...</div>;
  } else if (rows.length === 0) {
    content = (
      <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
        {overview.deployments.length === 0 && overview.unplaced.length === 0
          ? 'No deployments yet. They appear when cameras send photos.'
          : 'No deployments match the current filters.'}
      </div>
    );
  } else if (wide) {
    content = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {map}
          {card}
        </div>
        <div className="rounded-lg border bg-card p-4 min-w-0">
          <DeploymentsTimeline
            rows={rows}
            from={domain.from}
            to={domain.to}
            selectedId={selectedId}
            onSelect={(bar) => select(bar.id === selectedId ? null : bar.id)}
            onZoom={(from, to) => setFilters({ date_from: from, date_to: to })}
          />
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>A bar is a deployment, its dark foot the days with photos</span>
            <span aria-hidden="true">·</span>
            <span>An outline is a fixed period</span>
            <span aria-hidden="true">·</span>
            <span>Orange is photos without a site</span>
            <span aria-hidden="true">·</span>
            <span>Click a bar for details, drag to zoom in</span>
          </div>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="space-y-4">
        <TabStrip<PhoneTab>
          tabs={[
            { key: 'list', label: 'List', icon: List },
            { key: 'map', label: 'Map', icon: MapIcon },
          ]}
          value={phoneTab}
          onChange={setPhoneTab}
        />
        {phoneTab === 'map' ? (
          <div className="space-y-4">
            {map}
            {card}
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="space-y-2">
              <h2 className="text-sm font-semibold">{row.label}</h2>
              {row.unplaced.length > 0 && (
                <p className="text-xs text-muted-foreground">Some photos of this camera have no site yet.</p>
              )}
              <DeploymentJourney
                mode={rowMode}
                items={row.lanes.flat().map((b) => ({
                  id: b.id,
                  title: b.label,
                  startDate: b.start,
                  endDate: b.open ? null : b.end,
                  imageCount: b.deployment.image_count,
                }))}
                emptyText="No deployments."
                onSelect={(item) => {
                  select(item.id);
                  setPhoneTab('map');
                }}
              />
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Deployments</h1>
        <p className="text-sm text-gray-600 mt-1">Where each camera stood and when, and why the app thinks so</p>
      </div>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={setFilters}
        onClearAll={() => setFilters({ cameras: undefined, sites: undefined, date_from: undefined, date_to: undefined })}
        displayControls={displayControls}
        displayValues={{ rows: rowMode }}
        onDisplayChange={(key, value) => setFilters({ [key]: value === 'camera' ? undefined : value })}
      />
      {content}
    </div>
  );
};
