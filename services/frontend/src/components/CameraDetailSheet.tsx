/**
 * Camera detail side panel
 *
 * Shows full camera details in a slide-out panel.
 * Edit and delete functionality available to admins only.
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Edit,
  Trash2,
  Loader2,
  ExternalLink,
  Battery,
  Signal,
  HardDrive,
  MapPin,
  Clock,
  Camera as CameraIcon,
  Thermometer,
  Save,
  X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from './ui/Sheet';
import { Button } from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { camerasApi, type UpdateCameraRequest } from '../api/cameras';
import type { Camera } from '../api/types';

interface CameraDetailSheetProps {
  camera: Camera | null;
  isOpen: boolean;
  onClose: () => void;
  canAdmin: boolean;
  projectId?: number;
}

export const CameraDetailSheet: React.FC<CameraDetailSheetProps> = ({
  camera,
  isOpen,
  onClose,
  canAdmin,
  projectId,
}) => {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState<UpdateCameraRequest>({});

  // Reset editing state when camera changes or sheet closes
  useEffect(() => {
    if (camera) {
      setEditForm({
        friendly_name: camera.name,
        serial_number: camera.serial_number || '',
        box: camera.box || '',
        order: camera.order || '',
        scanned_date: camera.scanned_date || '',
        firmware: camera.firmware || '',
        remark: camera.remark || '',
        has_sim: camera.has_sim || false,
        imsi: camera.imsi || '',
        iccid: camera.iccid || '',
      });
    }
    setIsEditing(false);
  }, [camera]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: UpdateCameraRequest) => camerasApi.update(camera!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setIsEditing(false);
    },
    onError: (error: any) => {
      alert(`Failed to update camera: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => camerasApi.delete(camera!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowDeleteDialog(false);
      onClose();
    },
    onError: (error: any) => {
      alert(`Failed to delete camera: ${error.response?.data?.detail || error.message}`);
    },
  });

  if (!camera) return null;

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  // Helper functions for formatting
  const getStatusColor = (status: string) => {
    const colors = {
      active: '#0f6064',
      inactive: '#882000',
      never_reported: '#71b7ba',
    };
    return colors[status as keyof typeof colors] || '#9ca3af';
  };

  const getStatusLabel = (status: string) => {
    const labels = {
      active: 'Active',
      inactive: 'Inactive',
      never_reported: 'Never reported',
    };
    return labels[status as keyof typeof labels] || status;
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

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getGoogleMapsUrl = (location: { lat: number; lon: number }) => {
    return `https://www.google.com/maps?q=${location.lat},${location.lon}`;
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent onClose={onClose}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CameraIcon className="h-5 w-5" />
              {camera.name}
            </SheetTitle>
          </SheetHeader>

          <SheetBody className="space-y-6">
            {/* Status section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Status</h3>
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getStatusColor(camera.status) }}
                />
                <span className="font-medium">{getStatusLabel(camera.status)}</span>
              </div>
            </div>

            {/* Health metrics section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Health metrics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Battery className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Battery:</span>
                  <span
                    className="text-sm font-medium"
                    style={{ color: getBatteryColor(camera.battery_percentage) }}
                  >
                    {camera.battery_percentage !== null ? `${camera.battery_percentage}%` : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Signal className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Signal:</span>
                  <span
                    className="text-sm font-medium"
                    style={{ color: getSignalColor(camera.signal_quality) }}
                  >
                    {getSignalLabel(camera.signal_quality)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">SD card:</span>
                  <span
                    className="text-sm font-medium"
                    style={{ color: getSDColor(camera.sd_utilization_percentage) }}
                  >
                    {camera.sd_utilization_percentage !== null
                      ? `${Math.round(camera.sd_utilization_percentage)}%`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Temp:</span>
                  <span className="text-sm font-medium">
                    {camera.temperature !== null ? `${camera.temperature}°C` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Timestamps section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Activity</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Last report:</span>
                  <span className="text-sm">{formatTimestamp(camera.last_report_timestamp)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CameraIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Last image:</span>
                  <span className="text-sm">{formatTimestamp(camera.last_image_timestamp)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CameraIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Total images:</span>
                  <span className="text-sm font-medium">{camera.total_images ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Location section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Location</h3>
              {camera.location ? (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {camera.location.lat.toFixed(6)}, {camera.location.lon.toFixed(6)}
                  </span>
                  <a
                    href={getGoogleMapsUrl(camera.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Unknown</span>
              )}
            </div>

            {/* Admin-only fields */}
            {canAdmin && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Administrative details
                </h3>
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground">Friendly name</label>
                      <input
                        type="text"
                        value={editForm.friendly_name || ''}
                        onChange={(e) => setEditForm({ ...editForm, friendly_name: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">IMEI</label>
                      <input
                        type="text"
                        value={camera.imei || ''}
                        disabled
                        className="w-full px-3 py-2 border rounded-md text-sm bg-muted"
                      />
                      <p className="text-xs text-muted-foreground mt-1">IMEI cannot be changed</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Serial number</label>
                      <input
                        type="text"
                        value={editForm.serial_number || ''}
                        onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Box</label>
                        <input
                          type="text"
                          value={editForm.box || ''}
                          onChange={(e) => setEditForm({ ...editForm, box: e.target.value })}
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Order</label>
                        <input
                          type="text"
                          value={editForm.order || ''}
                          onChange={(e) => setEditForm({ ...editForm, order: e.target.value })}
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Scanned date</label>
                      <input
                        type="date"
                        value={editForm.scanned_date || ''}
                        onChange={(e) => setEditForm({ ...editForm, scanned_date: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Firmware</label>
                      <input
                        type="text"
                        value={editForm.firmware || ''}
                        onChange={(e) => setEditForm({ ...editForm, firmware: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Remark</label>
                      <textarea
                        value={editForm.remark || ''}
                        onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="has-sim"
                        checked={editForm.has_sim || false}
                        onChange={(e) => setEditForm({ ...editForm, has_sim: e.target.checked })}
                        className="h-4 w-4"
                      />
                      <label htmlFor="has-sim" className="text-sm">Has SIM card</label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">IMSI</label>
                        <input
                          type="text"
                          value={editForm.imsi || ''}
                          onChange={(e) => setEditForm({ ...editForm, imsi: e.target.value })}
                          className="w-full px-3 py-2 border rounded-md text-sm font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">ICCID</label>
                        <input
                          type="text"
                          value={editForm.iccid || ''}
                          onChange={(e) => setEditForm({ ...editForm, iccid: e.target.value })}
                          className="w-full px-3 py-2 border rounded-md text-sm font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IMEI</span>
                      <span className="font-mono">{camera.imei || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Serial number</span>
                      <span>{camera.serial_number || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Box</span>
                      <span>{camera.box || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order</span>
                      <span>{camera.order || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Scanned date</span>
                      <span>
                        {camera.scanned_date
                          ? new Date(camera.scanned_date).toLocaleDateString()
                          : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Firmware</span>
                      <span>{camera.firmware || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remark</span>
                      <span className="max-w-[200px] truncate" title={camera.remark || ''}>
                        {camera.remark || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SIM card</span>
                      <span>{camera.has_sim ? 'Yes' : 'No'}</span>
                    </div>
                    {camera.has_sim && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">IMSI</span>
                          <span className="font-mono text-xs">{camera.imsi || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ICCID</span>
                          <span className="font-mono text-xs">{camera.iccid || '-'}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </SheetBody>

          {/* Admin actions footer */}
          {canAdmin && (
            <SheetFooter>
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(false)}
                    disabled={updateMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save changes
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                  <Button onClick={() => setIsEditing(true)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </>
              )}
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent onClose={() => setShowDeleteDialog(false)}>
          <DialogHeader>
            <DialogTitle>Delete camera</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete camera "{camera.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
