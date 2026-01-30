/**
 * Occupancy Matrix - Heatmap showing species x camera detection counts
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import chroma from 'chroma-js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

interface OccupancyMatrixProps {
  dateRange: DateRange;
}

// Generate color scale from white to dark viridis
const colorScale = chroma.scale(['#f8f9fa', '#21918c', '#440154']).mode('lab');

function getCellColor(count: number, maxCount: number): string {
  if (count === 0) return '#f8f9fa'; // Light gray for empty cells
  const intensity = Math.sqrt(count / maxCount); // Square root for better color distribution
  return colorScale(intensity).hex();
}

function getTextColor(count: number, maxCount: number): string {
  if (count === 0) return '#6b7280'; // Gray for empty cells
  const intensity = Math.sqrt(count / maxCount);
  return intensity > 0.5 ? '#ffffff' : '#1f2937';
}

export const OccupancyMatrix: React.FC<OccupancyMatrixProps> = ({ dateRange }) => {
  // Fetch occupancy matrix data
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'occupancy-matrix', dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getOccupancyMatrix({
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
  });

  // Calculate max count for color scaling
  const maxCount = data?.matrix.reduce(
    (max, row) => Math.max(max, ...row),
    0
  ) ?? 1;

  const totalDetections = data?.matrix.reduce(
    (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + cell, 0),
    0
  ) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Species × Camera Occupancy</CardTitle>
        {data && (
          <p className="text-sm text-muted-foreground">
            {data.species.length} species across {data.cameras.length} cameras ({totalDetections.toLocaleString()} detections)
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : data && data.species.length > 0 && data.cameras.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-background p-1 text-left font-medium"></th>
                  {data.cameras.map((camera) => (
                    <th
                      key={camera}
                      className="p-1 text-center font-medium whitespace-nowrap"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', maxWidth: '24px' }}
                    >
                      {camera}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.species.map((species, speciesIdx) => (
                  <tr key={species}>
                    <td className="sticky left-0 bg-background p-1 font-medium whitespace-nowrap">
                      {normalizeLabel(species)}
                    </td>
                    {data.cameras.map((camera, cameraIdx) => {
                      const count = data.matrix[speciesIdx][cameraIdx];
                      return (
                        <td
                          key={`${species}-${camera}`}
                          className="p-1 text-center min-w-[24px]"
                          style={{
                            backgroundColor: getCellColor(count, maxCount),
                            color: getTextColor(count, maxCount),
                          }}
                          title={`${normalizeLabel(species)} at ${camera}: ${count} detection${count !== 1 ? 's' : ''}`}
                        >
                          {count > 0 ? count : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Color legend */}
            <div className="flex items-center justify-end gap-2 mt-3 text-xs text-muted-foreground">
              <span>0</span>
              <div className="flex">
                {Array.from({ length: 5 }, (_, i) => (
                  <div
                    key={i}
                    className="w-4 h-3"
                    style={{ backgroundColor: colorScale(i / 4).hex() }}
                  />
                ))}
              </div>
              <span>{maxCount}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">No occupancy data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
