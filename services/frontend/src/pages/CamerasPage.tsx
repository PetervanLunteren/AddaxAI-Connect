/**
 * Cameras page with health status table
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Battery, Signal, ExternalLink } from 'lucide-react';
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
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: colors[status as keyof typeof colors] }}
        />
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  const getBatteryColor = (percentage: number | null) => {
    if (percentage === null) return '#9ca3af';
    if (percentage > 70) return '#0f6064';
    if (percentage > 40) return '#71b7ba';
    return '#882000';
  };

  const getSignalLabel = (csq: number | null) => {
    if (csq === null) return 'N/A';
    if (csq >= 20) return 'Excellent';
    if (csq >= 15) return 'Good';
    if (csq >= 10) return 'Fair';
    if (csq >= 2) return 'Poor';
    return 'No signal';
  };

  const getSignalColor = (csq: number | null) => {
    if (csq === null) return '#9ca3af';
    if (csq >= 15) return '#0f6064';  // Excellent or Good
    if (csq >= 10) return '#71b7ba';  // Fair
    return '#882000';                  // Poor or No signal
  };

  const getSDColor = (spaceLeft: number | null) => {
    if (spaceLeft === null) return '#9ca3af';
    if (spaceLeft > 50) return '#0f6064';
    if (spaceLeft > 20) return '#71b7ba';
    return '#882000';
  };

  const getTimestampColor = (timestamp: string | null) => {
    if (!timestamp) return '#9ca3af';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return '#0f6064';
    if (diffDays <= 7) return '#71b7ba';
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

  const getGoogleMapsUrl = (location: { lat: number; lon: number }) => {
    return `https://www.google.com/maps?q=${location.lat},${location.lon}`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Cameras</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Monitor camera health, battery levels, and connectivity status</p>

      {/* Summary Statistics */}
      {cameras && cameras.length > 0 && (() => {
        const activeCount = cameras.filter((c: Camera) => c.status === 'active').length;
        const inactiveCount = cameras.filter((c: Camera) => c.status === 'inactive').length;
        const neverReportedCount = cameras.filter((c: Camera) => c.status === 'never_reported').length;
        const total = cameras.length;
        const activePercent = (activeCount / total) * 100;
        const inactivePercent = (inactiveCount / total) * 100;
        const neverReportedPercent = (neverReportedCount / total) * 100;

        return (
          <div className="grid gap-6 md:grid-cols-3 mb-6">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-3">Camera status</p>
                <div className="flex h-3 rounded-full overflow-hidden">
                  {activePercent > 0 && (
                    <div
                      style={{ width: `${activePercent}%`, backgroundColor: '#0f6064' }}
                      title={`Active: ${activeCount}`}
                    />
                  )}
                  {inactivePercent > 0 && (
                    <div
                      style={{ width: `${inactivePercent}%`, backgroundColor: '#882000' }}
                      title={`Inactive: ${inactiveCount}`}
                    />
                  )}
                  {neverReportedPercent > 0 && (
                    <div
                      style={{ width: `${neverReportedPercent}%`, backgroundColor: '#71b7ba' }}
                      title={`Never reported: ${neverReportedCount}`}
                    />
                  )}
                </div>
                <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                  {activeCount > 0 && <span style={{ color: '#0f6064' }}>{activeCount} active</span>}
                  {inactiveCount > 0 && <span style={{ color: '#882000' }}>{inactiveCount} inactive</span>}
                  {neverReportedCount > 0 && <span style={{ color: '#71b7ba' }}>{neverReportedCount} never reported</span>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Inactive cameras</p>
                    <p className="text-2xl font-bold mt-1">
                      {inactiveCount}
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
        );
      })()}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Loading cameras...</p>
        </div>
      ) : cameras && cameras.length > 0 ? (
        <Card>
          <CardContent className="p-0">
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
                        className="w-3 h-3 rounded-full"
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
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getSignalColor(camera.signal_quality) }}
                      />
                      <span className="text-sm">
                        {getSignalLabel(camera.signal_quality)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded-full"
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
                        className="w-3 h-3 rounded-full"
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
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getTimestampColor(camera.last_image_timestamp) }}
                      />
                      <span className="text-sm">
                        {formatTimestamp(camera.last_image_timestamp)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: camera.location ? '#0f6064' : '#882000' }}
                      />
                      <span className="text-sm">{camera.location ? 'Known' : 'Unknown'}</span>
                      {camera.location && (
                        <a
                          href={getGoogleMapsUrl(camera.location)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      ) : (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">No cameras registered yet.</p>
        </div>
      )}
    </div>
  );
};
