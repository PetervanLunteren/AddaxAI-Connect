/**
 * Detection Categories - Display counts by detection type
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Car, PawPrint, ImageOff } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';

export const AlertCounters: React.FC = () => {
  // Fetch pipeline status which includes detection category counts
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'pipeline-status'],
    queryFn: () => statisticsApi.getPipelineStatus(),
  });

  // Colors from FRONTEND_CONVENTIONS.md color palette for distinct values
  const counters = [
    {
      label: 'Animals',
      count: data?.animal_count ?? 0,
      icon: PawPrint,
      color: '#0f6064',
    },
    {
      label: 'People',
      count: data?.person_count ?? 0,
      icon: User,
      color: '#ff8945',
    },
    {
      label: 'Vehicles',
      count: data?.vehicle_count ?? 0,
      icon: Car,
      color: '#71b7ba',
    },
    {
      label: 'Empties',
      count: data?.empty_count ?? 0,
      icon: ImageOff,
      color: '#882000',
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Detection categories</CardTitle>
        <p className="text-sm text-muted-foreground">
          Breakdown by detection type
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {counters.map((counter) => (
              <div
                key={counter.label}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
              >
                <div
                  className="p-2 rounded-full"
                  style={{ backgroundColor: `${counter.color}20` }}
                >
                  <counter.icon className="h-5 w-5" style={{ color: counter.color }} />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">{counter.label}</p>
                </div>
                <p className="text-xl font-bold">{counter.count.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
