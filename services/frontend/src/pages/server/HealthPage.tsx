/**
 * System health monitoring page
 *
 * Displays status of all system services for server admins
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { getServicesHealth, type ServiceStatus } from '../../api/health';
import { statisticsApi } from '../../api/statistics';

/**
 * Map service names to display names with proper capitalization
 */
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  postgres: 'PostgreSQL',
  redis: 'Redis',
  minio: 'MinIO',
  prometheus: 'Prometheus',
  loki: 'Loki',
  api: 'API',
  frontend: 'Frontend',
  ingestion: 'Ingestion worker',
  detection: 'Detection worker',
  classification: 'Classification worker',
  notifications: 'Notifications worker',
  'notifications-telegram': 'Telegram notifications worker',
  'processing-pipeline': 'Processing Pipeline',
};

const ServiceStatusBadge: React.FC<{ status: ServiceStatus }> = ({ status }) => {
  const isHealthy = status.status === 'healthy';

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border ${
        isHealthy ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}
    >
      {isHealthy ? (
        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            {SERVICE_DISPLAY_NAMES[status.name] || status.name}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isHealthy
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {isHealthy ? 'Healthy' : 'Unhealthy'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1 break-words">
          {status.message}
        </p>
      </div>
    </div>
  );
};

export const HealthPage: React.FC = () => {
  // Fetch services health
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['services-health'],
    queryFn: getServicesHealth,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Fetch pipeline status
  const { data: pipelineData, refetch: refetchPipeline } = useQuery({
    queryKey: ['statistics', 'pipeline-status'],
    queryFn: () => statisticsApi.getPipelineStatus(),
  });

  const handleRefresh = () => {
    refetch();
    refetchPipeline();
  };

  // Build pipeline status as a service
  const pipelineService: ServiceStatus | null = pipelineData ? {
    name: 'processing-pipeline',
    status: pipelineData.pending === 0 ? 'healthy' : 'unhealthy',
    message: pipelineData.pending === 0
      ? 'No images pending classification'
      : `${pipelineData.pending.toLocaleString()} image${pipelineData.pending === 1 ? '' : 's'} pending classification`,
  } : null;

  // Combine services with pipeline status
  const allServices = data?.services
    ? [...data.services, ...(pipelineService ? [pipelineService] : [])]
    : [];

  const healthyCount = allServices.filter((s) => s.status === 'healthy').length;
  const totalCount = allServices.length;
  const allHealthy = healthyCount === totalCount && totalCount > 0;

  return (
    <ServerPageLayout
      title="System health"
      description="Monitor the status of all system services"
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <CardTitle>System services</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          {data && (
            <CardDescription>
              {allHealthy ? (
                <span className="text-green-600 font-medium">
                  All services are healthy ({healthyCount}/{totalCount})
                </span>
              ) : (
                <span className="text-red-600 font-medium">
                  {healthyCount} of {totalCount} services are healthy
                </span>
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Checking service health...</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <span className="font-medium text-red-900">Failed to check service health</span>
              </div>
              <p className="text-sm text-red-700">
                {error instanceof Error ? error.message : 'Unknown error occurred'}
              </p>
            </div>
          )}

          {/* Services List */}
          {allServices.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {allServices.map((service) => (
                <ServiceStatusBadge key={service.name} status={service} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </ServerPageLayout>
  );
};
