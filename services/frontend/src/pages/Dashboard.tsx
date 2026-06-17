/**
 * Dashboard page with statistics and charts
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../lib/filter-url';
import {
  FilterBar,
  type FilterFieldDef,
  type FilterValue,
} from '../components/ui/FilterBar';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Camera, Images, TrendingUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { statisticsApi } from '../api/statistics';
import { imagesApi } from '../api/images';
import { camerasApi } from '../api/cameras';
import { normalizeLabel } from '../utils/labels';
import { getSpeciesColor, setSpeciesContext } from '../utils/species-colors';
import { useProject } from '../contexts/ProjectContext';
import {
  DateRange,
  ActivityPatternChart,
  DetectionTrendChart,
  AlertCounters,
  SpeciesFilterHintBanner,
} from '../components/dashboard';
import { DemographicChart } from '../components/dashboard/DemographicChart';
import { VerificationProgressCard } from '../components/dashboard/VerificationProgressCard';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
};

export const Dashboard: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  // Filter state lives in the URL so dashboard views are sharable and
  // survive a refresh. `replace: true` keeps the back button history clean
  // when the user edits the date range or toggles tag chips.
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

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
  const cameraIdValues: string[] = useMemo(
    () => (Array.isArray(parsed.camera_ids) ? parsed.camera_ids : []),
    [parsed.camera_ids],
  );

  // Fetch cameras (for tag → camera-id reverse mapping AND as the source of
  // labels for the explicit Cameras MultiSelect).
  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });

  // Fetch tag options
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
    enabled: projectId !== undefined,
  });

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      date_from: dateRange.startDate ?? undefined,
      date_to: dateRange.endDate ?? undefined,
      tags: tagValues.length > 0 ? tagValues : undefined,
      camera_ids: cameraIdValues.length > 0 ? cameraIdValues : undefined,
    }),
    [dateRange, tagValues, cameraIdValues],
  );

  const onFilterChange = (patch: Record<string, FilterValue>) => {
    const next = { ...filterValues, ...patch };
    setSearchParams(filtersToSearchParams(next, FILTER_SCHEMA), {
      replace: true,
    });
  };
  const onClearAll = () =>
    setSearchParams(new URLSearchParams(), { replace: true });

  // Effective camera_ids passed to the API: union of cameras directly
  // selected and cameras whose tags match. Empty set when no filter active;
  // '0' sentinel when both filters are active but produce no matches.
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

  // Fetch all statistics
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['statistics', 'overview', projectId, cameraIdsFromTags],
    queryFn: () => statisticsApi.getOverview(projectId, cameraIdsFromTags),
    enabled: projectId !== undefined,
  });

  const filterFields = useMemo<FilterFieldDef[]>(
    () => [
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
        minDate: overview?.first_image_date,
        maxDate: overview?.last_image_date,
      },
    ],
    [cameras, tagOptions, overview],
  );

  const { data: species, isLoading: speciesLoading } = useQuery({
    queryKey: ['statistics', 'species', projectId, cameraIdsFromTags],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId, cameraIdsFromTags),
    enabled: projectId !== undefined,
  });

  const { data: cameraActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['statistics', 'activity', projectId, cameraIdsFromTags],
    queryFn: () => statisticsApi.getCameraActivity(projectId, cameraIdsFromTags),
    enabled: projectId !== undefined,
  });

  // Fetch full species list for consistent colors app-wide
  const { data: allSpeciesOptions } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Set species context using the full species list for consistent colors
  useMemo(() => {
    if (allSpeciesOptions && allSpeciesOptions.length > 0) {
      const allSpecies = allSpeciesOptions.map(s => s.value as string);
      allSpecies.push('animal', 'person', 'vehicle', 'empty');
      setSpeciesContext(allSpecies);
    }
  }, [allSpeciesOptions]);

  // Summary cards data (colors from FRONTEND_CONVENTIONS.md palette)
  const summaryCards = [
    {
      title: 'Images today',
      value: overview?.images_today ?? 0,
      icon: TrendingUp,
      color: '#0f6064',
    },
    {
      title: 'Total images',
      value: overview?.total_images ?? 0,
      icon: Images,
      color: '#0f6064',
    },
    {
      title: 'Total cameras',
      value: overview?.total_cameras ?? 0,
      icon: Camera,
      color: '#0f6064',
    },
  ];

  // Species distribution chart data - using consistent colors from global context
  const speciesData = {
    labels: species?.map((s) => normalizeLabel(s.species)) ?? [],
    datasets: [
      {
        label: 'Count',
        data: species?.map((s) => s.count) ?? [],
        backgroundColor: species?.map((s) => {
          const color = getSpeciesColor(s.species);
          // Convert hex to rgba with 0.8 opacity
          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, 0.8)`;
        }) ?? [],
        borderColor: species?.map((s) => getSpeciesColor(s.species)) ?? [],
        borderWidth: 1,
      },
    ],
  };

  const speciesOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: false,
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: {
          precision: 0,
        },
      },
    },
  };

  // Camera activity chart data
  const activityData = {
    labels: ['Active', 'Inactive', 'No live signal yet'],
    datasets: [
      {
        data: [
          cameraActivity?.active ?? 0,
          cameraActivity?.inactive ?? 0,
          cameraActivity?.never_reported ?? 0,
        ],
        backgroundColor: [
          '#0f6064',  // Active - teal
          '#882000',  // Inactive - dark red
          '#71b7ba',  // No live signal yet - light teal
        ],
        borderWidth: 0,
      },
    ],
  };

  const activityOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
      title: {
        display: false,
      },
    },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-0">Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">Project overview with statistics and trends. Observation counts are based on MaxN, the peak number of individuals per species visible in a single image within each event, summed across all events.</p>
      </div>

      {/* Species filtering hint (DeepFaune projects, admins, not yet narrowed) */}
      <SpeciesFilterHintBanner />

      {/* Filter bar — always visible, matching the Insights pages */}
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {summaryCards.map((card) => (
          <Card key={card.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                  <p className="text-2xl font-bold mt-1">
                    {overviewLoading ? '...' : card.value.toLocaleString()}
                  </p>
                </div>
                <div
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: `${card.color}20` }}
                >
                  <card.icon className="h-6 w-6" style={{ color: card.color }} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 1: Species detected + Detection trend (2 cols) */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Species detected</CardTitle>
            <p className="text-sm text-muted-foreground">Top 10 most frequently observed</p>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {speciesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              ) : species && species.length > 0 ? (
                <Bar data={speciesData} options={speciesOptions} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">No species data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <DetectionTrendChart
          dateRange={dateRange}
          projectId={projectId}
          cameraIds={cameraIdsFromTags}
          projectFirstDate={overview?.first_image_date ?? null}
          projectLastDate={overview?.last_image_date ?? null}
        />
      </div>

      {/* Row 2: Activity pattern + Detection categories + Camera activity (3 cols) */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
        <ActivityPatternChart dateRange={dateRange} projectId={projectId} cameraIds={cameraIdsFromTags} />
        <AlertCounters projectId={projectId} cameraIds={cameraIdsFromTags} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Camera activity status</CardTitle>
            <p className="text-sm text-muted-foreground">Based on last 7 days</p>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {activityLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              ) : cameraActivity ? (
                <Doughnut data={activityData} options={activityOptions} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">No data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Demographics + Verification progress */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <DemographicChart dateRange={dateRange} projectId={projectId} cameraIds={cameraIdsFromTags} />
        <VerificationProgressCard dateRange={dateRange} projectId={projectId} cameraIds={cameraIdsFromTags} />
      </div>
    </div>
  );
};
