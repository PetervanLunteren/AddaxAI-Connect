/**
 * Shared filter state for the two dashboard tabs.
 *
 * Both tabs use ONE schema. filtersToSearchParams() drops any key that is not
 * in the schema it is given, so if the Overview tab used a schema without
 * `species`, changing a date there would silently wipe the species chosen on
 * the Explore tab. Overview therefore reads and re-writes `species` even
 * though it never shows the control.
 *
 * The URL is the only shared state. There is no context and no store.
 */
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';
import type { FilterFieldDef, FilterValue } from '../../components/ui/FilterBar';
import { statisticsApi } from '../../api/statistics';
import { imagesApi } from '../../api/images';
import { sitesApi } from '../../api/sites';
import { setSpeciesContext } from '../../utils/species-colors';
import { useProject } from '../../contexts/ProjectContext';
import type { DateRange } from '../../components/dashboard';

export const DASHBOARD_FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  site_ids: 'string[]',
  species: 'string',
};

/**
 * Which tab is asking. This decides the filter bar only, never the values.
 *
 * Overview shows sites and tags, because every card there is filtered by
 * site. It does not show species or a date range: of its five cards only
 * verification progress accepts dates and none accept a species, so a
 * control at the top of the page would look like it moved everything while
 * moving one card or nothing. Overview therefore ignores both, see
 * ALL_TIME in DashboardOverview.
 */
type DashboardTab = 'overview' | 'explore';

export function useDashboardFilters(tab: DashboardTab = 'overview') {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  // Filter state lives in the URL so dashboard views are sharable and survive
  // a refresh. `replace: true` keeps the back button history clean when the
  // user edits the date range or toggles tag chips.
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, DASHBOARD_FILTER_SCHEMA);

  const dateRange: DateRange = useMemo(
    () => ({
      startDate: (parsed.date_from as string) || null,
      endDate: (parsed.date_to as string) || null,
    }),
    [parsed.date_from, parsed.date_to],
  );
  const tagValues: string[] = useMemo(
    () => (Array.isArray(parsed.tags) ? parsed.tags : []),
    [parsed.tags],
  );
  const siteIdValues: string[] = useMemo(
    () => (Array.isArray(parsed.site_ids) ? parsed.site_ids : []),
    [parsed.site_ids],
  );
  // Empty string means all species, matching the FilterBar select which writes
  // undefined for its empty option.
  const species = typeof parsed.species === 'string' ? parsed.species : '';

  // Fetch sites (for tag → site-id reverse mapping AND as the source of
  // labels for the explicit Sites MultiSelect).
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

  // Full species list, used for the Species filter options and for the
  // app-wide colour context below.
  const { data: allSpeciesOptions } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      date_from: dateRange.startDate ?? undefined,
      date_to: dateRange.endDate ?? undefined,
      tags: tagValues.length > 0 ? tagValues : undefined,
      site_ids: siteIdValues.length > 0 ? siteIdValues : undefined,
      // Carried on both tabs, see the file comment.
      species: species || undefined,
    }),
    [dateRange, tagValues, siteIdValues, species],
  );

  const onFilterChange = (patch: Record<string, FilterValue>) => {
    const next = { ...filterValues, ...patch };
    setSearchParams(filtersToSearchParams(next, DASHBOARD_FILTER_SCHEMA), {
      replace: true,
    });
  };
  const onClearAll = () =>
    setSearchParams(new URLSearchParams(), { replace: true });

  // Effective site_ids passed to the API: union of sites directly selected
  // and sites whose tags match. Empty set when no filter active;
  // '0' sentinel when both filters are active but produce no matches.
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

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['statistics', 'overview', projectId, siteIdsFromTags],
    queryFn: () => statisticsApi.getOverview(projectId, siteIdsFromTags),
    enabled: projectId !== undefined,
  });

  // Set species context using the full species list so colours stay
  // consistent app-wide.
  useEffect(() => {
    if (allSpeciesOptions && allSpeciesOptions.length > 0) {
      const allSpecies = allSpeciesOptions.map((s) => s.value as string);
      allSpecies.push('animal', 'person', 'vehicle', 'empty');
      setSpeciesContext(allSpecies);
    }
  }, [allSpeciesOptions]);

  const filterFields = useMemo<FilterFieldDef[]>(() => {
    // Sites and tags filter every card on both tabs.
    const fields: FilterFieldDef[] = [
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
    ];
    // Species and date range drive all three Explore cards, and nothing on
    // Overview, so they only appear on Explore.
    if (tab === 'explore') {
      fields.push(
        {
          kind: 'select',
          key: 'species',
          label: 'Species',
          options: (allSpeciesOptions ?? []).map((s) => ({
            value: String(s.value),
            label: String(s.label),
          })),
        },
        {
          kind: 'date-range',
          fromKey: 'date_from',
          toKey: 'date_to',
          label: 'Date range',
          minDate: overview?.first_image_date,
          maxDate: overview?.last_image_date,
        },
      );
    }
    return fields;
  }, [sites, tagOptions, allSpeciesOptions, overview, tab]);

  return {
    projectId,
    dateRange,
    /** '' means all species. Pass `species || undefined` to the API. */
    species,
    siteIdsFromTags,
    overview,
    overviewLoading,
    filterValues,
    filterFields,
    onFilterChange,
    onClearAll,
  };
}
