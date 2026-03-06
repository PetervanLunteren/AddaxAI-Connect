/**
 * Modal for managing camera groups (shared independence interval pools).
 *
 * Operates on local state only — changes are committed by the parent
 * component when the user clicks "Save changes" on the settings page.
 */
import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import type { CameraGroup, Camera } from '../api/types';

interface Props {
  groups: CameraGroup[];
  cameras: Camera[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupsChange: (groups: CameraGroup[]) => void;
}

let nextTempId = -1;

export const CameraGroupsModal: React.FC<Props> = ({ groups, cameras, open, onOpenChange, onGroupsChange }) => {
  // State
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingCameraIds, setEditingCameraIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

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

  const saveEditing = () => {
    if (editingGroupId === null) return;
    onGroupsChange(
      groups.map(g =>
        g.id === editingGroupId
          ? { ...g, name: editingName.trim(), camera_ids: editingCameraIds }
          : g
      )
    );
    setEditingGroupId(null);
  };

  const toggleCamera = (cameraId: number) => {
    setEditingCameraIds(prev =>
      prev.includes(cameraId) ? prev.filter(id => id !== cameraId) : [...prev, cameraId]
    );
  };

  const handleCreate = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const tempId = nextTempId--;
    const newGroup: CameraGroup = {
      id: tempId,
      name,
      camera_ids: [],
      created_at: new Date().toISOString(),
    };
    onGroupsChange([...groups, newGroup]);
    setNewGroupName('');
    setCreating(false);
  };

  const handleDelete = (groupId: number) => {
    onGroupsChange(groups.filter(g => g.id !== groupId));
    if (editingGroupId === groupId) setEditingGroupId(null);
  };

  const cameraName = (id: number) => cameras.find(c => c.id === id)?.name ?? `Camera ${id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Camera groups</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Cameras in the same group share an independence interval, merging detections of the same species across all cameras in the group.
          </p>
        </DialogHeader>

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
                      disabled={!editingName.trim()}
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
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(group.id)}
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
                disabled={!newGroupName.trim()}
              >
                Add
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
      </DialogContent>
    </Dialog>
  );
};
