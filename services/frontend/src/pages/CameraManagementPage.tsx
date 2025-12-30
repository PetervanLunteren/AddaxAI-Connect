/**
 * Camera Management Page (Superuser Only)
 *
 * Allows superusers to manually create and manage cameras for projects.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
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
import {
  getCameras,
  createCamera,
  updateCamera,
  deleteCamera,
  type Camera,
  type CreateCameraRequest,
  type UpdateCameraRequest,
} from '../api/camera-management';

export const CameraManagementPage: React.FC = () => {
  const { selectedProject: currentProject } = useProject();
  const queryClient = useQueryClient();

  // Modal state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  // Form state
  const [newCameraIMEI, setNewCameraIMEI] = useState('');
  const [newCameraName, setNewCameraName] = useState('');
  const [editCameraName, setEditCameraName] = useState('');

  // Fetch cameras for current project
  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras', currentProject?.id],
    queryFn: () => getCameras(currentProject?.id),
    enabled: !!currentProject,
  });

  // Create camera mutation
  const createMutation = useMutation({
    mutationFn: createCamera,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowAddDialog(false);
      setNewCameraIMEI('');
      setNewCameraName('');
    },
    onError: (error: any) => {
      alert(`Failed to create camera: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Update camera mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCameraRequest }) =>
      updateCamera(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowEditDialog(false);
      setSelectedCamera(null);
      setEditCameraName('');
    },
    onError: (error: any) => {
      alert(`Failed to update camera: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Delete camera mutation
  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowDeleteDialog(false);
      setSelectedCamera(null);
    },
    onError: (error: any) => {
      alert(`Failed to delete camera: ${error.response?.data?.detail || error.message}`);
    },
  });

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
      name: newCameraName.trim() || undefined,
      project_id: currentProject.id,
    };

    createMutation.mutate(data);
  };

  const handleEditCamera = () => {
    if (!selectedCamera) return;

    const data: UpdateCameraRequest = {
      name: editCameraName.trim() || undefined,
    };

    updateMutation.mutate({ id: selectedCamera.id, data });
  };

  const handleDeleteCamera = () => {
    if (!selectedCamera) return;
    deleteMutation.mutate(selectedCamera.id);
  };

  const openEditDialog = (camera: Camera) => {
    setSelectedCamera(camera);
    setEditCameraName(camera.name);
    setShowEditDialog(true);
  };

  const openDeleteDialog = (camera: Camera) => {
    setSelectedCamera(camera);
    setShowDeleteDialog(true);
  };

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to manage cameras.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Camera Management</h1>
          <p className="text-muted-foreground mt-1">
            Managing cameras for: <span className="font-medium">{currentProject.name}</span>
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Camera
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cameras</CardTitle>
          <CardDescription>
            Manually create and manage camera trap devices for this project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : cameras.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                No cameras found for this project. Add a camera to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">Name</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Images</th>
                    <th className="text-left py-3 px-4">Last Report</th>
                    <th className="text-right py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map((camera) => (
                    <tr key={camera.id} className="border-b hover:bg-accent/50">
                      <td className="py-3 px-4 font-medium">{camera.name}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                            camera.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : camera.status === 'inactive'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {camera.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {camera.total_images ? camera.total_images : 0}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-sm">
                        {camera.last_report_timestamp
                          ? new Date(camera.last_report_timestamp).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => openEditDialog(camera)}
                            className="p-2 hover:bg-accent rounded-md"
                            title="Edit camera"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openDeleteDialog(camera)}
                            className="p-2 hover:bg-destructive/10 text-destructive rounded-md"
                            title="Delete camera"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Camera Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent onClose={() => setShowAddDialog(false)}>
          <DialogHeader>
            <DialogTitle>Add Camera</DialogTitle>
            <DialogDescription>
              Create a new camera for project: {currentProject.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
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
                Display Name (optional)
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
                  Create Camera
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Camera Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent onClose={() => setShowEditDialog(false)}>
          <DialogHeader>
            <DialogTitle>Edit Camera</DialogTitle>
            <DialogDescription>Update camera display name</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label htmlFor="edit-name" className="block text-sm font-medium mb-2">
                Display Name
              </label>
              <input
                id="edit-name"
                type="text"
                value={editCameraName}
                onChange={(e) => setEditCameraName(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g., Camera A - North Ridge"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditCamera} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Camera Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent onClose={() => setShowDeleteDialog(false)}>
          <DialogHeader>
            <DialogTitle>Delete Camera</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete camera "{selectedCamera?.name}"? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCamera}
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
    </div>
  );
};
