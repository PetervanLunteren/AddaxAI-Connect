/**
 * Verification progress card — shows how many images have been verified.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
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
  const [selectedLabel, setSelectedLabel] = useState<string>('all');

  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'verification-progress', projectId, selectedLabel, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getVerificationProgress(projectId!, {
        label: selectedLabel === 'all' ? undefined : selectedLabel,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
      }),
    enabled: projectId !== undefined,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Verification progress</CardTitle>
          <Select
            value={selectedLabel}
            onValueChange={setSelectedLabel}
            className="w-36 h-9 text-sm"
          >
            <SelectItem value="all">All images</SelectItem>
            <SelectItem value="empty">Empty</SelectItem>
            <SelectItem value="person">Person</SelectItem>
            <SelectItem value="vehicle">Vehicle</SelectItem>
            {speciesList?.map((s) => (
              <SelectItem key={s.species} value={s.species}>
                {normalizeLabel(s.species)}
              </SelectItem>
            ))}
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
        ) : data ? (
          <div className="space-y-2">
            {/* Progress bar */}
            <div className="w-full h-4 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${data.percentage}%`,
                  backgroundColor: '#0f6064',
                }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {data.verified.toLocaleString()} of {data.total.toLocaleString()} images verified
              </span>
              <span className="font-medium">{data.percentage}%</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No data</p>
        )}
      </CardContent>
    </Card>
  );
};
