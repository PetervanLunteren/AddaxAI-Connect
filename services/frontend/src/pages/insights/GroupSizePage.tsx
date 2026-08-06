/**
 * Group size per species.
 *
 * Group size is the MaxN of an independent event: the most individuals seen in
 * a single image within that event. The independence filter already computes
 * it; the maths runs server-side and this page is purely presentational.
 *
 * Counts come from two places. A verified image carries a number a person
 * typed. An unverified image contributes one per detection box, which reads low
 * because the detector misses animals standing behind each other. The page
 * counts both by default, like every other statistic in the app: the AI gives
 * an answer and verifying improves it, it is not a precondition. Verified-only
 * is one click away in the Display menu, and the active mode is named under the
 * charts so a screenshot cannot hide which numbers these are.
 */
import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { sitesApi } from '../../api/sites';
import { imagesApi } from '../../api/images';
import { statisticsApi } from '../../api/statistics';
import type { GroupSizeResponse } from '../../api/types';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import {
  GroupSizeChart,
  GroupSizeComparisonChart,
} from '../../components/plots/GroupSizeChart';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import { normalizeLabel, isWildlifeLabel } from '../../utils/labels';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

const FILTER_SCHEMA: FilterSchema = {
  species: 'string[]',
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  site_ids: 'string[]',
  source: 'string',
  charts: 'string',
};

// Defaults are the values left out of the URL, so a clean link means all counts,
// one chart per species. First option is the default.
const SOURCE_OPTIONS = [
  { value: 'people_ai', label: 'All counts, verified and AI estimates' },
  { value: 'people', label: 'Only verified counts' },
];

const CHARTS_OPTIONS = [
  { value: 'separate', label: 'One per species' },
  { value: 'combined', label: 'All in one chart' },
];

const REFERENCES: PlotReference[] = [
  {
    citation:
      "O'Brien, T. G., Kinnaird, M. F., & Wibisono, H. T. (2003). Crouching tigers, " +
      'hidden prey: Sumatran tiger and prey populations in a tropical forest landscape. ' +
      'Animal Conservation, 6(2), 131-139.',
    url: 'https://doi.org/10.1017/S1367943003003172',
  },
];

export const GroupSizePage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const speciesValues = Array.isArray(parsed.species) ? parsed.species : [];
  const startDate = (parsed.date_from as string) || null;
  const endDate = (parsed.date_to as string) || null;
  const tagValues = Array.isArray(parsed.tags) ? parsed.tags : [];
  const siteIdValues = Array.isArray(parsed.site_ids) ? parsed.site_ids : [];
  const source = (parsed.source as string) === 'people' ? 'people' : 'people_ai';
  const verifiedOnly = source === 'people';
  const charts = (parsed.charts as string) === 'combined' ? 'combined' : 'separate';

  // Species picker options. Same source the Images page filter uses, minus the
  // detector categories, which have no meaningful group size.
  const { data: allSpeciesList } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Used only to preselect the most-detected species on first load, so the
  // page opens with a chart instead of a prompt. Same trick as Activity overlap.
  const { data: topSpeciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId!),
    enabled: projectId !== undefined,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['site-tags', projectId],
    queryFn: () => sitesApi.getTags(projectId!),
    enabled: projectId !== undefined,
  });

  const speciesOptions = useMemo(
    () =>
      (allSpeciesList ?? [])
        .filter((s) => isWildlifeLabel(String(s.value)))
        .map((s) => ({
          value: String(s.value),
          label: normalizeLabel(String(s.value)),
        })),
    [allSpeciesList],
  );

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      species: speciesValues.length > 0 ? speciesValues : undefined,
      date_from: startDate ?? undefined,
      date_to: endDate ?? undefined,
      tags: tagValues.length > 0 ? tagValues : undefined,
      site_ids: siteIdValues.length > 0 ? siteIdValues : undefined,
    }),
    [speciesValues, startDate, endDate, tagValues, siteIdValues],
  );

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      source: source === 'people_ai' ? undefined : source,
      charts: charts === 'separate' ? undefined : charts,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), { replace: true });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({
      species: undefined,
      date_from: undefined,
      date_to: undefined,
      tags: undefined,
      site_ids: undefined,
    });
  const onDisplayChange = (key: string, value: string) => writeAll({ [key]: value });

  // Open on the most-detected wildlife species so the page is never empty.
  useEffect(() => {
    if (speciesValues.length === 0 && topSpeciesList && topSpeciesList.length > 0) {
      const top = topSpeciesList.find((s) => isWildlifeLabel(s.species));
      if (top) onFilterChange({ species: [top.species] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSpeciesList, speciesValues.length]);

  const siteIdsFromTags = useMemo(() => {
    if (tagValues.length === 0 && siteIdValues.length === 0) return undefined;
    const ids = new Set<string>(siteIdValues);
    if (tagValues.length > 0 && sites) {
      const tagSet = new Set(tagValues);
      for (const s of sites) {
        if (s.tags?.some((tag) => tagSet.has(tag))) ids.add(String(s.id));
      }
    }
    return ids.size === 0 ? '0' : Array.from(ids).join(',');
  }, [tagValues, siteIdValues, sites]);

  const filterFields = useMemo<FilterFieldDef[]>(
    () => [
      {
        kind: 'multi-select',
        key: 'species',
        label: 'Species',
        options: speciesOptions,
        placeholder: 'Pick species',
        summary: (n) => `${n} species`,
      },
      {
        kind: 'multi-select',
        key: 'site_ids',
        label: 'Sites',
        options: (sites ?? []).map((s) => ({ label: s.name, value: String(s.id) })),
        placeholder: 'All sites',
        summary: (n) => `${n} sites`,
      },
      {
        kind: 'multi-select',
        key: 'tags',
        label: 'Site tags',
        options: (tagOptions ?? []).map((t) => ({ label: t, value: t })),
        placeholder: 'Any tags',
        summary: (n) => `${n} tags`,
      },
      {
        kind: 'date-range',
        fromKey: 'date_from',
        toKey: 'date_to',
        label: 'Date range',
      },
    ],
    [speciesOptions, sites, tagOptions],
  );

  const displayControls = useMemo<DisplayControlDef[]>(
    () => [
      { key: 'source', label: 'Counts', options: SOURCE_OPTIONS },
      { key: 'charts', label: 'Charts', options: CHARTS_OPTIONS },
    ],
    [],
  );
  const displayValues = { source, charts };

  const { data, isLoading } = useQuery<GroupSizeResponse>({
    queryKey: [
      'statistics',
      'group-size',
      projectId,
      speciesValues.join(','),
      startDate,
      endDate,
      siteIdsFromTags,
      verifiedOnly,
    ],
    queryFn: () =>
      statisticsApi.getGroupSize(projectId!, {
        species: speciesValues.length > 0 ? speciesValues.join(',') : undefined,
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
        site_ids: siteIdsFromTags,
        verified_only: verifiedOnly,
      }),
    enabled: projectId !== undefined && speciesValues.length > 0,
  });

  const sourceLabel =
    SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? SOURCE_OPTIONS[0].label;

  return (
    <InsightsPageLayout
      title="Group size"
      subtitle="How many individuals are seen together, per species"
    >
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
        displayControls={displayControls}
        displayValues={displayValues}
        onDisplayChange={onDisplayChange}
      />

      {speciesValues.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          Pick one or more species above to load the charts.
        </div>
      ) : isLoading || !data ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          Grouping detections into independent events
        </div>
      ) : data.species.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          No events for this selection.
          {verifiedOnly && ' Only verified images are counted, so try verifying some first.'}
        </div>
      ) : (
        <>
          {charts === 'combined' && data.species.length > 1 ? (
            <GroupSizeComparisonChart species={data.species} />
          ) : (
            // A single chart fills the width; two or more tile two-up.
            <div
              className={
                data.species.length === 1
                  ? 'grid grid-cols-1 gap-4'
                  : 'grid grid-cols-1 lg:grid-cols-2 gap-4'
              }
            >
              {data.species.map((s) => (
                <GroupSizeChart key={s.species} species={s} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>{sourceLabel}</span>
            <span aria-hidden="true">·</span>
            <span>
              {data.metadata.independence_interval_minutes > 0
                ? `Independence interval ${data.metadata.independence_interval_minutes} min`
                : 'No independence interval, every image counts as its own event'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Person, vehicle and empty are excluded</span>
          </div>
        </>
      )}

      <PlotExplainer
        plotKey="group-size"
        what={
          <p>
            For each species, how many individuals were seen together. The bars show how
            often each group size occurred, and the row above each chart gives the mean,
            the smallest and largest group, and how many independent events the numbers
            rest on.
          </p>
        }
        how={
          <>
            <p>
              Repeat photos of the same species at the same place within the project's
              independence interval are grouped into one event. The group size of an
              event is its MaxN, the most individuals visible in any single image of that
              event (O'Brien et al. 2003). This is the standard camera trap approach and
              the same event grouping the other statistics use.
            </p>
            <p>
              By default every image counts. A verified image uses the number a person
              entered, an unverified image counts one per detection box. Switching to{' '}
              <em>Only verified counts</em> in the Display menu drops the unverified
              images.
            </p>
          </>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
