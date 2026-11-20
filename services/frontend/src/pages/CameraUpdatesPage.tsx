/**
 * Camera updates: what the app noticed about where cameras stand, and the
 * place to say when it got it wrong. Project admins only.
 *
 * Laid out like the other pages: title, the shared filter bar, then a map
 * next to the list. The map shows the sites and the moves as arrows. A
 * selected update shows that camera's GPS on the map and a small card with
 * the reason. A phone gets the list and the map as tabs.
 *
 * "It stands at another site" and Set site put the map in pick mode: a
 * click on a site, or on an empty spot for a new site, opens the Set site
 * form.
 *
 * Everything comes from one list of the project's deployments, filtered in
 * the browser.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { List, Map as MapIcon } from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { deploymentsApi, type DeploymentListItem } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { DeploymentsMap, type MapArrow } from '../components/deployments/DeploymentsMap';
import { DeploymentDetailCard } from '../components/deployments/DeploymentDetailCard';
import { CameraUpdatesList } from '../components/deployments/CameraUpdatesList';
import { SetDeploymentDialog, type SetDeploymentPrefill } from '../components/deployments/SetDeploymentDialog';
import { filterItems, metresLabel, updateItems, type UpdateFilters, type UpdateItem } from '../components/deployments/update-items';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { FilterBar, type FilterFieldDef, type FilterValue } from '../components/ui/FilterBar';
import { TabStrip } from '../components/ui/TabStrip';
import { usePersistedFilterParams } from '../lib/use-persisted-filter-params';
import { filtersFromSearchParams, filtersToSearchParams, type FilterSchema } from '../lib/filter-url';
import { useMediaQuery } from '../hooks/useMediaQuery';

const FILTER_SCHEMA: FilterSchema = {
  cameras: 'string[]',
  sites: 'string[]',
  date_from: 'date',
  date_to: 'date',
};

// The selected update is part of the address, so a link shows it, but it is
// not a filter: it is never remembered for the next visit.
const SELECTED_PARAM = 'deployment';

const MAP_HEIGHT = 420;

type PhoneTab = 'list' | 'map';

// What the Set site form opens with, and for which camera.
interface Editing {
  cameraId: number;
  cameraName: string;
  prefill: SetDeploymentPrefill;
  newSite: boolean;
}

const idSet = (values: unknown): Set<number> | null =>
  Array.isArray(values) && values.length > 0 ? new Set(values.map(Number)) : null;

const prefillOf = (d: DeploymentListItem, siteId: number | null): SetDeploymentPrefill => ({
  siteId,
  fromDate: d.start_date ?? d.start_at.slice(0, 10),
  untilDate: d.end_date,
  lat: d.latitude,
  lon: d.longitude,
});

export const CameraUpdatesPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const wide = useMediaQuery('(min-width: 768px)');
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('list');
  const [picking, setPicking] = useState<UpdateItem | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const [searchParams, setSearchParams] = usePersistedFilterParams('camera-updates', FILTER_SCHEMA);
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
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
    const params = filtersToSearchParams({ ...filterValues, ...filters }, FILTER_SCHEMA);
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

  // The map: the sites of the updates in the list stand out, every other
  // site is faded. Moves nobody answered yet are drawn as arrows.
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
      strong: selectedId === null || selectedId === d.id,
      label: `${it.cameraLabel}, ${p.site_name} to ${d.site_name}${it.distanceM !== undefined ? `, ${metresLabel(it.distanceM)}` : ''}`,
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
  // Another site, or Set site: the next click on the map picks the place.
  const startPicking = (it: UpdateItem) => {
    setPicking(it);
    if (!wide) setPhoneTab('map');
  };
  const pickedPlace = (siteId: number | null, lat: number | null, lon: number | null) => {
    const it = picking!;
    setPicking(null);
    const prefill: SetDeploymentPrefill = it.deployment
      ? { ...prefillOf(it.deployment, siteId), ...(siteId === null ? { lat, lon } : {}) }
      : { siteId, fromDate: it.unplaced!.photo_days[0].start, untilDate: null, lat, lon };
    setEditing({ cameraId: it.cameraId, cameraName: it.cameraLabel, prefill, newSite: siteId === null });
  };
  // A click on a site picks it in pick mode, otherwise it filters to it (a
  // second click shows all again).
  const onSiteClick = (siteId: number) => {
    if (picking) return pickedPlace(siteId, null, null);
    const only = filterValues.sites?.length === 1 && filterValues.sites[0] === String(siteId);
    setFilters({ sites: only ? undefined : [String(siteId)] });
  };

  const card = selected && projectId !== undefined && (
    <DeploymentDetailCard
      projectId={projectId}
      deployment={selected}
      start={readings?.starts.find((s) => s.deployment_id === selected.id)}
      thresholdM={readings?.threshold_m}
      onClose={() => select(null)}
    />
  );
  const map = (
    <div className="space-y-2">
      {picking && (
        <Callout
          variant="info"
          action={<Button size="sm" variant="outline" onClick={() => setPicking(null)}>Cancel</Button>}
        >
          Where did camera {picking.cameraLabel} stand? Click its site on the map, or an empty spot to make a new site there.
        </Callout>
      )}
      <DeploymentsMap
        sites={sites ?? []}
        activeSiteIds={picking ? null : activeSiteIds}
        arrows={picking ? [] : arrows}
        selected={picking ? null : selected}
        readings={readings}
        onSiteClick={onSiteClick}
        onSpotClick={picking ? (lat, lon) => pickedPlace(null, lat, lon) : undefined}
        height={MAP_HEIGHT}
      />
    </div>
  );

  const list = projectId !== undefined && (
    <CameraUpdatesList
      projectId={projectId}
      items={items}
      selectedId={selectedId}
      onSelect={(it) => select(it?.deployment?.id ?? null)}
      onOtherSite={startPicking}
    />
  );

  let content: React.ReactNode;
  if (!projectId || isLoading || !overview) {
    content = <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">Loading...</div>;
  } else if (wide) {
    content = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          {map}
          {card}
        </div>
        <div className="min-w-0">{list}</div>
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
          list
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Camera updates</h1>
        <p className="text-sm text-gray-600 mt-1">New cameras and moves the app noticed. Say so when it got one wrong.</p>
      </div>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={setFilters}
        onClearAll={() => setFilters({ cameras: undefined, sites: undefined, date_from: undefined, date_to: undefined })}
      />
      {content}
      {editing && projectId !== undefined && (
        <SetDeploymentDialog
          projectId={projectId}
          cameraId={editing.cameraId}
          cameraName={editing.cameraName}
          prefill={editing.prefill}
          newSite={editing.newSite}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};
