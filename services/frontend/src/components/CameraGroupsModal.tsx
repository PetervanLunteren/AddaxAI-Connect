/**
 * Modal for managing camera groups (shared independence interval pools).
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { cameraGroupsApi } from '../api/cameraGroups';
import { camerasApi } from '../api/cameras';
import type { CameraGroup, Camera } from '../api/types';

interface Props {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CameraGroupsModal: React.FC<Props> = ({ projectId, open, onOpenChange }) => {
  const queryClient = useQueryClient();

  // State
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingCameraIds, setEditingCameraIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

  // Queries
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['camera-groups', projectId],
    queryFn: () => cameraGroupsApi.list(projectId),
    enabled: open,
  });

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: open,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (name: string) => cameraGroupsApi.create(projectId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-groups', projectId] });
      setNewGroupName('');
      setCreating(false);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ groupId, name }: { groupId: number; name: string }) =>
      cameraGroupsApi.rename(projectId, groupId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-groups', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (groupId: number) => cameraGroupsApi.delete(projectId, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-groups', projectId] });
      if (editingGroupId !== null) setEditingGroupId(null);
    },
  });

  const setCamerasMutation = useMutation({
    mutationFn: ({ groupId, cameraIds }: { groupId: number; cameraIds: number[] }) =>
      cameraGroupsApi.setCameras(projectId, groupId, cameraIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['camera-groups', projectId] });
    },
  });

  // Reset edit state when modal closes
  useEffect(() => {
    if (!open) {
      setEditingGroupId(null);
      setCreating(false);
      setNewGroupName('');
    }
  }, [open]);

  // All camera IDs assigned to any group
  const assignedCameraIds = new Set(groups.flatMap(g => g.camera_ids));
  const ungroupedCameras = cameras.filter(c => !assignedCameraIds.has(c.id));

  // Camera IDs available when editing a specific group (ungrouped + already in this group)
  const availableCamerasForEdit = (groupId: number) => {
    const group = groups.find(g => g.id === groupId);
    const groupCameraIds = new Set(group?.camera_ids ?? []);
    return cameras.filter(c => !assignedCameraIds.has(c.id) || groupCameraIds.has(c.id));
  };

  const startEditing = (group: CameraGroup) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
    setEditingCameraIds([...group.camera_ids]);
  };

  const saveEditing = async () => {
    if (editingGroupId === null) return;
    const group = groups.find(g => g.id === editingGroupId);
    if (!group) return;

    if (editingName !== group.name) {
      await renameMutation.mutateAsync({ groupId: editingGroupId, name: editingName });
    }

    const oldIds = [...group.camera_ids].sort().join(',');
    const newIds = [...editingCameraIds].sort().join(',');
    if (oldIds !== newIds) {
      await setCamerasMutation.mutateAsync({ groupId: editingGroupId, cameraIds: editingCameraIds });
    }

    setEditingGroupId(null);
  };

  const toggleCamera = (cameraId: number) => {
    setEditingCameraIds(prev =>
      prev.includes(cameraId) ? prev.filter(id => id !== cameraId) : [...prev, cameraId]
    );
  };

  const handleCreate = () => {
    if (!newGroupName.trim()) return;
    createMutation.mutate(newGroupName.trim());
  };

  const cameraName = (id: number) => cameras.find(c => c.id === id)?.name ?? `Camera ${id}`;

  const isBusy = createMutation.isPending || renameMutation.isPending ||
    deleteMutation.isPending || setCamerasMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Camera groups</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Cameras in the same group share an independence interval, merging detections of the same species across all cameras in the group.
          </p>
        </DialogHeader>

        {groupsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Existing groups */}
            {groups.map(group => (
              <div key={group.id} className="border rounded-lg p-3">
                {editingGroupId === group.id ? (
                  /* Editing mode */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={saveEditing}
                        disabled={!editingName.trim() || isBusy}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingGroupId(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Camera checklist */}
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {availableCamerasForEdit(group.id).map(cam => (
                        <label key={cam.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                          <input
                            type="checkbox"
                            checked={editingCameraIds.includes(cam.id)}
                            onChange={() => toggleCamera(cam.id)}
                            className="rounded"
                          />
                          {cam.name}
                        </label>
                      ))}
                      {availableCamerasForEdit(group.id).length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No cameras available</p>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{group.name}</p>
                      {group.camera_ids.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {group.camera_ids.map(id => (
                            <span key={id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                              {cameraName(id)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">No cameras assigned</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing(group)}
                        disabled={isBusy}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(group.id)}
                        disabled={isBusy}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* New group input */}
            {creating ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                  placeholder="Group name"
                  className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!newGroupName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setCreating(false); setNewGroupName(''); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreating(true)}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                New group
              </Button>
            )}

            {/* Ungrouped cameras */}
            {ungroupedCameras.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Ungrouped cameras ({ungroupedCameras.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {ungroupedCameras.map(cam => (
                    <span key={cam.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted/50 text-muted-foreground">
                      {cam.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
