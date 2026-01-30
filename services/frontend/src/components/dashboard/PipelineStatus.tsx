/**
 * Pipeline Status - Show pending classification count as a health-style badge
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { statisticsApi } from '../../api/statistics';

export const PipelineStatus: React.FC = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'pipeline-status'],
    queryFn: () => statisticsApi.getPipelineStatus(),
  });

  const pendingCount = data?.pending ?? 0;
  const isHealthy = pendingCount === 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-gray-50 border-gray-200">
        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin flex-shrink-0" />
        <span className="text-sm text-muted-foreground">Checking pipeline status...</span>
      </div>
    );
  }

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
          <span className="font-medium text-sm">Processing Pipeline</span>
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
        <p className="text-sm text-muted-foreground mt-1">
          {pendingCount === 0
            ? 'No images pending classification'
            : `${pendingCount.toLocaleString()} image${pendingCount === 1 ? '' : 's'} pending classification`}
        </p>
      </div>
    </div>
  );
};
