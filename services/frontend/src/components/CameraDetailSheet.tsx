/**
 * Camera detail side panel
 *
 * Shows full camera details in a slide-out panel with 4 tabs:
 * - Notes: Friendly name and remarks (admins only, first tab)
 * - Overview: Status, health metrics, activity, location (all users)
 * - History: Health history charts (all users)
 * - Details: Administrative info like IMEI, serial, SIM (admins only)
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Edit,
  Trash2,
  Loader2,
  ExternalLink,
  Camera as CameraIcon,
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
import { CameraHealthHistoryChart } from './CameraHealthHistoryChart';
import { camerasApi, type UpdateCameraRequest } from '../api/cameras';
import type { Camera } from '../api/types';
import { cn } from '../lib/utils';

interface CameraDetailSheetProps {
  camera: Camera | null;
  isOpen: boolean;
  onClose: () => void;
  canAdmin: boolean;
  isServerAdmin: boolean;
  projectId?: number;
  onUpdate?: (updatedCamera: Camera) => void;
}

type TabType = 'overview' | 'history' | 'details' | 'notes';

export const CameraDetailSheet: React.FC<CameraDetailSheetProps> = ({
  camera,
  isOpen,
  onClose,
  canAdmin,
  isServerAdmin,
  projectId,
  onUpdate,
}) => {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>(canAdmin ? 'notes' : 'overview');

  // Edit form state
  const [editForm, setEditForm] = useState<UpdateCameraRequest>({});

  // Reset editing state and tab when camera changes or sheet closes
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
    setActiveTab(canAdmin ? 'notes' : 'overview');
  }, [camera, canAdmin]);

  // Check if notes have been modified
  const notesModified = camera && (
    editForm.friendly_name !== camera.name ||
    editForm.remark !== (camera.remark || '')
  );

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: UpdateCameraRequest) => camerasApi.update(camera!.id, data),
    onSuccess: (updatedCamera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setIsEditing(false);
      onUpdate?.(updatedCamera);
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
    // Clean up empty strings - backend expects null/undefined, not empty strings
    const cleanedData: UpdateCameraRequest = {};

    if (editForm.friendly_name) cleanedData.friendly_name = editForm.friendly_name;
    if (editForm.serial_number) cleanedData.serial_number = editForm.serial_number;
    if (editForm.box) cleanedData.box = editForm.box;
    if (editForm.order) cleanedData.order = editForm.order;
    if (editForm.scanned_date) cleanedData.scanned_date = editForm.scanned_date;
    if (editForm.firmware) cleanedData.firmware = editForm.firmware;
    if (editForm.remark) cleanedData.remark = editForm.remark;
    if (typeof editForm.has_sim === 'boolean') cleanedData.has_sim = editForm.has_sim;
    if (editForm.imsi) cleanedData.imsi = editForm.imsi;
    if (editForm.iccid) cleanedData.iccid = editForm.iccid;

    updateMutation.mutate(cleanedData);
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

  const getSignalLabel = (csq: number | null) => {
    if (csq === null) return 'N/A';
    if (csq >= 20) return 'Excellent';
    if (csq >= 15) return 'Good';
    if (csq >= 10) return 'Fair';
    if (csq >= 2) return 'Poor';
    return 'No signal';
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getGoogleMapsUrl = (location: { lat: number; lon: number }) => {
    return `https://www.google.com/maps?q=${location.lat},${location.lon}`;
  };

  // Tab button helper
  const TabButton = ({ tab, label }: { tab: TabType; label: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        activeTab === tab
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  );

  // Check if footer should be shown (only on Details tab for admins)
  const showFooter = canAdmin && activeTab === 'details';

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
            {/* Tab navigation */}
            <div className="flex border-b -mt-2">
              {canAdmin && <TabButton tab="notes" label="Notes" />}
              <TabButton tab="overview" label="Overview" />
              <TabButton tab="history" label="History" />
              {canAdmin && <TabButton tab="details" label="Details" />}
            </div>

            {/* Overview tab */}
            {activeTab === 'overview' && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: getStatusColor(camera.status) }}
                    />
                    <span>{getStatusLabel(camera.status)}</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Battery</span>
                  <span>
                    {camera.battery_percentage !== null ? `${camera.battery_percentage}%` : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signal</span>
                  <span>{getSignalLabel(camera.signal_quality)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SD card</span>
                  <span>
                    {camera.sd_utilization_percentage !== null
                      ? `${Math.round(camera.sd_utilization_percentage)}%`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last report</span>
                  <span>{formatTimestamp(camera.last_report_timestamp)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last image</span>
                  <span>{formatTimestamp(camera.last_image_timestamp)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Images on SD card</span>
                  <span>{camera.total_images ?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  {camera.location ? (
                    <span className="flex items-center gap-1">
                      {camera.location.lat.toFixed(6)}, {camera.location.lon.toFixed(6)}
                      <a
                        href={getGoogleMapsUrl(camera.location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </span>
                  ) : (
                    <span>Unknown</span>
                  )}
                </div>
              </div>
            )}

            {/* History tab */}
            {activeTab === 'history' && (
              <CameraHealthHistoryChart cameraId={camera.id} />
            )}

            {/* Details tab (admins only) */}
            {activeTab === 'details' && canAdmin && (
              <div>
                {isEditing && isServerAdmin ? (
                  <div className="space-y-3">
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
                      <span className="font-mono text-xs">{camera.imei || '-'}</span>
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

            {/* Notes tab (admins only) */}
            {activeTab === 'notes' && canAdmin && (
              <div className="space-y-4">
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
                  <label className="text-xs text-muted-foreground">Remarks</label>
                  <textarea
                    value={editForm.remark || ''}
                    onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    rows={4}
                  />
                </div>
                {notesModified && (
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    className="w-full"
                  >
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
                )}
              </div>
            )}
          </SheetBody>

          {/* Admin actions footer - only show on Details and Notes tabs */}
          {showFooter && (
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
