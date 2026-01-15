/**
 * Camera Management Page
 *
 * Allows project admins and server admins to manually create and manage cameras for projects.
 */
import React, { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Loader2, Upload, CheckCircle, XCircle } from 'lucide-react';
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
  importCamerasCSV,
  type Camera,
  type CreateCameraRequest,
  type UpdateCameraRequest,
  type BulkImportResponse,
} from '../api/camera-management';

export const CameraManagementPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject: currentProject, canAdminCurrentProject } = useProject();
  const queryClient = useQueryClient();

  // Redirect if user doesn't have admin access
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  // Modal state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  // CSV Import state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<BulkImportResponse | null>(null);

  // Form state - Add Camera
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

  // Form state - Edit Camera
  const [editCameraName, setEditCameraName] = useState('');
  const [editCameraSerialNumber, setEditCameraSerialNumber] = useState('');
  const [editCameraBox, setEditCameraBox] = useState('');
  const [editCameraOrder, setEditCameraOrder] = useState('');
  const [editCameraScannedDate, setEditCameraScannedDate] = useState('');
  const [editCameraFirmware, setEditCameraFirmware] = useState('');
  const [editCameraRemark, setEditCameraRemark] = useState('');
  const [editCameraHasSim, setEditCameraHasSim] = useState(false);
  const [editCameraImsi, setEditCameraImsi] = useState('');
  const [editCameraIccid, setEditCameraIccid] = useState('');

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
      setNewCameraSerialNumber('');
      setNewCameraBox('');
      setNewCameraOrder('');
      setNewCameraScannedDate('');
      setNewCameraFirmware('');
      setNewCameraRemark('');
      setNewCameraHasSim(false);
      setNewCameraImsi('');
      setNewCameraIccid('');
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
      setEditCameraSerialNumber('');
      setEditCameraBox('');
      setEditCameraOrder('');
      setEditCameraScannedDate('');
      setEditCameraFirmware('');
      setEditCameraRemark('');
      setEditCameraHasSim(false);
      setEditCameraImsi('');
      setEditCameraIccid('');
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

  // CSV Import mutation
  const importMutation = useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId?: number }) =>
      importCamerasCSV(file, projectId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setImportResults(data);
      setCsvFile(null);
    },
    onError: (error: any) => {
      alert(`Failed to import CSV: ${error.response?.data?.detail || error.message}`);
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

  const handleEditCamera = () => {
    if (!selectedCamera) return;

    const data: UpdateCameraRequest = {
      friendly_name: editCameraName.trim() || undefined,
      serial_number: editCameraSerialNumber.trim() || undefined,
      box: editCameraBox.trim() || undefined,
      order: editCameraOrder.trim() || undefined,
      scanned_date: editCameraScannedDate.trim() || undefined,
      firmware: editCameraFirmware.trim() || undefined,
      remark: editCameraRemark.trim() || undefined,
      has_sim: editCameraHasSim || undefined,
      imsi: editCameraImsi.trim() || undefined,
      iccid: editCameraIccid.trim() || undefined,
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
    setEditCameraSerialNumber(camera.serial_number || '');
    setEditCameraBox(camera.box || '');
    setEditCameraOrder(camera.order || '');
    setEditCameraScannedDate(camera.scanned_date || '');
    setEditCameraFirmware(camera.firmware || '');
    setEditCameraRemark(camera.remark || '');
    setEditCameraHasSim(camera.has_sim || false);
    setEditCameraImsi(camera.imsi || '');
    setEditCameraIccid(camera.iccid || '');
    setShowEditDialog(true);
  };

  const openDeleteDialog = (camera: Camera) => {
    setSelectedCamera(camera);
    setShowDeleteDialog(true);
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
      setImportResults(null);  // Clear previous results
    }
  };

  const openImportDialog = () => {
    setCsvFile(null);
    setImportResults(null);
    setShowImportDialog(true);
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={openImportDialog}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Camera
          </Button>
        </div>
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
                    <th className="text-left py-3 px-4">IMEI</th>
                    <th className="text-left py-3 px-4">Serial Number</th>
                    <th className="text-left py-3 px-4">Box</th>
                    <th className="text-left py-3 px-4">Order</th>
                    <th className="text-left py-3 px-4">Scanned Date</th>
                    <th className="text-left py-3 px-4">Firmware</th>
                    <th className="text-left py-3 px-4">Remark</th>
                    <th className="text-left py-3 px-4">SIM</th>
                    <th className="text-left py-3 px-4">IMSI</th>
                    <th className="text-left py-3 px-4">ICCID</th>
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
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {camera.imei || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {camera.serial_number || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {camera.box || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {camera.order || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {camera.scanned_date
                          ? new Date(camera.scanned_date).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {camera.firmware || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground max-w-xs truncate" title={camera.remark || ''}>
                        {camera.remark || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {camera.has_sim === true ? 'Yes' : camera.has_sim === false ? 'No' : '-'}
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-xs">
                        {camera.imsi || '-'}
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-xs">
                        {camera.iccid || '-'}
                      </td>
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
                Friendly Name (optional)
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
                Serial Number (optional)
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
                Scanned Date (optional)
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
            <DialogDescription>Update camera information</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label htmlFor="edit-name" className="block text-sm font-medium mb-2">
                Friendly Name
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

            <div>
              <label htmlFor="edit-serial-number" className="block text-sm font-medium mb-2">
                Serial Number
              </label>
              <input
                id="edit-serial-number"
                type="text"
                value={editCameraSerialNumber}
                onChange={(e) => setEditCameraSerialNumber(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g., SN123456"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-box" className="block text-sm font-medium mb-2">
                  Box
                </label>
                <input
                  id="edit-box"
                  type="text"
                  value={editCameraBox}
                  onChange={(e) => setEditCameraBox(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., Box-A"
                />
              </div>

              <div>
                <label htmlFor="edit-order" className="block text-sm font-medium mb-2">
                  Order
                </label>
                <input
                  id="edit-order"
                  type="text"
                  value={editCameraOrder}
                  onChange={(e) => setEditCameraOrder(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., Order-1"
                />
              </div>
            </div>

            <div>
              <label htmlFor="edit-scanned-date" className="block text-sm font-medium mb-2">
                Scanned Date
              </label>
              <input
                id="edit-scanned-date"
                type="date"
                value={editCameraScannedDate}
                onChange={(e) => setEditCameraScannedDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="edit-firmware" className="block text-sm font-medium mb-2">
                Firmware
              </label>
              <input
                id="edit-firmware"
                type="text"
                value={editCameraFirmware}
                onChange={(e) => setEditCameraFirmware(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g., 4TR1SPrFB06"
              />
            </div>

            <div>
              <label htmlFor="edit-remark" className="block text-sm font-medium mb-2">
                Remark
              </label>
              <textarea
                id="edit-remark"
                value={editCameraRemark}
                onChange={(e) => setEditCameraRemark(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Any additional notes"
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="edit-has-sim"
                type="checkbox"
                checked={editCameraHasSim}
                onChange={(e) => setEditCameraHasSim(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-2 focus:ring-ring"
              />
              <label htmlFor="edit-has-sim" className="text-sm font-medium">
                Has SIM card
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-imsi" className="block text-sm font-medium mb-2">
                  IMSI
                </label>
                <input
                  id="edit-imsi"
                  type="text"
                  value={editCameraImsi}
                  onChange={(e) => setEditCameraImsi(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., 204081234567890"
                />
              </div>

              <div>
                <label htmlFor="edit-iccid" className="block text-sm font-medium mb-2">
                  ICCID
                </label>
                <input
                  id="edit-iccid"
                  type="text"
                  value={editCameraIccid}
                  onChange={(e) => setEditCameraIccid(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., 8931085125056164008"
                />
              </div>
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

      {/* CSV Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent onClose={() => setShowImportDialog(false)} className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import Cameras from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file with camera information. Required: IMEI. Optional: FriendlyName,
              Serial, Box, Order, Scanned, Firmware, Remark, SIM, IMSI, ICCID. Date format: DD-MM-YYYY or YYYY-MM-DD.
              Delimiter auto-detected (comma or semicolon).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!importResults ? (
              <>
                <div>
                  <label htmlFor="csv-file" className="block text-sm font-medium mb-2">
                    CSV File
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
                  <p className="text-sm font-medium mb-2">CSV Format Example:</p>
                  <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                    IMEI;Serial;Order;Scanned;Firmware;Remark;SIM;IMSI;ICCID{'\n'}
                    860946063660255;SY2511012122;WF13051-2;19-12-2025;4TR1SPrFB06;;TRUE;204081234567890;8931085125056164008{'\n'}
                    860946063660256;SY2511012127;WF13051-2;19-12-2025;4TR1SPrFB06;;TRUE;204081234567891;8931085125056164016
                  </pre>
                  <p className="text-xs text-muted-foreground mt-2">
                    Note: Can also use comma as delimiter. FriendlyName column optional (defaults to IMEI).
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-accent/50 rounded-md">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">
                      Success: {importResults.success_count}
                    </span>
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
                            {result.success
                              ? `Camera ID: ${result.camera_id}`
                              : result.error}
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
              <Button
                onClick={handleImportCSV}
                disabled={importMutation.isPending || !csvFile}
              >
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
    </div>
  );
};
