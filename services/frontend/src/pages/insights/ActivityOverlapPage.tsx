/**
 * Insights -> Activity overlap page.
 *
 * Lets the user pick 1 or 2 species, restricts by date range and camera tags,
 * and renders a circular-KDE overlay with bootstrap-CI Δ readout. Mirrors
 * the AddaxAI WebUI page so the two products feel the same.
 *
 * Filter state lives in the URL via filtersFromSearchParams /
 * filtersToSearchParams. The math (KDE, bootstrap, sun-time transform)
 * runs server-side; this page is purely presentational.
 */
import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Info, Loader2 } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { camerasApi } from '../../api/cameras';
import { imagesApi } from '../../api/images';
import { statisticsApi } from '../../api/statistics';
import type {
  ActivityOverlapResponse,
  SampleSizeWarning,
  TimeAxis,
} from '../../api/types';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import {
  ActivityOverlapChart,
  SPECIES_A_COLOR,
  SPECIES_B_COLOR,
} from '../../components/plots/ActivityOverlapChart';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import { normalizeLabel } from '../../utils/labels';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

const FILTER_SCHEMA: FilterSchema = {
  species_a: 'string',
  species_b: 'string',
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
  time_axis: 'string',
};

const DIEL_LABEL: Record<string, string> = {
  diurnal: 'Diurnal',
  nocturnal: 'Nocturnal',
  crepuscular: 'Crepuscular',
  cathemeral: 'Cathemeral',
};

const SAMPLE_WARNING_LABEL: Record<SampleSizeWarning, string> = {
  low_n_30: 'Too few detections, interpret with caution',
  low_n_50: 'Small sample, using Δ₁',
  low_n_75: 'Δ₄ may be unreliable below n=75',
};

const REFERENCES: PlotReference[] = [
  {
    citation:
      'Vazquez, C., Rowcliffe, J. M., Spoelstra, K., & Jansen, P. A. (2019). Comparing diel ' +
      'activity patterns of wildlife across latitudes and seasons: time transformations using ' +
      'day length. Methods in Ecology and Evolution, 10(12), 2057–2066.',
    url: 'https://besjournals.onlinelibrary.wiley.com/doi/10.1111/2041-210X.13290',
  },
  {
    citation:
      'Bennie, J. J., Duffy, J. P., Inger, R., & Gaston, K. J. (2014). Biogeography of time ' +
      'partitioning in mammals. PNAS, 111(38), 13727–13732.',
    url: 'https://www.pnas.org/doi/10.1073/pnas.1216063110',
  },
];

export const ActivityOverlapPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const speciesA = (parsed.species_a as string) || null;
  const speciesB = (parsed.species_b as string) || null;
  const startDate = (parsed.date_from as string) || null;
  const endDate = (parsed.date_to as string) || null;
  const tagValues = Array.isArray(parsed.tags) ? parsed.tags : [];
  const cameraIdValues = Array.isArray(parsed.camera_ids) ? parsed.camera_ids : [];
  const timeAxis = ((parsed.time_axis as string) || 'clock') as TimeAxis;

  // Full species list for the A / B dropdowns. Same source the Images
  // page filter uses, so the two screens stay in sync. The dashboard's
  // species-distribution endpoint caps at top 10, which silently hid
  // anything past the 10th most-detected species from this picker.
  const { data: allSpeciesList } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Top-N by count, used only to pick a sensible default for species A
  // on first load (most-detected species is the most useful starting
  // point). Not used to populate the dropdown.
  const { data: topSpeciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
    enabled: projectId !== undefined,
  });

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      species_a: speciesA ?? undefined,
      species_b: speciesB ?? undefined,
      date_from: startDate ?? undefined,
      date_to: endDate ?? undefined,
      tags: tagValues.length > 0 ? tagValues : undefined,
      camera_ids: cameraIdValues.length > 0 ? cameraIdValues : undefined,
    }),
    [speciesA, speciesB, startDate, endDate, tagValues, cameraIdValues],
  );

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      time_axis: timeAxis === 'clock' ? undefined : timeAxis,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), {
      replace: true,
    });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({
      species_a: undefined,
      species_b: undefined,
      date_from: undefined,
      date_to: undefined,
      tags: undefined,
      camera_ids: undefined,
    });
  const onDisplayChange = (key: string, value: string) => writeAll({ [key]: value });

  // Auto-select the most-detected species as A on first load so the page
  // shows a chart instead of an empty state.
  useEffect(() => {
    if (!speciesA && topSpeciesList && topSpeciesList.length > 0) {
      onFilterChange({ species_a: topSpeciesList[0].species });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSpeciesList, speciesA]);

  const cameraIdsFromTags = useMemo(() => {
    if (tagValues.length === 0 && cameraIdValues.length === 0) return undefined;
    const ids = new Set<string>(cameraIdValues);
    if (tagValues.length > 0 && cameras) {
      const tagSet = new Set(tagValues);
      for (const c of cameras) {
        if (c.tags?.some((tag) => tagSet.has(tag))) ids.add(String(c.id));
      }
    }
    return ids.size === 0 ? '0' : Array.from(ids).join(',');
  }, [tagValues, cameraIdValues, cameras]);

  const speciesOptions = useMemo(
    () =>
      (allSpeciesList ?? []).map((s) => ({
        value: String(s.value),
        label: normalizeLabel(String(s.value)),
      })),
    [allSpeciesList],
  );

  const filterFields = useMemo<FilterFieldDef[]>(
    () => [
      {
        kind: 'select',
        key: 'species_a',
        label: 'Species A',
        options: speciesOptions,
        placeholder: 'Pick species A',
      },
      {
        kind: 'select',
        key: 'species_b',
        label: 'Species B',
        options: speciesOptions.filter((o) => o.value !== speciesA),
        placeholder: 'Optional second species',
      },
      {
        kind: 'multi-select',
        key: 'camera_ids',
        label: 'Cameras',
        options: (cameras ?? []).map((c) => ({ label: c.name, value: String(c.id) })),
        placeholder: 'All cameras',
        summary: (n) => `${n} cameras`,
      },
      {
        kind: 'multi-select',
        key: 'tags',
        label: 'Camera tags',
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
    [speciesOptions, speciesA, cameras, tagOptions],
  );

  const displayControls = useMemo<DisplayControlDef[]>(
    () => [
      {
        key: 'time_axis',
        label: 'Time axis',
        options: [
          { value: 'clock', label: 'Clock' },
          { value: 'sun', label: 'Sun' },
        ],
      },
    ],
    [],
  );

  const displayValues = { time_axis: timeAxis };

  const { data, isLoading } = useQuery<ActivityOverlapResponse>({
    queryKey: [
      'statistics',
      'activity-overlap',
      projectId,
      speciesA,
      speciesB,
      startDate,
      endDate,
      cameraIdsFromTags,
      timeAxis,
    ],
    queryFn: () =>
      statisticsApi.getActivityOverlap(projectId!, {
        species_a: speciesA!,
        species_b: speciesB ?? undefined,
        camera_ids: cameraIdsFromTags,
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
        time_axis: timeAxis,
      }),
    enabled: projectId !== undefined && !!speciesA,
  });

  const subtitle = speciesA
    ? `Circular KDE of detection times, von Mises smoothing. Δ ranges 0 (disjoint) to 1 (identical).`
    : 'Pick a species to compare diel activity patterns';

  return (
    <InsightsPageLayout title="Activity overlap" subtitle={subtitle}>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
        displayControls={displayControls}
        displayValues={displayValues}
        onDisplayChange={onDisplayChange}
      />

      {!speciesA ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          Pick a species above to load the chart.
        </div>
      ) : isLoading || !data ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="h-[420px] flex flex-col items-center justify-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Fitting activity curves and bootstrap overlap CI
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border bg-card p-4">
            <div className="h-[420px]">
              <ActivityOverlapChart data={data} />
            </div>
            <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>Timezone {data.project_timezone}</span>
              <span aria-hidden="true">·</span>
              <span>Independence interval {data.independence_interval_minutes_recorded} min</span>
              <span aria-hidden="true">·</span>
              <span>Axis {data.time_axis === 'sun' ? 'sun (Vazquez 2019 anchored)' : 'clock'}</span>
              {data.time_axis === 'clock' && data.sun_bands_reference_date && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Sun bands drawn for {data.sun_bands_reference_date}</span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SpeciesSummaryCard
              label={data.species_a.label}
              n={data.species_a.n}
              dielClass={data.species_a.diel_class}
              warning={data.species_a.sample_size_warning}
              color={SPECIES_A_COLOR}
            />
            {data.species_b && (
              <SpeciesSummaryCard
                label={data.species_b.label}
                n={data.species_b.n}
                dielClass={data.species_b.diel_class}
                warning={data.species_b.sample_size_warning}
                color={SPECIES_B_COLOR}
              />
            )}
          </div>

          {data.overlap && (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-semibold">
                    Overlap Δ {data.overlap.delta_estimator === 'delta1' ? '₁' : '₄'}
                    {' '}= {data.overlap.delta.toFixed(3)}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    95% CI [{data.overlap.ci_low.toFixed(3)}, {data.overlap.ci_high.toFixed(3)}]
                    {' '}from {data.overlap.bootstrap_reps} bootstrap reps, min n = {data.overlap.min_n}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <PlotExplainer
        plotKey="activity-overlap"
        what={
          <p>
            Each curve is a smoothed picture of when a species is active across the 24-hour day,
            built from its detection times. When two species are shown, the shaded region between
            them is the overlap coefficient Δ, which goes from 0 (never active at the same time)
            to 1 (identical patterns).
          </p>
        }
        how={
          <>
            <p>
              The curves smooth the raw detection times with a circular kernel so neighbouring
              hours contribute to each other. Δ comes with a 95% confidence interval from a
              small bootstrap. Δ₄ is reported when both species have at least 50 detections, Δ₁
              below that.
            </p>
            <p>
              Sun mode anchors each detection to its date's sunrise and sunset (Vazquez et al.
              2019) so activity collected across seasons shares a common reference frame. It
              falls back to clock time when no camera location is set.
            </p>
            <p>
              Each species is labelled diurnal, nocturnal, crepuscular, or cathemeral following
              Bennie et al. 2014: dominant phase when its share of the density is at least 70%,
              otherwise cathemeral.
            </p>
          </>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};

interface SpeciesSummaryCardProps {
  label: string;
  n: number;
  dielClass: string;
  warning: SampleSizeWarning | null;
  color: string;
}

const SpeciesSummaryCard: React.FC<SpeciesSummaryCardProps> = ({
  label,
  n,
  dielClass,
  warning,
  color,
}) => (
  <div className="rounded-lg border bg-card p-4 text-sm space-y-1">
    <div className="flex items-center gap-2">
      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-semibold">{normalizeLabel(label)}</span>
    </div>
    <p className="text-muted-foreground">
      n = {n.toLocaleString()} detections, {DIEL_LABEL[dielClass] ?? dielClass}
    </p>
    {warning && (
      <p className="text-amber-700 dark:text-amber-400">
        {SAMPLE_WARNING_LABEL[warning]}
      </p>
    )}
  </div>
);
