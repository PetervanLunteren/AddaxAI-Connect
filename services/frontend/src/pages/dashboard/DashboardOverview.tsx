/**
 * Dashboard Overview tab: the state of the whole project.
 *
 * Holds every card whose endpoint does not accept a species, so nothing here
 * is affected by the species filter on the Explore tab.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { FilterBar } from '../../components/ui/FilterBar';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import { getSpeciesColor } from '../../utils/species-colors';
import { AlertCounters, type DateRange } from '../../components/dashboard';
import { VerificationProgressCard } from '../../components/dashboard/VerificationProgressCard';
import { useDashboardFilters } from './useDashboardFilters';

// Overview has no date filter. The URL can still carry a date range because
// the Explore tab uses one, so verification progress is pinned to all time
// here rather than being filtered by a control the user cannot see.
const ALL_TIME: DateRange = { startDate: null, endDate: null };

// This tab owns the only Bar and Doughnut on the dashboard.
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

export const DashboardOverview: React.FC = () => {
  const {
    projectId,
    siteIdsFromTags,
    overview,
    overviewLoading,
    filterValues,
    filterFields,
    onFilterChange,
    onClearAll,
  } = useDashboardFilters('overview');

  const { data: species, isLoading: speciesLoading } = useQuery({
    queryKey: ['statistics', 'species', projectId, siteIdsFromTags],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId, siteIdsFromTags),
    enabled: projectId !== undefined,
  });

  const { data: cameraActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['statistics', 'activity', projectId, siteIdsFromTags],
    queryFn: () => statisticsApi.getCameraActivity(projectId, siteIdsFromTags),
    enabled: projectId !== undefined,
  });

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

      {/* Species detected + Camera activity */}
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

      {/* Detection categories + Verification progress */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <AlertCounters projectId={projectId} siteIds={siteIdsFromTags} />
        <VerificationProgressCard
          dateRange={ALL_TIME}
          projectId={projectId}
          siteIds={siteIdsFromTags}
        />
      </div>
    </div>
  );
};
