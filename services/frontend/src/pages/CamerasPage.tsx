/**
 * Cameras page with health status table and management functionality
 *
 * All users can view camera health metrics.
 * Admins can add, edit, delete cameras and import from CSV.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Battery,
  ExternalLink,
  Camera as CameraIcon,
  HardDrive,
  Activity,
  Plus,
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/Dialog';
import { useProject } from '../contexts/ProjectContext';
import { CameraDetailSheet } from '../components/CameraDetailSheet';
import {
  camerasApi,
  type CreateCameraRequest,
  type BulkImportResponse,
} from '../api/cameras';
import type { Camera } from '../api/types';

export const CamerasPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedProject: currentProject, canAdminCurrentProject } = useProject();

  // Side panel state
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [showDetailSheet, setShowDetailSheet] = useState(false);

  // Add camera dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCameraIMEI, setNewCameraIMEI] = useState('');
  const [newCameraName, setNewCameraName] = useState('');
  const [newCameraSerialNumber, setNewCameraSerialNumber] = useState('');
  const [newCameraBox, setNewCameraBox] = useState('');
  const [newCameraOrder, setNewCameraOrder] = useState('');
  const [newCameraScannedDate, setNewCameraScannedDate] = useState('');
  const [newCameraFirmware, setNewCameraFirmware] = useState('');
  const [newCameraRemark, setNewCameraRemark] = useState('');
  const [newCameraHasSim, setNewCameraHasSim] = useState(false);
  const [newCameraImsi, setNewCameraImsi] = useState('');
  const [newCameraIccid, setNewCameraIccid] = useState('');

  // CSV Import state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<BulkImportResponse | null>(null);

  // Fetch cameras for current project
  const { data: cameras, isLoading } = useQuery({
    queryKey: ['cameras', currentProject?.id],
    queryFn: () => camerasApi.getAll(currentProject?.id),
    enabled: !!currentProject,
  });

  // Create camera mutation
  const createMutation = useMutation({
    mutationFn: camerasApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowAddDialog(false);
      resetAddForm();
    },
    onError: (error: any) => {
      alert(`Failed to create camera: ${error.response?.data?.detail || error.message}`);
    },
  });

  // CSV Import mutation
  const importMutation = useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId?: number }) =>
      camerasApi.importCSV(file, projectId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setImportResults(data);
      setCsvFile(null);
    },
    onError: (error: any) => {
      alert(`Failed to import CSV: ${error.response?.data?.detail || error.message}`);
    },
  });

  const resetAddForm = () => {
    setNewCameraIMEI('');
    setNewCameraName('');
    setNewCameraSerialNumber('');
    setNewCameraBox('');
    setNewCameraOrder('');
    setNewCameraScannedDate('');
    setNewCameraFirmware('');
    setNewCameraRemark('');
    setNewCameraHasSim(false);
    setNewCameraImsi('');
    setNewCameraIccid('');
  };

  const handleAddCamera = () => {
    if (!newCameraIMEI.trim()) {
      alert('IMEI is required');
      return;
    }
    if (!currentProject) {
      alert('Please select a project first');
      return;
    }

    const data: CreateCameraRequest = {
      imei: newCameraIMEI.trim(),
      friendly_name: newCameraName.trim() || undefined,
      serial_number: newCameraSerialNumber.trim() || undefined,
      box: newCameraBox.trim() || undefined,
      order: newCameraOrder.trim() || undefined,
      scanned_date: newCameraScannedDate.trim() || undefined,
      firmware: newCameraFirmware.trim() || undefined,
      remark: newCameraRemark.trim() || undefined,
      has_sim: newCameraHasSim || undefined,
      imsi: newCameraImsi.trim() || undefined,
      iccid: newCameraIccid.trim() || undefined,
      project_id: currentProject.id,
    };

    createMutation.mutate(data);
  };

  const handleImportCSV = () => {
    if (!csvFile) {
      alert('Please select a CSV file');
      return;
    }
    if (!currentProject) {
      alert('Please select a project first');
      return;
    }
    importMutation.mutate({ file: csvFile, projectId: currentProject.id });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
      setImportResults(null);
    }
  };

  const openImportDialog = () => {
    setCsvFile(null);
    setImportResults(null);
    setShowImportDialog(true);
  };

  const handleRowClick = (camera: Camera) => {
    setSelectedCamera(camera);
    setShowDetailSheet(true);
  };

  // Helper functions for formatting
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
    if (csq >= 15) return '#0f6064';
    if (csq >= 10) return '#71b7ba';
    return '#882000';
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

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view cameras.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header with title and admin actions */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-0">Cameras</h1>
          <p className="text-sm text-gray-600 mt-1">
            Monitor camera health, battery levels, and connectivity status
          </p>
        </div>
        {canAdminCurrentProject && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openImportDialog}>
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add camera
            </Button>
          </div>
        )}
      </div>

      {/* Summary Statistics */}
      {cameras && cameras.length > 0 && (() => {
        const activeCount = cameras.filter((c: Camera) => c.status === 'active').length;
        const inactiveCount = cameras.filter((c: Camera) => c.status === 'inactive').length;
        const neverReportedCount = cameras.filter((c: Camera) => c.status === 'never_reported').length;
        const total = cameras.length;
        const activePercent = (activeCount / total) * 100;
        const inactivePercent = (inactiveCount / total) * 100;
        const neverReportedPercent = (neverReportedCount / total) * 100;

        const camerasWithBattery = cameras.filter((c: Camera) => c.battery_percentage !== null);
        const avgBattery = camerasWithBattery.length > 0
          ? Math.round(camerasWithBattery.reduce((sum: number, c: Camera) => sum + (c.battery_percentage || 0), 0) / camerasWithBattery.length)
          : 0;

        const camerasWithSD = cameras.filter((c: Camera) => c.sd_utilization_percentage !== null);
        const avgSD = camerasWithSD.length > 0
          ? Math.round(camerasWithSD.reduce((sum: number, c: Camera) => sum + (c.sd_utilization_percentage || 0), 0) / camerasWithSD.length)
          : 0;

        return (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
            {/* Camera status bar */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <p className="text-sm font-medium text-muted-foreground mb-3">Camera status</p>
                    <div className="flex h-3 rounded-full overflow-hidden">
                      {activePercent > 0 && (
                        <div
                          className="cursor-default"
                          style={{ width: `${activePercent}%`, backgroundColor: '#0f6064' }}
                          title={`${activeCount} active`}
                        />
                      )}
                      {inactivePercent > 0 && (
                        <div
                          className="cursor-default"
                          style={{ width: `${inactivePercent}%`, backgroundColor: '#882000' }}
                          title={`${inactiveCount} inactive`}
                        />
                      )}
                      {neverReportedPercent > 0 && (
                        <div
                          className="cursor-default"
                          style={{ width: `${neverReportedPercent}%`, backgroundColor: '#71b7ba' }}
                          title={`${neverReportedCount} never reported`}
                        />
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                    <Activity className="h-6 w-6" style={{ color: '#0f6064' }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total cameras */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total cameras</p>
                    <p className="text-2xl font-bold mt-1">{total}</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#71b7ba20' }}>
                    <CameraIcon className="h-6 w-6" style={{ color: '#71b7ba' }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Average battery */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average battery</p>
                    <p className="text-2xl font-bold mt-1">{avgBattery}%</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                    <Battery className="h-6 w-6" style={{ color: '#0f6064' }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Average SD card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average SD card</p>
                    <p className="text-2xl font-bold mt-1">{avgSD}%</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#71b7ba20' }}>
                    <HardDrive className="h-6 w-6" style={{ color: '#71b7ba' }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Camera table */}
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
                    {canAdminCurrentProject && (
                      <TableHead>IMEI</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cameras.map((camera: Camera) => (
                    <TableRow
                      key={camera.id}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(camera)}
                    >
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
                          <span className="text-sm">{getSignalLabel(camera.signal_quality)}</span>
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
                          <span className="text-sm">{formatTimestamp(camera.last_report_timestamp)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getTimestampColor(camera.last_image_timestamp) }}
                          />
                          <span className="text-sm">{formatTimestamp(camera.last_image_timestamp)}</span>
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
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      {canAdminCurrentProject && (
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {camera.imei || '-'}
                        </TableCell>
                      )}
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

      {/* Camera Detail Side Panel */}
      <CameraDetailSheet
        camera={selectedCamera}
        isOpen={showDetailSheet}
        onClose={() => {
          setShowDetailSheet(false);
          setSelectedCamera(null);
        }}
        canAdmin={canAdminCurrentProject}
        projectId={currentProject?.id}
        onUpdate={(updatedCamera) => setSelectedCamera(updatedCamera)}
      />

      {/* Add Camera Dialog */}
      {canAdminCurrentProject && (
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent onClose={() => setShowAddDialog(false)}>
            <DialogHeader>
              <DialogTitle>Add camera</DialogTitle>
              <DialogDescription>
                Create a new camera for project: {currentProject?.name}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div>
                <label htmlFor="imei" className="block text-sm font-medium mb-2">
                  IMEI <span className="text-destructive">*</span>
                </label>
                <input
                  id="imei"
                  type="text"
                  value={newCameraIMEI}
                  onChange={(e) => setNewCameraIMEI(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., 860946063660255"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The camera's IMEI from EXIF SerialNumber field or daily report
                </p>
              </div>

              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2">
                  Friendly name (optional)
                </label>
                <input
                  id="name"
                  type="text"
                  value={newCameraName}
                  onChange={(e) => setNewCameraName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., Camera A - North Ridge"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to use IMEI as the display name
                </p>
              </div>

              <div>
                <label htmlFor="serial-number" className="block text-sm font-medium mb-2">
                  Serial number (optional)
                </label>
                <input
                  id="serial-number"
                  type="text"
                  value={newCameraSerialNumber}
                  onChange={(e) => setNewCameraSerialNumber(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., SN123456"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="box" className="block text-sm font-medium mb-2">
                    Box (optional)
                  </label>
                  <input
                    id="box"
                    type="text"
                    value={newCameraBox}
                    onChange={(e) => setNewCameraBox(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g., Box-A"
                  />
                </div>
                <div>
                  <label htmlFor="order" className="block text-sm font-medium mb-2">
                    Order (optional)
                  </label>
                  <input
                    id="order"
                    type="text"
                    value={newCameraOrder}
                    onChange={(e) => setNewCameraOrder(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g., Order-1"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="scanned-date" className="block text-sm font-medium mb-2">
                  Scanned date (optional)
                </label>
                <input
                  id="scanned-date"
                  type="date"
                  value={newCameraScannedDate}
                  onChange={(e) => setNewCameraScannedDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label htmlFor="firmware" className="block text-sm font-medium mb-2">
                  Firmware (optional)
                </label>
                <input
                  id="firmware"
                  type="text"
                  value={newCameraFirmware}
                  onChange={(e) => setNewCameraFirmware(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., 4TR1SPrFB06"
                />
              </div>

              <div>
                <label htmlFor="remark" className="block text-sm font-medium mb-2">
                  Remark (optional)
                </label>
                <textarea
                  id="remark"
                  value={newCameraRemark}
                  onChange={(e) => setNewCameraRemark(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Any additional notes"
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="has-sim"
                  type="checkbox"
                  checked={newCameraHasSim}
                  onChange={(e) => setNewCameraHasSim(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-2 focus:ring-ring"
                />
                <label htmlFor="has-sim" className="text-sm font-medium">
                  Has SIM card
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="imsi" className="block text-sm font-medium mb-2">
                    IMSI (optional)
                  </label>
                  <input
                    id="imsi"
                    type="text"
                    value={newCameraImsi}
                    onChange={(e) => setNewCameraImsi(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g., 204081234567890"
                  />
                </div>
                <div>
                  <label htmlFor="iccid" className="block text-sm font-medium mb-2">
                    ICCID (optional)
                  </label>
                  <input
                    id="iccid"
                    type="text"
                    value={newCameraIccid}
                    onChange={(e) => setNewCameraIccid(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g., 8931085125056164008"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddCamera}
                disabled={createMutation.isPending || !newCameraIMEI.trim()}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create camera
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* CSV Import Dialog */}
      {canAdminCurrentProject && (
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent onClose={() => setShowImportDialog(false)} className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Import cameras from CSV</DialogTitle>
              <DialogDescription>
                Upload a CSV file with camera information. Required: IMEI. Optional: FriendlyName,
                Serial, Box, Order, Scanned, Firmware, Remark, SIM, IMSI, ICCID. Date format:
                DD-MM-YYYY or YYYY-MM-DD. Delimiter auto-detected (comma or semicolon).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {!importResults ? (
                <>
                  <div>
                    <label htmlFor="csv-file" className="block text-sm font-medium mb-2">
                      CSV file
                    </label>
                    <input
                      id="csv-file"
                      type="file"
                      accept=".csv"
                      onChange={handleFileChange}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {csvFile && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>

                  <div className="bg-accent/50 p-4 rounded-md">
                    <p className="text-sm font-medium mb-2">CSV format example:</p>
                    <div className="text-xs bg-background p-3 rounded overflow-x-auto max-h-32">
                      <pre className="whitespace-nowrap">
                        IMEI;Serial;Order;Scanned;Firmware;Remark;SIM;IMSI;ICCID
                      </pre>
                      <pre className="whitespace-nowrap text-muted-foreground mt-1">
                        860946063660255;SY2511012122;WF13051-2;19-12-2025;4TR1SPrFB06;;TRUE;204081234567890;893108512...
                      </pre>
                      <pre className="whitespace-nowrap text-muted-foreground">
                        860946063660256;SY2511012127;WF13051-2;19-12-2025;4TR1SPrFB06;;TRUE;204081234567891;893108512...
                      </pre>
                    </div>
                    <div className="mt-3 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Delimiter: Comma or semicolon (auto-detected)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Date format: DD-MM-YYYY, YYYY-MM-DD, or Excel serial number
                      </p>
                      <p className="text-xs text-muted-foreground">
                        FriendlyName column optional (defaults to IMEI)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Only IMEI is required, all other fields are optional
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-accent/50 rounded-md">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Success: {importResults.success_count}</span>
                    </div>
                    {importResults.failed_count > 0 && (
                      <div className="flex items-center gap-2 text-destructive">
                        <XCircle className="h-5 w-5" />
                        <span className="font-medium">Failed: {importResults.failed_count}</span>
                      </div>
                    )}
                  </div>

                  <div className="max-h-96 overflow-y-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-accent border-b">
                        <tr>
                          <th className="text-left py-2 px-3">Row</th>
                          <th className="text-left py-2 px-3">IMEI</th>
                          <th className="text-left py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResults.results.map((result) => (
                          <tr key={result.row_number} className="border-b hover:bg-accent/50">
                            <td className="py-2 px-3">{result.row_number}</td>
                            <td className="py-2 px-3 font-mono text-xs">{result.imei}</td>
                            <td className="py-2 px-3">
                              {result.success ? (
                                <span className="inline-flex items-center gap-1 text-green-600">
                                  <CheckCircle className="h-4 w-4" />
                                  Success
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <XCircle className="h-4 w-4" />
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground">
                              {result.success ? `Camera ID: ${result.camera_id}` : result.error}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                {importResults ? 'Close' : 'Cancel'}
              </Button>
              {!importResults && (
                <Button onClick={handleImportCSV} disabled={importMutation.isPending || !csvFile}>
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Import
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
