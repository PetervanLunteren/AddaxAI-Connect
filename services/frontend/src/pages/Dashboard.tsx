/**
 * Dashboard page with statistics and charts
 */
import React, { useState } from 'react';
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
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { statisticsApi } from '../api/statistics';
import { normalizeLabel } from '../utils/labels';
import { getSpeciesColors } from '../utils/species-colors';
import {
  DateRangeFilter,
  DateRange,
  ActivityPatternChart,
  DetectionTrendChart,
  AlertCounters,
  SpeciesComparisonChart,
} from '../components/dashboard';

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

export const Dashboard: React.FC = () => {
  // Global date range filter
  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: '',
    endDate: '',
  });

  // Fetch all statistics
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['statistics', 'overview'],
    queryFn: () => statisticsApi.getOverview(),
  });

  const { data: species, isLoading: speciesLoading } = useQuery({
    queryKey: ['statistics', 'species'],
    queryFn: () => statisticsApi.getSpeciesDistribution(),
  });

  const { data: cameraActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['statistics', 'activity'],
    queryFn: () => statisticsApi.getCameraActivity(),
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
      color: '#ff8945',
    },
    {
      title: 'Total cameras',
      value: overview?.total_cameras ?? 0,
      icon: Camera,
      color: '#71b7ba',
    },
  ];

  // Species distribution chart data - using consistent colors
  const speciesColors = species ? getSpeciesColors(species.map(s => s.species)) : [];
  const speciesData = {
    labels: species?.map((s) => normalizeLabel(s.species)) ?? [],
    datasets: [
      {
        label: 'Count',
        data: species?.map((s) => s.count) ?? [],
        backgroundColor: speciesColors.map(c => c.replace(')', ', 0.8)').replace('rgb', 'rgba')),
        borderColor: speciesColors,
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
    labels: ['Active', 'Inactive', 'Never reported'],
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
          '#71b7ba',  // Never reported - light teal
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
      {/* Header with date filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-0">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">Project overview with statistics and trends</p>
        </div>
        <DateRangeFilter
          value={dateRange}
          onChange={setDateRange}
          minDate={overview?.first_image_date}
          maxDate={overview?.last_image_date}
        />
      </div>

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
        <DetectionTrendChart dateRange={dateRange} />
      </div>

      {/* Row 2: Activity pattern + Detection categories + Camera activity (3 cols) */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
        <ActivityPatternChart dateRange={dateRange} />
        <AlertCounters />
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

      {/* Row 3: Species activity comparison (full width) */}
      <SpeciesComparisonChart dateRange={dateRange} />
    </div>
  );
};
