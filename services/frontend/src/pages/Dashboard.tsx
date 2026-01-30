/**
 * Dashboard page with statistics and charts
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
} from 'chart.js';
import { Camera, Images, Layers, TrendingUp } from 'lucide-react';
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
  WeeklyTrendsChart,
} from '../components/dashboard';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export const Dashboard: React.FC = () => {
  // Calculate default dates (last 30 days)
  const getDefaultDates = (): DateRange => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  };

  // Global date range filter
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDates());

  // Fetch all statistics
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['statistics', 'overview'],
    queryFn: () => statisticsApi.getOverview(),
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['statistics', 'timeline'],
    queryFn: () => statisticsApi.getImagesTimeline(),
  });

  const { data: species, isLoading: speciesLoading } = useQuery({
    queryKey: ['statistics', 'species'],
    queryFn: () => statisticsApi.getSpeciesDistribution(),
  });

  const { data: cameraActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['statistics', 'activity'],
    queryFn: () => statisticsApi.getCameraActivity(),
  });

  // Summary cards data
  const summaryCards = [
    {
      title: 'Total Images',
      value: overview?.total_images ?? 0,
      icon: Images,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      title: 'Total Cameras',
      value: overview?.total_cameras ?? 0,
      icon: Camera,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
    },
    {
      title: 'Species Detected',
      value: overview?.total_species ?? 0,
      icon: Layers,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
    {
      title: 'Images Today',
      value: overview?.images_today ?? 0,
      icon: TrendingUp,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
    },
  ];

  // Timeline chart data
  const timelineData = {
    labels: timeline?.map((d) => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) ?? [],
    datasets: [
      {
        label: 'Images Uploaded',
        data: timeline?.map((d) => d.count) ?? [],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const timelineOptions: ChartOptions<'line'> = {
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
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
        },
      },
    },
  };

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
    labels: ['Active', 'Inactive', 'Never Reported'],
    datasets: [
      {
        data: [
          cameraActivity?.active ?? 0,
          cameraActivity?.inactive ?? 0,
          cameraActivity?.never_reported ?? 0,
        ],
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(251, 146, 60, 0.8)',
          'rgba(239, 68, 68, 0.8)',
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
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                  <p className="text-3xl font-bold mt-2">
                    {overviewLoading ? '...' : card.value.toLocaleString()}
                  </p>
                </div>
                <div className={`${card.bgColor} ${card.color} p-3 rounded-lg`}>
                  <card.icon className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 1: Activity Pattern + Images Timeline */}
      <div className="grid gap-6 md:grid-cols-2">
        <ActivityPatternChart dateRange={dateRange} />
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Images Over Time (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {timelineLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              ) : timeline && timeline.length > 0 ? (
                <Line data={timelineData} options={timelineOptions} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">No data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Species Distribution + Camera Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top 10 Species Detected</CardTitle>
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
          <CardHeader>
            <CardTitle className="text-lg">Camera Activity Status</CardTitle>
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

      {/* Detection Trend (full width) */}
      <DetectionTrendChart dateRange={dateRange} />

      {/* Row 3: Weekly Trends (full width) */}
      <WeeklyTrendsChart dateRange={dateRange} />

      {/* Row 4: Species Comparison (full width) */}
      <SpeciesComparisonChart dateRange={dateRange} />

      {/* Row 5: Alerts */}
      <AlertCounters />
    </div>
  );
};
