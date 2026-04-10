/**
 * Verification progress card — scrollable list of progress bars per label.
 *
 * "All images" is pinned at the top. The rest are sorted by percentage
 * ascending so the least-verified labels (where effort is needed) appear
 * first. No dropdown — everything is visible at a glance.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

interface VerificationProgressCardProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
}

export const VerificationProgressCard: React.FC<VerificationProgressCardProps> = ({
  dateRange,
  projectId,
  cameraIds,
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'verification-progress-all', projectId, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getVerificationProgressAll(projectId!, {
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
      }),
    enabled: projectId !== undefined,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Verification progress</CardTitle>
        <p className="text-sm text-muted-foreground">
          Sorted by most images first
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
        ) : data && data.rows.length > 0 ? (
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {data.rows.map((row, index) => {
              const isAll = row.label === 'all';
              return (
                <div key={row.label}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className={`text-sm ${isAll ? 'font-semibold' : ''}`}>
                      {isAll ? 'All images' : normalizeLabel(row.label)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.verified}/{row.total} ({row.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${row.percentage}%`,
                        backgroundColor: '#0f6064',
                      }}
                    />
                  </div>
                  {isAll && index < data.rows.length - 1 && (
                    <div className="border-b mt-3" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No data</p>
        )}
      </CardContent>
    </Card>
  );
};
