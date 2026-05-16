/**
 * Bulk image upload page (project admin only)
 *
 * Header has a single "+ Bulk upload" button that opens a modal with the
 * camera picker + ZIP dropzone. Body is a live job list; it polls the
 * jobs endpoint every 5 s while any row is non-terminal so users can
 * navigate away and come back.
 */
import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import {
  Loader2,
  Upload,
  Plus,
  Camera as CameraIcon,
  FileArchive,
  Check,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/Dialog';
import { useProject } from '../../contexts/ProjectContext';
import { useToast } from '../../components/ui/Toaster';
import { camerasApi } from '../../api/cameras';
import { bulkUploadApi, type BulkUploadJob } from '../../api/bulkUpload';

const TERMINAL_STATUSES = new Set(['done', 'failed']);

function statusLabel(status: BulkUploadJob['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'extracting':
      return 'Extracting';
    case 'processing':
      return 'Processing';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

function statusBadgeClass(status: BulkUploadJob['status']): string {
  switch (status) {
    case 'done':
      return 'bg-green-100 text-green-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'processing':
    case 'extracting':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  return `${day} d ago`;
}

export const BulkUploadPage: React.FC = () => {
  const { selectedProject, canAdminCurrentProject } = useProject();
  const projectId = selectedProject?.id;
  const [showModal, setShowModal] = useState(false);

  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  const { data: jobs } = useQuery({
    queryKey: ['bulk-upload-jobs', projectId],
    queryFn: () => bulkUploadApi.list(projectId!),
    enabled: projectId !== undefined,
    refetchInterval: (query) => {
      const data = query.state.data as BulkUploadJob[] | undefined;
      if (!data) return 5000;
      const anyOpen = data.some((j) => !TERMINAL_STATUSES.has(j.status));
      return anyOpen ? 5000 : false;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Bulk upload</h1>
          <p className="text-sm text-gray-600 mt-1">
            Upload images from one camera as a ZIP. The pipeline runs
            the same detection and classification as live cameras,
            without firing species notifications and without delaying
            live alerts.
          </p>
        </div>
        <Button onClick={() => setShowModal(true)} className="whitespace-nowrap">
          <Plus className="h-4 w-4 mr-2" />
          Bulk upload
        </Button>
      </div>

      <Card>
        <CardContent className="p-6 space-y-3">
          <h2 className="text-lg font-semibold">Upload jobs</h2>
          {(!jobs || jobs.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              No uploads yet for this project.
            </p>
          ) : (
            <ul className="divide-y">
              {jobs.map((job) => (
                <JobRow key={job.uuid} job={job} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <BulkUploadModal
        open={showModal}
        onClose={() => setShowModal(false)}
        projectId={projectId!}
      />
    </div>
  );
};

const BulkUploadModal: React.FC<{
  open: boolean;
  onClose: () => void;
  projectId: number;
}> = ({ open, onClose, projectId }) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [cameraId, setCameraId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [showAddCamera, setShowAddCamera] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newFriendlyName, setNewFriendlyName] = useState('');

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: open,
  });

  const cameraOptions = (cameras ?? []).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));

  const resetForm = () => {
    setCameraId('');
    setFile(null);
    setUploadPercent(null);
    setShowAddCamera(false);
    setNewDeviceId('');
    setNewFriendlyName('');
  };

  const handleClose = () => {
    if (uploadMutation.isPending) return;
    resetForm();
    onClose();
  };

  const createCameraMutation = useMutation({
    mutationFn: () =>
      camerasApi.create({
        device_id: newDeviceId.trim(),
        friendly_name: newFriendlyName.trim() || undefined,
        project_id: projectId,
      }),
    onSuccess: (camera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras', projectId] });
      setCameraId(String(camera.id));
      setShowAddCamera(false);
      setNewDeviceId('');
      setNewFriendlyName('');
      toast.success(`Camera "${camera.name}" created`);
    },
    onError: (err: any) => {
      toast.error(`Failed to create camera, ${err.response?.data?.detail || err.message}`);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: () =>
      bulkUploadApi.upload(projectId, Number(cameraId), file!, setUploadPercent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-upload-jobs', projectId] });
      resetForm();
      onClose();
      toast.success('Upload queued, processing in the background');
    },
    onError: (err: any) => {
      setUploadPercent(null);
      toast.error(`Upload failed, ${err.response?.data?.detail || err.message}`);
    },
  });

  const dropzone = useDropzone({
    accept: { 'application/zip': ['.zip'] },
    multiple: false,
    onDrop: (accepted) => {
      if (accepted.length > 0) setFile(accepted[0]);
    },
  });

  const canSubmit =
    !!file && !!cameraId && !uploadMutation.isPending && uploadPercent === null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        onClose={handleClose}
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>New bulk upload</DialogTitle>
          <DialogDescription>
            One ZIP per camera. Each image needs a DateTimeOriginal EXIF
            tag. Files without EXIF, non-images, and duplicates are
            skipped automatically. Up to 5,000 images and 20 GB per ZIP.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Camera selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Camera</label>
            {!showAddCamera ? (
              <div className="flex gap-2">
                <select
                  className="flex-1 h-10 px-3 border border-input rounded-md bg-background text-sm"
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                >
                  <option value="">Select a camera</option>
                  {cameraOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddCamera(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add new
                </Button>
              </div>
            ) : (
              <div className="border border-input rounded-md p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Add a new camera</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setShowAddCamera(false);
                      setNewDeviceId('');
                      setNewFriendlyName('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Device ID</label>
                    <input
                      type="text"
                      value={newDeviceId}
                      onChange={(e) => setNewDeviceId(e.target.value)}
                      placeholder="SIM ICCID or serial"
                      className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Display name</label>
                    <input
                      type="text"
                      value={newFriendlyName}
                      onChange={(e) => setNewFriendlyName(e.target.value)}
                      placeholder="Optional, defaults to device ID"
                      className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Set the camera location later via Cameras &gt; the new
                  camera. Without it, bulk uploaded images keep no GPS.
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!newDeviceId.trim() || createCameraMutation.isPending}
                  onClick={() => createCameraMutation.mutate()}
                >
                  {createCameraMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CameraIcon className="h-4 w-4 mr-1" />
                  )}
                  Create camera
                </Button>
              </div>
            )}
          </div>

          {/* Dropzone */}
          <div className="space-y-2">
            <label className="text-sm font-medium">ZIP file</label>
            <div
              {...dropzone.getRootProps()}
              className={`flex flex-col items-center justify-center gap-2 px-4 py-8 border-2 border-dashed rounded-md cursor-pointer transition-colors ${
                dropzone.isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:border-primary/50'
              }`}
            >
              <input {...dropzone.getInputProps()} />
              <FileArchive className="h-8 w-8 text-muted-foreground" />
              {file ? (
                <div className="text-sm">
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted-foreground ml-2">
                    {formatBytes(file.size)}
                  </span>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center">
                  Drop a ZIP here, or click to pick.
                </div>
              )}
            </div>
          </div>

          {uploadPercent !== null && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Uploading, {uploadPercent}%
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={uploadMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={() => uploadMutation.mutate()}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-1" />
                  Upload zip
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const JobRow: React.FC<{ job: BulkUploadJob }> = ({ job }) => {
  const total = Math.max(job.total_files, 1);
  const done = job.processed_files + job.skipped_files;
  const percent = Math.min(100, Math.round((done / total) * 100));
  const isTerminal = TERMINAL_STATUSES.has(job.status);

  return (
    <li className="py-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">{job.original_filename}</span>
            <span className="text-xs text-muted-foreground">
              for {job.camera_name ?? `camera #${job.camera_id}`}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatRelative(job.created_at)}
            {job.created_by_email ? `, by ${job.created_by_email}` : ''}
          </div>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${statusBadgeClass(job.status)}`}
        >
          {job.status === 'done' && <Check className="h-3 w-3" />}
          {job.status === 'failed' && <AlertTriangle className="h-3 w-3" />}
          {statusLabel(job.status)}
        </span>
      </div>
      {!isTerminal && (
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden mt-1">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {job.processed_files} of {job.total_files} processed
        {job.skipped_files > 0 && `, ${job.skipped_files} skipped`}
      </div>
      {job.error_message && (
        <div className="text-xs text-red-600 mt-1">{job.error_message}</div>
      )}
    </li>
  );
};
