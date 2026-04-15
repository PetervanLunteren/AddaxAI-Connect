/**
 * Camera detail side panel
 *
 * Shows full camera details in a slide-out panel with tabs:
 * - Notes: Friendly name and remarks (all users, editable by admins)
 * - Overview: Status, health metrics, activity, location (all users)
 * - History: Health history charts (all users)
 * - Details: Administrative info like camera ID, serial, SIM (admins only)
 * - Actions: Delete camera and other admin actions (server admins only)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import {
  Edit,
  Trash2,
  Loader2,
  ExternalLink,
  Camera as CameraIcon,
  Save,
  X,
  Plus,
  XCircle,
  Upload,
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
import { TagInput } from './TagInput';
import { camerasApi, type UpdateCameraRequest } from '../api/cameras';
import type { Camera } from '../api/types';
import { cn } from '../lib/utils';
import { formatDateTime } from '../utils/datetime';

interface CameraDetailSheetProps {
  camera: Camera | null;
  isOpen: boolean;
  onClose: () => void;
  canAdmin: boolean;
  isServerAdmin: boolean;
  projectId?: number;
  onUpdate?: (updatedCamera: Camera) => void;
}

type TabType = 'overview' | 'history' | 'details' | 'notes' | 'actions';

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
  const [activeTab, setActiveTab] = useState<TabType>('notes');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  // Edit form state
  const [editForm, setEditForm] = useState<UpdateCameraRequest>({});
  const [metadataFields, setMetadataFields] = useState<{key: string, value: string}[]>([]);
  const [editTags, setEditTags] = useState<string[]>([]);

  // Fetch tag suggestions for autocomplete
  const { data: tagSuggestions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
    enabled: isOpen && projectId !== undefined,
  });

  // Reset editing state and tab when camera changes or sheet closes
  useEffect(() => {
    if (camera) {
      setEditForm({
        friendly_name: camera.name,
        notes: camera.notes || '',
      });
      // Initialize metadata fields from camera.custom_fields
      const meta = camera.custom_fields || {};
      setMetadataFields(
        Object.entries(meta).map(([key, value]) => ({ key, value: value || '' }))
      );
      setEditTags(camera.tags || []);
    }
    setIsEditing(false);
    setActiveTab('notes');
  }, [camera]);

  // Check if notes have been modified
  const tagsChanged = camera && (
    JSON.stringify(editTags) !== JSON.stringify(camera.tags || [])
  );
  const notesModified = camera && (
    editForm.friendly_name !== camera.name ||
    editForm.notes !== (camera.notes || '') ||
    tagsChanged
  );

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: UpdateCameraRequest) => camerasApi.update(camera!.id, data),
    onSuccess: (updatedCamera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['camera-tags'] });
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

  // Reference image mutations
  const uploadReferenceMutation = useMutation({
    mutationFn: (file: File) => camerasApi.uploadReferenceImage(camera!.id, file),
    onSuccess: (updatedCamera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setReferenceError(null);
      onUpdate?.(updatedCamera);
    },
    onError: (error: any) => {
      setReferenceError(error.response?.data?.detail || error.message || 'Upload failed');
    },
  });

  const deleteReferenceMutation = useMutation({
    mutationFn: () => camerasApi.deleteReferenceImage(camera!.id),
    onSuccess: (updatedCamera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setLightboxOpen(false);
      setReferenceError(null);
      onUpdate?.(updatedCamera);
    },
    onError: (error: any) => {
      setReferenceError(error.response?.data?.detail || error.message || 'Delete failed');
    },
  });

  const onReferenceDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setReferenceError('Image must be less than 5MB');
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setReferenceError('Image must be JPEG or PNG');
      return;
    }
    setReferenceError(null);
    uploadReferenceMutation.mutate(file);
  }, [uploadReferenceMutation]);

  const {
    getRootProps: getReferenceRootProps,
    getInputProps: getReferenceInputProps,
    isDragActive: isReferenceDragActive,
  } = useDropzone({
    onDrop: onReferenceDrop,
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] },
    maxFiles: 1,
    multiple: false,
    disabled: !canAdmin,
  });

  if (!camera) return null;

  const handleSave = () => {
    const cleanedData: UpdateCameraRequest = {};

    if (editForm.friendly_name) cleanedData.friendly_name = editForm.friendly_name;
    if (editForm.notes !== undefined) cleanedData.notes = editForm.notes || '';

    // Build custom_fields from key-value fields
    const custom_fields: Record<string, string> = {};
    for (const field of metadataFields) {
      const key = field.key.trim();
      const value = field.value.trim();
      if (key && value) {
        custom_fields[key] = value;
      }
    }
    cleanedData.custom_fields = custom_fields;
    cleanedData.tags = editTags;

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

  // Check if footer should be shown (only on Details tab for server admins who can edit)
  const showFooter = isServerAdmin && activeTab === 'details';

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
              <TabButton tab="notes" label="Notes" />
              <TabButton tab="overview" label="Overview" />
              <TabButton tab="history" label="History" />
              {canAdmin && <TabButton tab="details" label="Details" />}
              {isServerAdmin && <TabButton tab="actions" label="Actions" />}
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
                  <span className="text-muted-foreground">SD used</span>
                  <span>
                    {camera.sd_utilization_percentage !== null
                      ? `${Math.round(camera.sd_utilization_percentage)}%`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total images</span>
                  <span>{camera.total_images ?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Images sent today</span>
                  <span>{camera.sent_images ?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last report</span>
                  <span>{formatDateTime(camera.last_report_timestamp, 'Never')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last image</span>
                  <span>{formatDateTime(camera.last_image_timestamp, 'Never')}</span>
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
                      <label className="text-xs text-muted-foreground">Camera ID</label>
                      <input
                        type="text"
                        value={camera.device_id || ''}
                        disabled
                        className="w-full px-3 py-2 border rounded-md text-sm bg-muted"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Camera ID cannot be changed</p>
                    </div>

                    {/* Editable metadata key-value fields */}
                    {metadataFields.length > 0 && (
                      <div className="space-y-2">
                        {metadataFields.map((field, index) => (
                          <div key={index} className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={field.key}
                              onChange={(e) => {
                                const updated = [...metadataFields];
                                updated[index] = { ...updated[index], key: e.target.value };
                                setMetadataFields(updated);
                              }}
                              className="w-1/3 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              placeholder="Key"
                            />
                            <input
                              type="text"
                              value={field.value}
                              onChange={(e) => {
                                const updated = [...metadataFields];
                                updated[index] = { ...updated[index], value: e.target.value };
                                setMetadataFields(updated);
                              }}
                              className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              placeholder="Value"
                            />
                            <button
                              type="button"
                              onClick={() => setMetadataFields(metadataFields.filter((_, i) => i !== index))}
                              className="p-2 text-muted-foreground hover:text-destructive rounded-md hover:bg-accent"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMetadataFields([...metadataFields, { key: '', value: '' }])}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add field
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Camera ID</span>
                      <span className="font-mono text-xs">{camera.device_id || '-'}</span>
                    </div>
                    {camera.custom_fields && Object.keys(camera.custom_fields).length > 0 ? (
                      Object.entries(camera.custom_fields).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-muted-foreground">{key}</span>
                          <span>{value || '-'}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm mt-2">No additional details</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes tab (visible to all, editable by admins) */}
            {activeTab === 'notes' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground">Friendly name</label>
                  <input
                    type="text"
                    value={editForm.friendly_name || ''}
                    onChange={(e) => setEditForm({ ...editForm, friendly_name: e.target.value })}
                    disabled={!canAdmin}
                    className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Remarks</label>
                  <textarea
                    value={editForm.notes || ''}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    disabled={!canAdmin}
                    className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
                    rows={4}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Tags</label>
                  {canAdmin ? (
                    <TagInput
                      value={editTags}
                      onChange={setEditTags}
                      suggestions={tagSuggestions ?? []}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1.5 min-h-[2.5rem] px-3 py-1.5">
                      {editTags.length > 0 ? editTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground"
                        >
                          {tag}
                        </span>
                      )) : (
                        <span className="text-sm text-muted-foreground">No tags</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Reference image</label>
                  {camera.reference_thumbnail_url ? (
                    <div className="relative mt-1">
                      <img
                        src={camera.reference_thumbnail_url}
                        alt="Camera reference"
                        className="w-full h-48 object-cover rounded-md border cursor-zoom-in"
                        onClick={() => setLightboxOpen(true)}
                      />
                      {canAdmin && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => deleteReferenceMutation.mutate()}
                          disabled={deleteReferenceMutation.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ) : canAdmin ? (
                    <div
                      {...getReferenceRootProps()}
                      className={`mt-1 border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
                        isReferenceDragActive ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/50'
                      }`}
                    >
                      <input {...getReferenceInputProps()} />
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {isReferenceDragActive ? 'Drop image here' : 'Drag and drop an image, or click to select'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPEG or PNG, max 5MB
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">No reference image</p>
                  )}
                  {uploadReferenceMutation.isPending && (
                    <p className="text-xs text-muted-foreground mt-1">Uploading...</p>
                  )}
                  {referenceError && (
                    <p className="text-xs text-destructive mt-1">{referenceError}</p>
                  )}
                </div>
                {notesModified && canAdmin && (
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

            {/* Actions tab (server admins only) */}
            {activeTab === 'actions' && isServerAdmin && (
              <div className="space-y-4">
                <div className="p-4 border border-destructive/20 rounded-lg bg-destructive/5">
                  <h4 className="text-sm font-medium text-destructive mb-2">Danger zone</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Deleting a camera will remove all associated data. This action cannot be undone.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete camera
                  </Button>
                </div>
              </div>
            )}
          </SheetBody>

          {/* Admin actions footer - only show on Details tab for server admins */}
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
                <Button onClick={() => setIsEditing(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
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

      {/* Reference image lightbox */}
      {lightboxOpen && camera.reference_image_url && (
        <Dialog open={lightboxOpen} onOpenChange={(open) => !open && setLightboxOpen(false)}>
          <DialogContent
            onClose={() => setLightboxOpen(false)}
            className="max-w-6xl"
          >
            <img
              src={camera.reference_image_url}
              alt="Camera reference, full size"
              className="w-full max-h-[85vh] object-contain rounded-md"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
