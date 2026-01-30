/**
 * Camera Health Grid - Overview of camera status
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wifi, WifiOff, HelpCircle, Battery, BatteryLow, BatteryWarning } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { camerasApi } from '../../api/cameras';

export const CameraHealthGrid: React.FC = () => {
  // Fetch cameras list
  const { data: cameras, isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => camerasApi.getAll(),
  });

  // Sort cameras by status (inactive first to highlight problems)
  const sortedCameras = [...(cameras ?? [])].sort((a, b) => {
    const statusOrder = { inactive: 0, never_reported: 1, active: 2 };
    return (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Wifi className="h-4 w-4 text-green-600" />;
      case 'inactive':
        return <WifiOff className="h-4 w-4 text-red-600" />;
      default:
        return <HelpCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-50 border-green-200';
      case 'inactive':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getBatteryIcon = (percentage: number | null) => {
    if (percentage === null) return null;
    if (percentage < 20) return <BatteryLow className="h-4 w-4 text-red-600" />;
    if (percentage < 50) return <BatteryWarning className="h-4 w-4 text-orange-600" />;
    return <Battery className="h-4 w-4 text-green-600" />;
  };

  const formatLastReport = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const statusCounts = {
    active: cameras?.filter((c) => c.status === 'active').length ?? 0,
    inactive: cameras?.filter((c) => c.status === 'inactive').length ?? 0,
    never_reported: cameras?.filter((c) => c.status === 'never_reported').length ?? 0,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Camera Health</CardTitle>
        <p className="text-sm text-muted-foreground">
          {statusCounts.active} active, {statusCounts.inactive} inactive, {statusCounts.never_reported} never reported
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : cameras && cameras.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
            {sortedCameras.map((camera) => (
              <div
                key={camera.id}
                className={`p-2 rounded-lg border ${getStatusColor(camera.status)}`}
                title={`${camera.name}\nStatus: ${camera.status}\nLast report: ${camera.last_report_timestamp ?? 'Never'}${camera.battery_percentage !== null ? `\nBattery: ${camera.battery_percentage}%` : ''}`}
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(camera.status)}
                  <span className="text-xs font-medium truncate flex-1">
                    {camera.name}
                  </span>
                  {camera.battery_percentage !== null && getBatteryIcon(camera.battery_percentage)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatLastReport(camera.last_report_timestamp)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-48">
            <p className="text-muted-foreground">No cameras found</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
