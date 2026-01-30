/**
 * Dashboard page with statistics and charts
 */
import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import type { ChartData } from 'chart.js';
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
import { Camera, Images, TrendingUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Select, SelectItem } from '../components/ui/Select';
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

  // Timeline range selector
  const [timelineDays, setTimelineDays] = useState<string>('30');
  const chartRef = useRef<any>(null);

  // Fetch all statistics
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['statistics', 'overview'],
    queryFn: () => statisticsApi.getOverview(),
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['statistics', 'timeline', timelineDays],
    queryFn: () => statisticsApi.getImagesTimeline(timelineDays === 'all' ? 0 : parseInt(timelineDays)),
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
      title: 'Images today',
      value: overview?.images_today ?? 0,
      icon: TrendingUp,
      color: '#0f6064',
    },
    {
      title: 'Total images',
      value: overview?.total_images ?? 0,
      icon: Images,
      color: '#7e4369',
    },
    {
      title: 'Total cameras',
      value: overview?.total_cameras ?? 0,
      icon: Camera,
      color: '#485e12',
    },
  ];

  // Create gradient for timeline chart
  const createGradient = (ctx: CanvasRenderingContext2D, chartArea: { top: number; bottom: number }) => {
    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    gradient.addColorStop(0, 'rgba(15, 96, 100, 0.05)');
    gradient.addColorStop(0.5, 'rgba(15, 96, 100, 0.3)');
    gradient.addColorStop(1, 'rgba(15, 96, 100, 0.6)');
    return gradient;
  };

  // Timeline chart data
  const timelineData: ChartData<'line'> = {
    labels: timeline?.map((d) => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) ?? [],
    datasets: [
      {
        label: 'Images Uploaded',
        data: timeline?.map((d) => d.count) ?? [],
        borderColor: '#0f6064',
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return 'rgba(15, 96, 100, 0.2)';
          return createGradient(ctx, chartArea);
        },
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

  const timelineRangeLabel = timelineDays === 'all' ? 'All time' :
    timelineDays === '7' ? 'Last 7 days' :
    timelineDays === '30' ? 'Last 30 days' :
    timelineDays === '90' ? 'Last 90 days' :
    timelineDays === '365' ? 'Last year' : `Last ${timelineDays} days`;

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
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-3">
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

      {/* Row 1: Activity Pattern + Images Timeline */}
      <div className="grid gap-6 md:grid-cols-2">
        <ActivityPatternChart dateRange={dateRange} />
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg">Images over time</CardTitle>
              <Select
                value={timelineDays}
                onValueChange={setTimelineDays}
                className="w-32 h-8 text-sm"
              >
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">{timelineRangeLabel}</p>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {timelineLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              ) : timeline && timeline.length > 0 ? (
                <Line ref={chartRef} data={timelineData} options={timelineOptions} />
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
