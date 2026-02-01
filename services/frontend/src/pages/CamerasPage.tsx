/**
 * Cameras page with health status table
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Battery, Thermometer, Signal, HardDrive, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import { camerasApi } from '../api/cameras';
import type { Camera } from '../api/types';

export const CamerasPage: React.FC = () => {
  const { data: cameras, isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => camerasApi.getAll(),
  });

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'border-[#0f6064]',
      inactive: 'border-[#882000]',
      never_reported: 'border-[#71b7ba]',
    };

    const bgColors = {
      active: { backgroundColor: '#0f606420', color: '#0f6064' },
      inactive: { backgroundColor: '#88200020', color: '#882000' },
      never_reported: { backgroundColor: '#71b7ba20', color: '#71b7ba' },
    };

    const labels = {
      active: 'Active',
      inactive: 'Inactive',
      never_reported: 'Never reported',
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
          styles[status as keyof typeof styles]
        }`}
        style={bgColors[status as keyof typeof bgColors]}
      >
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  const getBatteryColor = (percentage: number | null) => {
    if (percentage === null) return 'text-gray-400';
    if (percentage > 50) return 'text-[#0f6064]';
    if (percentage > 20) return 'text-[#ff8945]';
    return 'text-[#882000]';
  };

  const getSignalColor = (quality: number | null) => {
    if (quality === null) return 'text-gray-400';
    if (quality > 70) return 'text-[#0f6064]';
    if (quality > 40) return 'text-[#ff8945]';
    return 'text-[#882000]';
  };

  const getSDColor = (utilization: number | null) => {
    if (utilization === null) return 'text-gray-400';
    if (utilization < 70) return 'text-[#0f6064]';
    if (utilization < 90) return 'text-[#ff8945]';
    return 'text-[#882000]';
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const formatLocation = (location: { lat: number; lon: number } | null) => {
    if (!location) return 'Unknown';
    return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-0">
        <h1 className="text-2xl font-bold mb-0">Cameras</h1>
        <div className="text-sm text-muted-foreground">
          {cameras ? `${cameras.length} camera${cameras.length !== 1 ? 's' : ''} registered` : ''}
        </div>
      </div>
      <p className="text-sm text-gray-600 mt-1 mb-6">Monitor camera health, battery levels, and connectivity status</p>

      {/* Summary Statistics */}
      {cameras && cameras.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3 mb-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active cameras</p>
                  <p className="text-2xl font-bold mt-1">
                    {cameras.filter((c: Camera) => c.status === 'active').length}
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                  <Signal className="h-6 w-6" style={{ color: '#0f6064' }} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Inactive cameras</p>
                  <p className="text-2xl font-bold mt-1">
                    {cameras.filter((c: Camera) => c.status === 'inactive').length}
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#88200020' }}>
                  <Signal className="h-6 w-6" style={{ color: '#882000' }} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Average battery</p>
                  <p className="text-2xl font-bold mt-1">
                    {Math.round(
                      cameras
                        .filter((c: Camera) => c.battery_percentage !== null)
                        .reduce((sum: number, c: Camera) => sum + (c.battery_percentage || 0), 0) /
                        cameras.filter((c: Camera) => c.battery_percentage !== null).length || 0
                    )}
                    %
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#71b7ba20' }}>
                  <Battery className="h-6 w-6" style={{ color: '#71b7ba' }} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Loading cameras...</p>
        </div>
      ) : cameras && cameras.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Battery</TableHead>
                <TableHead className="text-center">Signal</TableHead>
                <TableHead className="text-center">SD card</TableHead>
                <TableHead className="text-center">Temperature</TableHead>
                <TableHead>Last update</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cameras.map((camera: Camera) => (
                <TableRow key={camera.id}>
                  <TableCell className="font-medium">{camera.name}</TableCell>
                  <TableCell>{getStatusBadge(camera.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Battery
                        className={`h-4 w-4 ${getBatteryColor(camera.battery_percentage)}`}
                      />
                      <span className="text-sm">
                        {camera.battery_percentage !== null
                          ? `${camera.battery_percentage}%`
                          : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Signal
                        className={`h-4 w-4 ${getSignalColor(camera.signal_quality)}`}
                      />
                      <span className="text-sm">
                        {camera.signal_quality !== null ? `${camera.signal_quality}%` : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <HardDrive
                        className={`h-4 w-4 ${getSDColor(camera.sd_utilization_percentage)}`}
                      />
                      <span className="text-sm">
                        {camera.sd_utilization_percentage !== null
                          ? `${camera.sd_utilization_percentage}%`
                          : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Thermometer className="h-4 w-4 text-gray-600" />
                      <span className="text-sm">
                        {camera.temperature !== null ? `${camera.temperature}°C` : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 text-gray-600" />
                      <span className="text-sm">
                        {formatTimestamp(camera.last_report_timestamp)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4 text-gray-600" />
                      <span className="text-sm">{formatLocation(camera.location)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">No cameras registered yet.</p>
        </div>
      )}
    </div>
  );
};
