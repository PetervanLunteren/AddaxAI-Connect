/**
 * Filter state for the Explore tab.
 *
 * Only Explore has filters. The Overview shows the whole project and never
 * reads these parameters, so nothing here has to be carried on its behalf.
 * An earlier version had Overview read and re-write `species` it never
 * displayed, purely so switching tabs did not wipe the Explore selection.
 * That is unnecessary once Overview stops touching the URL at all.
 *
 * The URL is the only state. There is no context and no store.
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

export function useDashboardFilters() {
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
    const sitesField: FilterFieldDef = {
      kind: 'multi-select',
      key: 'site_ids',
      label: 'Sites',
      options: (sites ?? []).map((s) => ({ label: s.name, value: String(s.id) })),
      placeholder: 'All sites',
      summary: (n) => `${n} sites`,
    };
    const tagsField: FilterFieldDef = {
      kind: 'multi-select',
      key: 'tags',
      label: 'Site tags',
      options: (tagOptions ?? []).map((t) => ({ label: t, value: t })),
      placeholder: 'Any tags',
      summary: (n) => `${n} tags`,
    };
    const speciesField: FilterFieldDef = {
      kind: 'select',
      key: 'species',
      label: 'Species',
      // "Empty" is not a species, it is the absence of one, and the endpoint
      // adds it for the Images page where filtering for blank frames is the
      // point. Nothing on this tab survives it: there is no animal to
      // photograph, group size excludes it, and the demographics are about
      // observations that do not exist.
      options: (allSpeciesOptions ?? [])
        .filter((s) => String(s.value) !== 'empty')
        .map((s) => ({
          value: String(s.value),
          label: String(s.label),
        })),
    };
    const dateField: FilterFieldDef = {
      kind: 'date-range',
      fromKey: 'date_from',
      toKey: 'date_to',
      label: 'Date range',
      minDate: overview?.first_image_date,
      maxDate: overview?.last_image_date,
    };

    // Species first, because it is the choice every card on the tab answers
    // to, then the rest in order of how often they are used.
    return [speciesField, sitesField, dateField, tagsField];
  }, [sites, tagOptions, allSpeciesOptions, overview]);

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
