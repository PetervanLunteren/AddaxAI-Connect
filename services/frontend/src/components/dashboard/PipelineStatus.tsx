/**
 * Pipeline Status - Show pending vs classified image counts
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, CheckCircle, Image } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';

export const PipelineStatus: React.FC = () => {
  // Fetch pipeline status
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'pipeline-status'],
    queryFn: () => statisticsApi.getPipelineStatus(),
  });

  const pendingCount = data?.pending ?? 0;
  const classifiedCount = data?.classified ?? 0;
  const totalImages = data?.total_images ?? 0;

  // Calculate progress percentage
  const progressPercent = totalImages > 0 ? (classifiedCount / totalImages) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Processing Pipeline</CardTitle>
        <p className="text-sm text-muted-foreground">
          Image classification status
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Classification Progress</span>
                <span className="font-medium">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Status counts */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Image className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-lg font-bold">{totalImages.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-lg font-bold">{classifiedCount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Classified</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Clock className="h-5 w-5 text-orange-600" />
                <div>
                  <p className="text-lg font-bold">{pendingCount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
