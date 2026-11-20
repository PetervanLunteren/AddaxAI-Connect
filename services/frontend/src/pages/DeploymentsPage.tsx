/**
 * Deployments page: where every camera stood and when, what the app noticed,
 * and the place to correct it. Project admins only.
 *
 * Laid out like the other pages: title, the shared filter bar, then two tabs.
 * - To check: the review list (new cameras, moves, photos without a site)
 *   next to a map with the moves as arrows. Replaces the camera updates
 *   panel.
 * - History: the timeline of every deployment next to the map.
 * On both, a selected deployment shows its GPS on the map and a card that
 * says why it starts where it does, with Set deployment and the fixed
 * periods. A phone gets a list and a map as tabs.
 *
 * Change site and Set site put the map in pick mode: a click on a site, or
 * on an empty spot for a new site, opens the Set deployment form.
 *
 * Everything comes from one list of the project's deployments, filtered in
 * the browser.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Info, List, ListChecks, Map as MapIcon } from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { deploymentsApi, type DeploymentListItem } from '../api/deployments';
import { sitesApi } from '../api/sites';
import { DeploymentsTimeline } from '../components/deployments/DeploymentsTimeline';
import { DeploymentsMap, type MapArrow } from '../components/deployments/DeploymentsMap';
import { DeploymentDetailCard } from '../components/deployments/DeploymentDetailCard';
import { DeploymentsReview } from '../components/deployments/DeploymentsReview';
import { SetDeploymentDialog, type SetDeploymentPrefill } from '../components/deployments/SetDeploymentDialog';
import { buildRows, rowsDomain, today, type RowFilters, type RowMode } from '../components/deployments/deployment-rows';
import { filterItems, metresLabel, reviewItems, type ReviewItem } from '../components/deployments/review-items';
import { DeploymentJourney } from '../components/DeploymentJourney';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
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

// The open tab and deployment are part of the address, so a link shows them,
// but they are not filters: they are never remembered for the next visit.
const TAB_PARAM = 'tab';
const SELECTED_PARAM = 'deployment';

const MAP_HEIGHT = 420;

type Tab = 'check' | 'history';
type PhoneTab = 'list' | 'map';

// What the Set deployment form opens with, and for which camera.
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
  fromDate: d.start_date ?? today(),
  untilDate: d.end_date,
  lat: d.latitude,
  lon: d.longitude,
});

export const DeploymentsPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const wide = useMediaQuery('(min-width: 768px)');
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('list');
  const [showAll, setShowAll] = useState(false);
  const [picking, setPicking] = useState<ReviewItem | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const [searchParams, setSearchParams] = usePersistedFilterParams('deployments', FILTER_SCHEMA);
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const rowMode: RowMode = parsed.rows === 'site' ? 'site' : 'camera';
  const tab: Tab = searchParams.get(TAB_PARAM) === 'history' ? 'history' : 'check';
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

  const write = (filters: Record<string, FilterValue | undefined>, next: { tab?: Tab; selected?: number | null }) => {
    const params = filtersToSearchParams(
      { ...filterValues, rows: rowMode === 'camera' ? undefined : rowMode, ...filters },
      FILTER_SCHEMA,
    );
    const nextTab = next.tab ?? tab;
    const nextSelected = next.selected === undefined ? selectedId : next.selected;
    if (nextTab === 'history') params.set(TAB_PARAM, 'history');
    if (nextSelected !== null) params.set(SELECTED_PARAM, String(nextSelected));
    setSearchParams(params, { replace: true });
  };
  const setFilters = (patch: Record<string, FilterValue | undefined>) => write(patch, {});
  const select = (id: number | null) => write({}, { selected: id });

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

  const allItems = useMemo(() => (overview ? reviewItems(overview) : []), [overview]);
  const items = useMemo(
    () => filterItems(allItems, rowFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems, searchParams],
  );
  const toCheck = items.filter((it) => !it.checked).length;
  const listedItems = showAll ? items : items.filter((it) => !it.checked);

  // The map: on To check the sites and moves of the listed entries, on
  // History the sites of the bars in view. Every other site is faded.
  const activeSiteIds = useMemo(() => {
    const ids = tab === 'check'
      ? listedItems.flatMap((it) => [it.deployment?.site_id, it.previous?.site_id])
      : rows.flatMap((r) => r.lanes.flat().map((b) => b.deployment.site_id));
    return new Set(ids.filter((id): id is number => id != null));
  }, [tab, listedItems, rows]);
  const arrows: MapArrow[] = tab !== 'check' ? [] : listedItems.flatMap((it) => {
    const d = it.deployment, p = it.previous;
    if (it.kind !== 'moved' || !d || !p || d.latitude === null || d.longitude === null ||
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
  const displayControls: DisplayControlDef[] = tab === 'history' ? [
    {
      key: 'rows',
      label: 'Rows',
      options: [
        { value: 'camera', label: 'One per camera' },
        { value: 'site', label: 'One per site' },
      ],
    },
  ] : [];

  // Change site and Set site: the next click on the map picks the place.
  const startPicking = (it: ReviewItem) => {
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
      onSetDeployment={() => setEditing({
        cameraId: selected.camera_id,
        cameraName: selected.camera_label ?? `Camera ${selected.camera_id}`,
        prefill: prefillOf(selected, selected.site_id),
        newSite: false,
      })}
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

  const review = projectId !== undefined && (
    <DeploymentsReview
      projectId={projectId}
      items={items}
      showAll={showAll}
      onShowAll={setShowAll}
      selectedId={selectedId}
      onSelect={(it) => select(it?.deployment?.id ?? null)}
      onChangeSite={startPicking}
    />
  );
  const timeline = (
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
  );
  const phoneList = tab === 'check' ? review : rows.map((row) => (
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
  ));

  let content: React.ReactNode;
  if (!projectId || isLoading || !overview) {
    content = <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">Loading...</div>;
  } else if (tab === 'history' && rows.length === 0) {
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
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          {map}
          {card}
        </div>
        {tab === 'check' ? <div className="min-w-0">{review}</div> : timeline}
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
          phoneList
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Deployments</h1>
        <p className="text-sm text-gray-600 mt-1">Where each camera stood and when, what the app noticed, and why</p>
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
      <TabStrip<Tab>
        tabs={[
          { key: 'check', label: 'To check', icon: ListChecks, count: toCheck },
          { key: 'history', label: 'History', icon: History },
        ]}
        value={tab}
        onChange={(t) => {
          setPicking(null);
          write({}, { tab: t });
        }}
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
