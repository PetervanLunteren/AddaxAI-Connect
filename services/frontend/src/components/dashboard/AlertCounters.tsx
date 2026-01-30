/**
 * Alert Counters - Display counts of person and vehicle detections
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Car, PawPrint } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';

export const AlertCounters: React.FC = () => {
  // Fetch pipeline status which includes person/vehicle/animal counts
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'pipeline-status'],
    queryFn: () => statisticsApi.getPipelineStatus(),
  });

  const counters = [
    {
      label: 'People',
      count: data?.person_count ?? 0,
      icon: User,
      bgColor: 'bg-orange-100',
      iconColor: 'text-orange-600',
    },
    {
      label: 'Vehicles',
      count: data?.vehicle_count ?? 0,
      icon: Car,
      bgColor: 'bg-red-100',
      iconColor: 'text-red-600',
    },
    {
      label: 'Animals',
      count: data?.animal_count ?? 0,
      icon: PawPrint,
      bgColor: 'bg-green-100',
      iconColor: 'text-green-600',
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Detection Categories</CardTitle>
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
          <div className="grid grid-cols-3 gap-4">
            {counters.map((counter) => (
              <div
                key={counter.label}
                className="flex flex-col items-center p-4 rounded-lg bg-muted/50"
              >
                <div className={`${counter.bgColor} ${counter.iconColor} p-3 rounded-full mb-2`}>
                  <counter.icon className="h-6 w-6" />
                </div>
                <p className="text-2xl font-bold">{counter.count.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">{counter.label}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
