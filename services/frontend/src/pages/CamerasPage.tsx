/**
 * Cameras page with health status table
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Battery, Signal } from 'lucide-react';
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
    const colors = {
      active: '#0f6064',
      inactive: '#882000',
      never_reported: '#71b7ba',
    };

    const labels = {
      active: 'Active',
      inactive: 'Inactive',
      never_reported: 'Never reported',
    };

    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: colors[status as keyof typeof colors] }}
        />
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  const getBatteryColor = (percentage: number | null) => {
    if (percentage === null) return '#9ca3af';
    if (percentage > 70) return '#0f6064';
    if (percentage > 40) return '#ff8945';
    return '#882000';
  };

  const getSignalColor = (quality: number | null) => {
    if (quality === null) return '#9ca3af';
    if (quality > 60) return '#0f6064';
    if (quality > 30) return '#ff8945';
    return '#882000';
  };

  const getSDColor = (spaceLeft: number | null) => {
    if (spaceLeft === null) return '#9ca3af';
    if (spaceLeft > 50) return '#0f6064';
    if (spaceLeft > 20) return '#ff8945';
    return '#882000';
  };

  const getTimestampColor = (timestamp: string | null) => {
    if (!timestamp) return '#9ca3af';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return '#0f6064';
    if (diffDays <= 7) return '#ff8945';
    return '#882000';
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Today';
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
                <TableHead>Battery</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>SD card</TableHead>
                <TableHead>Last report</TableHead>
                <TableHead>Last image</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cameras.map((camera: Camera) => (
                <TableRow key={camera.id}>
                  <TableCell className="font-medium">{camera.name}</TableCell>
                  <TableCell>{getStatusBadge(camera.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: getBatteryColor(camera.battery_percentage) }}
                      />
                      <span className="text-sm">
                        {camera.battery_percentage !== null
                          ? `${camera.battery_percentage}%`
                          : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: getSignalColor(camera.signal_quality) }}
                      />
                      <span className="text-sm">
                        {camera.signal_quality !== null ? `${camera.signal_quality}%` : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: getSDColor(camera.sd_utilization_percentage) }}
                      />
                      <span className="text-sm">
                        {camera.sd_utilization_percentage !== null
                          ? `${Math.round(camera.sd_utilization_percentage)}%`
                          : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: getTimestampColor(camera.last_report_timestamp) }}
                      />
                      <span className="text-sm">
                        {formatTimestamp(camera.last_report_timestamp)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: getTimestampColor(camera.last_image_timestamp) }}
                      />
                      <span className="text-sm">
                        {formatTimestamp(camera.last_image_timestamp)}
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
