/**
 * Bulk image upload page (project admin only)
 *
 * Header has a single "+ Bulk upload" button that opens a modal. The
 * modal runs a three-step flow: upload the ZIP, watch the server
 * inspect it, then review and confirm. Body of the page is a live job
 * list that polls every 5 s while any row is non-terminal.
 */
import React, { useEffect, useState } from 'react';
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
  Sparkles,
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
import {
  bulkUploadApi,
  type BulkUploadJob,
  type BulkUploadManifest,
} from '../../api/bulkUpload';

const TERMINAL_STATUSES = new Set(['done', 'failed']);

function statusLabel(status: BulkUploadJob['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'inspecting':
      return 'Inspecting';
    case 'awaiting_confirmation':
      return 'Awaiting review';
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
      return 'bg-blue-100 text-blue-800';
    case 'inspecting':
    case 'awaiting_confirmation':
      return 'bg-amber-100 text-amber-800';
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

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'no dates found';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString();
  if (start && end && start.slice(0, 10) === end.slice(0, 10)) return fmt(start);
  return `${start ? fmt(start) : '?'} to ${end ? fmt(end) : '?'}`;
}

const STATUS_LABELS: Record<string, string> = {
  valid: 'will be processed',
  missing_exif_datetime: 'missing EXIF date',
  corrupt: 'corrupt or unreadable',
};

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

type Step = 'upload' | 'inspecting' | 'review' | 'submitting';

const BulkUploadModal: React.FC<{
  open: boolean;
  onClose: () => void;
  projectId: number;
}> = ({ open, onClose, projectId }) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('upload');
  const [jobUuid, setJobUuid] = useState<string | null>(null);
  const [job, setJob] = useState<BulkUploadJob | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [cameraId, setCameraId] = useState<string>('');

  // Inline camera-create form (only shown when user clicks "+ Add new")
  const [showAddCamera, setShowAddCamera] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newFriendlyName, setNewFriendlyName] = useState('');
  const [newLatitude, setNewLatitude] = useState('');
  const [newLongitude, setNewLongitude] = useState('');

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: open,
  });

  // Reset everything when the modal opens.
  useEffect(() => {
    if (open) {
      setStep('upload');
      setJobUuid(null);
      setJob(null);
      setFile(null);
      setUploadPercent(null);
      setCameraId('');
      setShowAddCamera(false);
      setNewDeviceId('');
      setNewFriendlyName('');
      setNewLatitude('');
      setNewLongitude('');
    }
  }, [open]);

  // Poll the job while we're waiting for the inspect phase to finish.
  useEffect(() => {
    if (!open || step !== 'inspecting' || !jobUuid) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await bulkUploadApi.get(projectId, jobUuid);
        if (cancelled) return;
        setJob(next);
        if (next.status === 'awaiting_confirmation') {
          if (next.manifest?.suggested_camera) {
            setCameraId(String(next.manifest.suggested_camera.camera_id));
          }
          setStep('review');
        } else if (next.status === 'failed') {
          toast.error(next.error_message ?? 'Inspection failed');
          // Stay in inspecting step so the user can see the error;
          // the modal close button is enabled because no mutation
          // is in flight.
        }
      } catch {
        // Ignore transient polling errors; next tick will retry.
      }
    };
    const id = window.setInterval(tick, 2000);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, step, jobUuid, projectId, toast]);

  const closeModal = () => {
    if (uploadMutation.isPending || confirmMutation.isPending || cancelMutation.isPending) return;
    onClose();
  };

  const uploadMutation = useMutation({
    mutationFn: () => bulkUploadApi.upload(projectId, file!, setUploadPercent),
    onSuccess: (created) => {
      setJobUuid(created.uuid);
      setJob(created);
      setStep('inspecting');
      setUploadPercent(null);
      queryClient.invalidateQueries({ queryKey: ['bulk-upload-jobs', projectId] });
    },
    onError: (err: any) => {
      setUploadPercent(null);
      toast.error(`Upload failed, ${err.response?.data?.detail || err.message}`);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => bulkUploadApi.confirm(projectId, jobUuid!, Number(cameraId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-upload-jobs', projectId] });
      toast.success('Processing started');
      onClose();
    },
    onError: (err: any) => {
      toast.error(`Failed to start processing, ${err.response?.data?.detail || err.message}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => bulkUploadApi.cancel(projectId, jobUuid!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-upload-jobs', projectId] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(`Cancel failed, ${err.response?.data?.detail || err.message}`);
    },
  });

  const createCameraMutation = useMutation({
    mutationFn: () => {
      const lat = newLatitude.trim() ? Number(newLatitude) : undefined;
      const lon = newLongitude.trim() ? Number(newLongitude) : undefined;
      return camerasApi.create({
        device_id: newDeviceId.trim(),
        friendly_name: newFriendlyName.trim() || undefined,
        project_id: projectId,
        latitude: lat,
        longitude: lon,
      });
    },
    onSuccess: (camera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras', projectId] });
      setCameraId(String(camera.id));
      setShowAddCamera(false);
      setNewDeviceId('');
      setNewFriendlyName('');
      setNewLatitude('');
      setNewLongitude('');
      toast.success(`Camera "${camera.name}" created`);
    },
    onError: (err: any) => {
      toast.error(`Failed to create camera, ${err.response?.data?.detail || err.message}`);
    },
  });

  const dropzone = useDropzone({
    accept: { 'application/zip': ['.zip'] },
    multiple: false,
    onDrop: (accepted) => {
      if (accepted.length > 0) setFile(accepted[0]);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeModal();
      }}
    >
      <DialogContent
        onClose={closeModal}
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'New bulk upload'}
            {step === 'inspecting' && 'Inspecting ZIP'}
            {(step === 'review' || step === 'submitting') && 'Review upload'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && (
              <>One ZIP per camera. Each image needs a DateTimeOriginal EXIF tag. Up to 5,000 images and 20 GB per ZIP.</>
            )}
            {step === 'inspecting' && (
              <>Reading EXIF from every image and matching against your registered cameras.</>
            )}
            {(step === 'review' || step === 'submitting') && (
              <>Confirm the camera and start processing.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {step === 'upload' && (
            <UploadStep
              file={file}
              setFile={setFile}
              dropzone={dropzone}
              uploadPercent={uploadPercent}
              isUploading={uploadMutation.isPending}
              onCancel={closeModal}
              onUpload={() => uploadMutation.mutate()}
            />
          )}

          {step === 'inspecting' && (
            <InspectingStep
              job={job}
              isFailed={job?.status === 'failed'}
              onClose={closeModal}
            />
          )}

          {(step === 'review' || step === 'submitting') && job?.manifest && (
            <ReviewStep
              manifest={job.manifest}
              cameras={cameras ?? []}
              cameraId={cameraId}
              setCameraId={setCameraId}
              showAddCamera={showAddCamera}
              setShowAddCamera={setShowAddCamera}
              newDeviceId={newDeviceId}
              setNewDeviceId={setNewDeviceId}
              newFriendlyName={newFriendlyName}
              setNewFriendlyName={setNewFriendlyName}
              newLatitude={newLatitude}
              setNewLatitude={setNewLatitude}
              newLongitude={newLongitude}
              setNewLongitude={setNewLongitude}
              isCreatingCamera={createCameraMutation.isPending}
              onCreateCamera={() => createCameraMutation.mutate()}
              isConfirming={confirmMutation.isPending}
              isCancelling={cancelMutation.isPending}
              onCancel={() => cancelMutation.mutate()}
              onConfirm={() => {
                setStep('submitting');
                confirmMutation.mutate();
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const UploadStep: React.FC<{
  file: File | null;
  setFile: (f: File | null) => void;
  dropzone: ReturnType<typeof useDropzone>;
  uploadPercent: number | null;
  isUploading: boolean;
  onCancel: () => void;
  onUpload: () => void;
}> = ({ file, dropzone, uploadPercent, isUploading, onCancel, onUpload }) => (
  <>
    <div
      {...dropzone.getRootProps()}
      className={`flex flex-col items-center justify-center gap-2 px-4 py-10 border-2 border-dashed rounded-md cursor-pointer transition-colors ${
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
      <Button type="button" variant="outline" onClick={onCancel} disabled={isUploading}>
        Cancel
      </Button>
      <Button type="button" disabled={!file || isUploading} onClick={onUpload}>
        {isUploading ? (
          <>
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-1" />
            Upload and inspect
          </>
        )}
      </Button>
    </div>
  </>
);

const InspectingStep: React.FC<{
  job: BulkUploadJob | null;
  isFailed: boolean;
  onClose: () => void;
}> = ({ job, isFailed, onClose }) => (
  <div className="space-y-4">
    {isFailed ? (
      <div className="flex items-start gap-3 p-3 rounded-md bg-red-50 border border-red-200">
        <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
        <div className="text-sm text-red-700">
          {job?.error_message ?? 'Inspection failed'}
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-3 py-6 justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Reading EXIF on each image...
        </span>
      </div>
    )}
    <div className="flex justify-end">
      <Button type="button" variant="outline" onClick={onClose}>
        Close
      </Button>
    </div>
  </div>
);

const ReviewStep: React.FC<{
  manifest: BulkUploadManifest;
  cameras: { id: number; name: string }[];
  cameraId: string;
  setCameraId: (v: string) => void;
  showAddCamera: boolean;
  setShowAddCamera: (v: boolean) => void;
  newDeviceId: string;
  setNewDeviceId: (v: string) => void;
  newFriendlyName: string;
  setNewFriendlyName: (v: string) => void;
  newLatitude: string;
  setNewLatitude: (v: string) => void;
  newLongitude: string;
  setNewLongitude: (v: string) => void;
  isCreatingCamera: boolean;
  onCreateCamera: () => void;
  isConfirming: boolean;
  isCancelling: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({
  manifest,
  cameras,
  cameraId,
  setCameraId,
  showAddCamera,
  setShowAddCamera,
  newDeviceId,
  setNewDeviceId,
  newFriendlyName,
  setNewFriendlyName,
  newLatitude,
  setNewLatitude,
  newLongitude,
  setNewLongitude,
  isCreatingCamera,
  onCreateCamera,
  isConfirming,
  isCancelling,
  onCancel,
  onConfirm,
}) => {
  const cameraOptions = cameras.map((c) => ({
    value: String(c.id),
    label: c.name,
  }));
  const suggested = manifest.suggested_camera;
  const validCount = manifest.by_status.valid ?? 0;
  const skipReasonEntries = Object.entries(manifest.by_status).filter(
    ([k]) => k !== 'valid',
  );
  const canConfirm = !!cameraId && validCount > 0 && !isConfirming && !isCancelling;

  return (
    <div className="space-y-4">
      {/* Manifest summary */}
      <div className="border rounded-md p-3 space-y-2 bg-muted/30">
        <div className="text-sm">
          <span className="font-medium">{manifest.total_entries}</span>
          {' images in the zip, '}
          <span className="font-medium">{validCount}</span>
          {' ready to process'}
          {skipReasonEntries.length > 0 && (
            <>
              {', '}
              {skipReasonEntries.map(([k, n], i) => (
                <span key={k}>
                  <span className="font-medium">{n}</span> {STATUS_LABELS[k] ?? k}
                  {i < skipReasonEntries.length - 1 ? ', ' : ''}
                </span>
              ))}
            </>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Date range, {formatDateRange(manifest.date_range.start, manifest.date_range.end)}
        </div>
        {suggested && (
          <div className="flex items-center gap-1.5 text-xs text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Auto-detected camera, {suggested.camera_name} ({suggested.match_count} of {validCount} images match by EXIF serial)
          </div>
        )}
      </div>

      {/* Camera picker */}
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
                  setNewLatitude('');
                  setNewLongitude('');
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
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={newLatitude}
                  onChange={(e) => setNewLatitude(e.target.value)}
                  placeholder="Optional, e.g. 52.0237"
                  className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={newLongitude}
                  onChange={(e) => setNewLongitude(e.target.value)}
                  placeholder="Optional, e.g. 12.9829"
                  className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!newDeviceId.trim() || isCreatingCamera}
              onClick={onCreateCamera}
            >
              {isCreatingCamera ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CameraIcon className="h-4 w-4 mr-1" />
              )}
              Create camera
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isConfirming || isCancelling}
        >
          {isCancelling ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : null}
          Discard
        </Button>
        <Button type="button" disabled={!canConfirm} onClick={onConfirm}>
          {isConfirming ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-1" />
              Process {validCount} image{validCount === 1 ? '' : 's'}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

function jobSummaryText(job: BulkUploadJob): string {
  const summary = job.manifest?.process_summary;
  if (!summary) {
    // Worker hasn't finished the process phase yet, so it has not
    // written the breakdown. Fall back to the aggregate count.
    return `${job.processed_files} of ${job.total_files} processed`
      + (job.skipped_files > 0 ? `, ${job.skipped_files} skipped` : '');
  }
  const queued = summary.queued_for_pipeline;
  const dups = summary.duplicates;
  const others = summary.other_skipped;
  // "Done" with zero new images is almost always all-duplicates, so
  // lead with that. Don't say "0 of N processed" because it reads as
  // failure when it's actually correct dedupe behaviour.
  if (queued === 0 && dups > 0 && others === 0) {
    return `All ${dups} images were already in the project, nothing new added`;
  }
  if (queued === 0 && dups + others > 0) {
    return `No new images added, ${dups} duplicate${dups === 1 ? '' : 's'}`
      + (others > 0 ? `, ${others} other skipped` : '');
  }
  // Mixed or all-processed case: show what landed plus a parenthetical
  // breakdown of the skips when present.
  const processed = job.processed_files;
  const skipParts: string[] = [];
  if (dups > 0) skipParts.push(`${dups} duplicate${dups === 1 ? '' : 's'}`);
  if (others > 0) skipParts.push(`${others} other skipped`);
  return `${processed} of ${queued} classified`
    + (skipParts.length ? `, ${skipParts.join(', ')}` : '');
}


const JobRow: React.FC<{ job: BulkUploadJob }> = ({ job }) => {
  const total = Math.max(job.total_files, 1);
  const done = job.processed_files + job.skipped_files;
  const percent = Math.min(100, Math.round((done / total) * 100));
  const isTerminal = TERMINAL_STATUSES.has(job.status);
  const showBar = job.status === 'processing';

  return (
    <li className="py-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">{job.original_filename}</span>
            {job.camera_name && (
              <span className="text-xs text-muted-foreground">
                for {job.camera_name}
              </span>
            )}
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
      {showBar && (
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden mt-1">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {(isTerminal || showBar) && (
        <div className="text-xs text-muted-foreground">
          {jobSummaryText(job)}
        </div>
      )}
      {job.error_message && (
        <div className="text-xs text-red-600 mt-1">{job.error_message}</div>
      )}
    </li>
  );
};
