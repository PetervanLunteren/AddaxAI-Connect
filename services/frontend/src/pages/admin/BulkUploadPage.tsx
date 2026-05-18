/**
 * Bulk image upload page (project admin only)
 *
 * Header has a single "+ Bulk upload" button that opens a modal. The
 * modal runs a four-step flow: pick a folder, scan EXIF locally,
 * review the preview and pick a camera, then upload file by file.
 * Body of the page is a live job list that polls every 5 s while any
 * row is non-terminal.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Upload,
  Plus,
  Camera as CameraIcon,
  FolderOpen,
  Check,
  AlertTriangle,
  Sparkles,
  Trash2,
  Images,
  RotateCw,
  FileDown,
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
import type { ScanEntry, ScanResult } from '../../workers/bulkScanWorker';
import {
  useBulkUploadStore,
  type ActiveUpload,
} from '../../lib/bulkUploadStore';

const TERMINAL_STATUSES = new Set<BulkUploadJob['status']>(['done', 'failed']);

function statusLabel(status: BulkUploadJob['status']): string {
  // Collapse every in-flight server status to "Active" so the
  // badge matches the filter chips above. The per-row caption and
  // progress bar already tell the user which phase of "Active" the
  // row is in, so distinguishing them on the badge is redundant.
  switch (status) {
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    default:
      return 'Active';
  }
}

// Status badges use the project palette (FRONTEND_CONVENTIONS.md):
// good=#0f6064, middle=#71b7ba, bad=#882000. Done is the only
// success terminal state, failed is the only failure state, everything
// else is in-flight/pending and shares the middle colour.
function statusBadgeStyle(status: BulkUploadJob['status']): React.CSSProperties {
  switch (status) {
    case 'done':
      return { backgroundColor: '#0f6064', color: 'white' };
    case 'failed':
      return { backgroundColor: '#882000', color: 'white' };
    default:
      return { backgroundColor: '#71b7ba', color: 'white' };
  }
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

// Seconds/image fallback used for the first MIN_SAMPLE files of any
// fresh job, before it has enough signal to calibrate from its own
// throughput. Tuned to the live detection + classification path.
const DEFAULT_PROCESS_SECONDS_PER_IMAGE = 2;
const MIN_SAMPLE = 20;
const ETA_STATES = new Set<BulkUploadJob['status']>(['processing']);

function remainingFiles(job: BulkUploadJob): number {
  return Math.max(0, job.total_files - job.processed_files - job.skipped_files);
}

// Per-job seconds/image, computed from THIS job's own progress when
// there's enough signal. Skipped duplicates count toward completion
// because each one took real wall-clock time (a DB lookup, ~20 ms)
// and we want the ETA to track the actual mix of skips and
// full-pipeline processing the worker is doing right now.
function jobRate(job: BulkUploadJob): number {
  if (job.status !== 'processing' || !job.process_started_at) {
    return DEFAULT_PROCESS_SECONDS_PER_IMAGE;
  }
  const completed = job.processed_files + job.skipped_files;
  if (completed < MIN_SAMPLE) return DEFAULT_PROCESS_SECONDS_PER_IMAGE;
  const elapsedSec =
    (Date.now() - new Date(job.process_started_at).getTime()) / 1000;
  if (elapsedSec <= 0) return DEFAULT_PROCESS_SECONDS_PER_IMAGE;
  return Math.max(0.001, elapsedSec / completed);
}

function bucketEta(seconds: number): string {
  // First-word-capitalised so the value can lead a dot-separated
  // segment ("About 10 minutes left") without further fixup at the
  // call site.
  if (seconds < 60) return 'Less than a minute';
  if (seconds < 5 * 60) return 'A few minutes';
  if (seconds < 15 * 60) return 'About 10 minutes';
  if (seconds < 30 * 60) return 'About 20 minutes';
  if (seconds < 60 * 60) return 'About half an hour';
  if (seconds < 2 * 3600) return 'About an hour';
  if (seconds < 4 * 3600) return 'A few hours';
  return 'Several hours';
}

function computeEta(
  job: BulkUploadJob,
  allJobs: BulkUploadJob[],
): string | null {
  if (!ETA_STATES.has(job.status)) return null;
  const inFlight = allJobs
    .filter((j) => ETA_STATES.has(j.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const myIndex = inFlight.findIndex((j) => j.uuid === job.uuid);
  if (myIndex < 0) return null;
  // Each in-flight job ahead of (and including) this one contributes
  // its OWN measured rate when available. Mixed queues (one job mostly
  // duplicates, another all new images) get sane combined ETAs
  // without lumping every job onto a single global rate.
  const totalSeconds = inFlight
    .slice(0, myIndex + 1)
    .reduce((sum, j) => sum + remainingFiles(j) * jobRate(j), 0);
  return bucketEta(totalSeconds);
}

const STATUS_LABELS: Record<string, string> = {
  valid: 'ready to process',
  duplicate: 'already in the project',
  missing_exif_datetime: 'missing EXIF date',
  corrupt: 'corrupt or unreadable',
};

const MAX_FILES_PER_JOB = 20000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type FilterKey = 'active' | 'done' | 'failed';

const FILTER_DEFS: { key: FilterKey; label: string; matches: (s: BulkUploadJob['status']) => boolean }[] = [
  {
    key: 'active',
    label: 'Active',
    matches: (s) =>
      s === 'uploading'
      || s === 'queued'
      || s === 'inspecting'
      || s === 'awaiting_confirmation'
      || s === 'processing',
  },
  { key: 'done', label: 'Done', matches: (s) => s === 'done' },
  { key: 'failed', label: 'Failed', matches: (s) => s === 'failed' },
];

export const BulkUploadPage: React.FC = () => {
  const { selectedProject, canAdminCurrentProject } = useProject();
  const projectId = selectedProject?.id;
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('active');
  const queryClient = useQueryClient();
  const toast = useToast();

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

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { active: 0, done: 0, failed: 0 };
    (jobs ?? []).forEach((j) => {
      for (const def of FILTER_DEFS) {
        if (def.matches(j.status)) c[def.key] += 1;
      }
    });
    return c;
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const def = FILTER_DEFS.find((f) => f.key === filter)!;
    return (jobs ?? []).filter((j) => def.matches(j.status));
  }, [jobs, filter]);

  const cancelActiveUpload = useBulkUploadStore((s) => s.cancelActive);
  const activeUploadUuid = useBulkUploadStore((s) =>
    s.active && !s.active.done ? s.active.jobUuid : null,
  );

  const discardMutation = useMutation({
    mutationFn: (uuid: string) => bulkUploadApi.discard(projectId!, uuid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-upload-jobs', projectId] });
    },
    onError: (err: any) => {
      toast.error(`Discard failed, ${err.response?.data?.detail || err.message}`);
    },
  });

  // Discard handler. For an active client-side upload, stop the loop
  // FIRST and let it clean up via the store, otherwise the discard
  // API races against in-flight per-file POSTs. For everything else
  // hit the DELETE endpoint directly.
  const handleDiscard = useCallback(
    (uuid: string) => {
      if (uuid === activeUploadUuid) {
        cancelActiveUpload();
        return;
      }
      discardMutation.mutate(uuid);
    },
    [activeUploadUuid, cancelActiveUpload, discardMutation],
  );

  // Watch every poll for a job that just moved from 'processing' to a
  // terminal state and surface it. Toast for users on the page, plus
  // a desktop notification if they granted permission earlier.
  const prevStatusesRef = useRef<Map<string, BulkUploadJob['status']>>(new Map());
  useEffect(() => {
    if (!jobs) return;
    for (const job of jobs) {
      const prev = prevStatusesRef.current.get(job.uuid);
      const becameTerminal =
        prev === 'processing'
        && (job.status === 'done' || job.status === 'failed');
      if (becameTerminal) {
        const happy = job.status === 'done';
        const body = happy
          ? `${job.original_filename} processed.`
          : `${job.original_filename} failed.`;
        if (happy) toast.success(body);
        else toast.error(body);
        // Fire a desktop notification only when the user has already
        // granted permission. Asking from here would be a permission
        // prompt with no user gesture and would be ignored anyway.
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification('Bulk upload finished', { body });
          } catch {
            // Some browsers reject notifications from non-secure
            // contexts; that's fine, the toast already fired.
          }
        }
      }
      prevStatusesRef.current.set(job.uuid, job.status);
    }
  }, [jobs, toast]);

  // The modal can open in two modes: a fresh upload (no preset), or
  // a resume of a specific job (resumeIntent set). The resume mode
  // skips the banner step and goes straight to "pick the folder".
  const [resumeIntent, setResumeIntent] = useState<BulkUploadJob | null>(null);

  // Permission is requested on the first click of the header button.
  // Browsers require a user gesture, and this is the natural moment
  // because the user is actively starting work that will run async.
  const openModal = () => {
    if (
      typeof Notification !== 'undefined'
      && Notification.permission === 'default'
    ) {
      try {
        Notification.requestPermission();
      } catch {
        // Older browsers throw on the sync call form; that's fine.
      }
    }
    setResumeIntent(null);
    setModalOpen(true);
  };

  const handleResume = useCallback((job: BulkUploadJob) => {
    setResumeIntent(job);
    setModalOpen(true);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Bulk upload</h1>
          <p className="text-sm text-gray-600 mt-1">
            Upload images from one camera as a folder. The pipeline runs
            the same detection and classification as live cameras,
            without firing species notifications and without delaying
            live alerts.
          </p>
        </div>
        <Button onClick={openModal} className="whitespace-nowrap">
          <Plus className="h-4 w-4 mr-2" />
          Bulk upload
        </Button>
      </div>

      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Upload jobs</h2>
            <div className="flex items-center gap-1">
              {FILTER_DEFS.map((def) => {
                const active = filter === def.key;
                return (
                  <button
                    key={def.key}
                    type="button"
                    onClick={() => setFilter(def.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:text-foreground'
                    }`}
                  >
                    {def.label}
                    <span className={`ml-1 ${active ? 'opacity-80' : 'opacity-60'}`}>
                      {counts[def.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {filteredJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {(!jobs || jobs.length === 0)
                ? 'No uploads yet for this project.'
                : `No ${filter} jobs.`}
            </p>
          ) : (
            <div>
              {filteredJobs.map((job, i) => (
                <React.Fragment key={job.uuid}>
                  {i > 0 && <div className="border-t my-6" />}
                  <JobRow
                    job={job}
                    projectId={projectId!}
                    etaText={computeEta(job, jobs ?? [])}
                    onResume={
                      // Paused upload, no live session for this job
                      // in this tab. The Discard button stays, and
                      // a Resume sits next to it.
                      job.status === 'uploading' && job.uuid !== activeUploadUuid
                        ? () => handleResume(job)
                        : undefined
                    }
                    onDiscard={
                      job.status !== 'processing'
                        ? () => handleDiscard(job.uuid)
                        : undefined
                    }
                    isDiscarding={discardMutation.isPending && discardMutation.variables === job.uuid}
                  />
                </React.Fragment>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <BulkUploadModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setResumeIntent(null);
        }}
        projectId={projectId!}
        resumableJobs={(jobs ?? []).filter((j) => j.status === 'uploading')}
        initialResumeJob={resumeIntent}
      />
    </div>
  );
};

// ----- Modal -----

// The modal only owns SETUP: pick a folder, scan EXIF, review and
// pick a camera. Once the user clicks Upload, the active session is
// handed to bulkUploadStore which runs the per-file POST loop in the
// background and the modal closes. The live progress is shown on
// the job row, same place as processing progress, so the user has
// one consistent surface for everything that is in flight.
type Step = 'pick' | 'scan' | 'review';

interface ScannedFolder {
  folderName: string;
  files: File[];
  entries: ScanEntry[];
}

/**
 * Decide whether a freshly-scanned folder looks like the one a
 * resumable job was originally uploaded from. Stricter than needed
 * would lock users out on innocent edits; looser than needed would
 * stream the wrong files into the existing job. The minimal-but-safe
 * check is: same valid count and same first/last EXIF datetime.
 */
function manifestsLookCompatible(job: BulkUploadJob, entries: ScanEntry[]): boolean {
  const jobManifest = job.manifest;
  if (!jobManifest) return false;
  const validCount = entries.filter((e) => e.status === 'valid').length;
  if (validCount !== jobManifest.valid_count) return false;
  const validSorted = entries
    .filter((e) => e.status === 'valid' && e.captured_at)
    .map((e) => e.captured_at!)
    .sort();
  const newStart = validSorted[0] ?? null;
  const newEnd = validSorted[validSorted.length - 1] ?? null;
  return (
    newStart === jobManifest.date_range.start
    && newEnd === jobManifest.date_range.end
  );
}

interface UploadContext {
  camera_id: number;
  folder_name: string;
  manifest: BulkUploadManifest;
  // Naive captured_at timestamps flagged as duplicates during
  // pre-flight, scoped to the picked camera. The upload step skips
  // files whose captured_at hits this set so we don't waste bandwidth
  // on photos the server would just dedup away.
  excluded_captured_ats: string[];
}

const BulkUploadModal: React.FC<{
  open: boolean;
  onClose: () => void;
  projectId: number;
  resumableJobs: BulkUploadJob[];
  // Pre-populated when the user clicked Resume on a paused row.
  // Skips the banner-choose-which-job step and drops the user
  // straight at the folder picker for that job.
  initialResumeJob?: BulkUploadJob | null;
}> = ({ open, onClose, projectId, resumableJobs, initialResumeJob }) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('pick');
  const [scanned, setScanned] = useState<ScannedFolder | null>(null);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  // Set when the user clicks Resume on a banner row. Resuming skips
  // the review step and goes straight from scan to handing the
  // session over to bulkUploadStore.
  const [resumeJob, setResumeJob] = useState<BulkUploadJob | null>(null);

  // Reset everything when the modal opens. If initialResumeJob is
  // set, start the modal already in resume mode for that job so the
  // user does not have to click Resume on a banner again.
  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setScanned(null);
    setScanProgress(null);
    setResumeJob(initialResumeJob ?? null);
  }, [open, initialResumeJob]);

  const beginNew = useBulkUploadStore((s) => s.beginNew);
  const beginResume = useBulkUploadStore((s) => s.beginResume);

  const closeModal = () => {
    onClose();
  };

  const invalidateJobs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bulk-upload-jobs', projectId] });
  }, [queryClient, projectId]);

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
            {step === 'pick' && 'New bulk upload'}
            {step === 'scan' && 'Scanning folder'}
            {step === 'review' && 'Review upload'}
          </DialogTitle>
          <DialogDescription>
            {step === 'pick' && (
              <>One folder per camera. Each image needs a DateTimeOriginal EXIF tag. Up to {MAX_FILES_PER_JOB.toLocaleString()} images per upload.</>
            )}
            {step === 'scan' && (
              <>Reading EXIF on every image without leaving your browser.</>
            )}
            {step === 'review' && (
              <>Confirm the camera and start uploading. The modal closes once you click Upload, progress shows on the job row.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {step === 'pick' && (
            <PickStep
              resumableJobs={resumableJobs}
              resumeJob={resumeJob}
              onResumePick={(job) => setResumeJob(job)}
              onCancel={closeModal}
              onFolder={(folderName, files) => {
                setScanned({ folderName, files, entries: [] });
                setScanProgress({ done: 0, total: files.length });
                setStep('scan');
              }}
            />
          )}

          {step === 'scan' && scanned && (
            <ScanStep
              files={scanned.files}
              progress={scanProgress}
              onProgress={setScanProgress}
              onCancel={closeModal}
              onDone={(entries) => {
                setScanned({ ...scanned, entries });
                if (resumeJob) {
                  if (!manifestsLookCompatible(resumeJob, entries)) {
                    toast.error(
                      'This folder does not match the upload you are resuming. Pick the original folder, or cancel and start a new upload.',
                    );
                    setStep('pick');
                    return;
                  }
                  // Hand off to the store and close. Progress shows
                  // on the row from here on.
                  beginResume({
                    projectId,
                    resumeJob,
                    files: scanned.files,
                    entries,
                    onError: (msg) => toast.error(msg),
                    onSuccess: () => toast.success('Processing started'),
                    onCacheInvalidate: invalidateJobs,
                  });
                  closeModal();
                } else {
                  setStep('review');
                }
              }}
            />
          )}

          {step === 'review' && scanned && (
            <ReviewStep
              projectId={projectId}
              folderName={scanned.folderName}
              files={scanned.files}
              entries={scanned.entries}
              onBack={() => setStep('pick')}
              onCancel={closeModal}
              onConfirm={(ctx) => {
                beginNew({
                  projectId,
                  folderName: ctx.folder_name,
                  cameraId: ctx.camera_id,
                  manifest: ctx.manifest,
                  excludedCapturedAts: ctx.excluded_captured_ats,
                  files: scanned.files,
                  entries: scanned.entries,
                  onError: (msg) => toast.error(msg),
                  onSuccess: () => toast.success('Processing started'),
                  onCacheInvalidate: invalidateJobs,
                });
                closeModal();
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ----- PickStep -----

const PickStep: React.FC<{
  resumableJobs: BulkUploadJob[];
  resumeJob: BulkUploadJob | null;
  onResumePick: (job: BulkUploadJob | null) => void;
  onCancel: () => void;
  onFolder: (folderName: string, files: File[]) => void;
}> = ({ resumableJobs, resumeJob, onResumePick, onCancel, onFolder }) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState(false);

  const accept = useCallback(
    (files: File[], folderName: string) => {
      const images = files.filter((f) =>
        /\.(jpe?g|png)$/i.test(f.name)
      );
      if (images.length === 0) {
        toast.error('No JPEG or PNG images found in the folder');
        return;
      }
      if (images.length > MAX_FILES_PER_JOB) {
        toast.error(
          `Folder has ${images.length.toLocaleString()} images, the cap is ${MAX_FILES_PER_JOB.toLocaleString()}. Split into smaller batches.`,
        );
        return;
      }
      const oversize = images.find((f) => f.size > MAX_FILE_SIZE_BYTES);
      if (oversize) {
        toast.error(
          `${oversize.name} is larger than the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB per-file cap`,
        );
        return;
      }
      onFolder(folderName || 'folder', images);
    },
    [onFolder, toast],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      setPending(true);
      try {
        const items = Array.from(event.dataTransfer.items);
        const collected: File[] = [];
        let topLevelName: string | null = null;
        for (const item of items) {
          // webkitGetAsEntry is the right cross-browser path for
          // drag-dropped folders. The user can drag the SD-card folder
          // straight into the modal and we walk it recursively.
          const entry = (item as any).webkitGetAsEntry?.() as
            | (FileSystemDirectoryEntry | FileSystemFileEntry)
            | null;
          if (!entry) {
            const file = item.getAsFile();
            if (file) collected.push(file);
            continue;
          }
          if (entry.isDirectory) {
            if (!topLevelName) topLevelName = entry.name;
            await readDirectoryEntries(entry as FileSystemDirectoryEntry, collected);
          } else {
            const file = await getFileFromEntry(entry as FileSystemFileEntry);
            if (file) collected.push(file);
          }
        }
        accept(collected, topLevelName || 'folder');
      } finally {
        setPending(false);
      }
    },
    [accept],
  );

  const onPickerChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;
      // webkitRelativePath looks like "FolderName/IMG_0001.JPG", so the
      // top-level directory name is the first segment.
      const first = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
      const folderName = first ? first.split('/')[0] : 'folder';
      accept(files, folderName);
    },
    [accept],
  );

  return (
    <>
      {resumeJob ? (
        <div className="border rounded-md p-3 bg-primary/5 text-sm flex items-center justify-between gap-3">
          <div>
            Resuming upload of <span className="font-medium">{resumeJob.original_filename}</span>.
            Pick the same folder again to continue.
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onResumePick(null)}
          >
            Cancel resume
          </button>
        </div>
      ) : (
        resumableJobs.length > 0 && (
          <div className="border rounded-md p-3 bg-muted/30 space-y-2">
            <div className="text-sm font-medium">Unfinished upload{resumableJobs.length === 1 ? '' : 's'}</div>
            <div className="space-y-1">
              {resumableJobs.map((job) => (
                <div
                  key={job.uuid}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="truncate">
                    <span className="font-medium">{job.original_filename}</span>
                    <span className="text-muted-foreground">
                      , {job.total_files.toLocaleString()} images
                      {job.camera_name ? `, for ${job.camera_name}` : ''}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onResumePick(job)}
                  >
                    <RotateCw className="h-3.5 w-3.5 mr-1" />
                    Resume
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 px-4 py-10 border-2 border-dashed rounded-md cursor-pointer transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-input hover:border-primary/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          // webkitdirectory triggers the native folder picker in Chromium
          // and WebKit. Firefox falls back to a multi-select picker that
          // also works for our scan code.
          {...({ webkitdirectory: '', directory: '' } as any)}
          multiple
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={onPickerChange}
        />
        <FolderOpen className="h-8 w-8 text-muted-foreground" />
        {pending ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading folder
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center">
            {resumeJob
              ? 'Drop the original SD-card folder here, or click to pick.'
              : 'Drop the SD-card folder here, or click to pick.'}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
};

async function readDirectoryEntries(
  dir: FileSystemDirectoryEntry,
  out: File[],
): Promise<void> {
  const reader = dir.createReader();
  // readEntries returns batches; loop until empty.
  const batches: FileSystemEntry[][] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    batches.push(batch);
  }
  for (const batch of batches) {
    for (const entry of batch) {
      if (entry.isDirectory) {
        await readDirectoryEntries(entry as FileSystemDirectoryEntry, out);
      } else {
        const file = await getFileFromEntry(entry as FileSystemFileEntry);
        if (file) out.push(file);
      }
    }
  }
}

function getFileFromEntry(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null));
  });
}

// ----- ScanStep -----

const ScanStep: React.FC<{
  files: File[];
  progress: { done: number; total: number } | null;
  onProgress: (p: { done: number; total: number }) => void;
  onCancel: () => void;
  onDone: (entries: ScanEntry[]) => void;
}> = ({ files, progress, onProgress, onCancel, onDone }) => {
  // The worker must spawn exactly once per ScanStep mount. The
  // parent's inline onDone/onProgress callbacks change reference on
  // every progress-driven re-render, so if we depended on them the
  // useEffect would terminate the running worker and restart from
  // index 0 every 25 files. The refs let the latest callback fire
  // without retriggering the effect.
  const onProgressRef = useRef(onProgress);
  const onDoneRef = useRef(onDone);
  onProgressRef.current = onProgress;
  onDoneRef.current = onDone;
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const worker = new Worker(
      new URL('../../workers/bulkScanWorker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<ScanResult>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgressRef.current({ done: msg.done, total: msg.total });
      } else if (msg.type === 'done') {
        onDoneRef.current(msg.entries);
        worker.terminate();
      }
    };
    worker.postMessage({ files });
    return () => {
      worker.terminate();
    };
  }, [files]);

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 py-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground">
          {progress
            ? `Reading EXIF, ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} done.`
            : 'Starting...'}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

// ----- ReviewStep -----

const ReviewStep: React.FC<{
  projectId: number;
  folderName: string;
  files: File[];
  entries: ScanEntry[];
  onBack: () => void;
  onCancel: () => void;
  onConfirm: (ctx: UploadContext) => void;
}> = ({ projectId, folderName, entries, files, onBack, onCancel, onConfirm }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cameraId, setCameraId] = useState<string>('');
  const [showAddCamera, setShowAddCamera] = useState(false);
  const [newCameraName, setNewCameraName] = useState('');
  const [newLatitude, setNewLatitude] = useState('');
  const [newLongitude, setNewLongitude] = useState('');

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
  });

  // Compute manifest from the local scan. Same shape the server used
  // to write itself, so all the downstream UI keeps working.
  const manifest: BulkUploadManifest = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let minDt: string | null = null;
    let maxDt: string | null = null;
    const serialCounts: Record<string, number> = {};
    for (const e of entries) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      if (e.captured_at) {
        if (!minDt || e.captured_at < minDt) minDt = e.captured_at;
        if (!maxDt || e.captured_at > maxDt) maxDt = e.captured_at;
      }
      if (e.serial) {
        serialCounts[e.serial] = (serialCounts[e.serial] ?? 0) + 1;
      }
    }
    return {
      total_entries: entries.length,
      valid_count: byStatus.valid ?? 0,
      by_status: byStatus,
      date_range: { start: minDt, end: maxDt },
      suggested_camera: null,
      matched_cameras: [],
    };
  }, [entries]);

  const serialCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      if (e.serial) counts[e.serial] = (counts[e.serial] ?? 0) + 1;
    }
    return counts;
  }, [entries]);

  const validCapturedAts = useMemo(() => {
    const out: string[] = [];
    for (const e of entries) {
      if (e.status === 'valid' && e.captured_at) out.push(e.captured_at);
    }
    return out;
  }, [entries]);

  // Count of valid entries per captured_at in the scan. Used together
  // with the server's per-timestamp DB count to apply the 1:1 safety
  // rule below.
  const scanCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (e.status === 'valid' && e.captured_at) {
        m.set(e.captured_at, (m.get(e.captured_at) ?? 0) + 1);
      }
    }
    return m;
  }, [entries]);

  // Pre-flight duplicate count, scoped to whichever camera the user
  // has picked. One indexed lookup on Image.captured_at returns a
  // map of timestamp -> DB count.
  const cameraIdNum = Number(cameraId);
  const { data: duplicateCounts } = useQuery({
    queryKey: ['bulk-check-duplicates', projectId, cameraIdNum, validCapturedAts],
    queryFn: () => bulkUploadApi.checkDuplicates(projectId, cameraIdNum, validCapturedAts),
    enabled: !!cameraId && validCapturedAts.length > 0,
  });

  // 1:1 safety rule. Only skip a captured_at when both the scan and
  // the DB have exactly one entry at that timestamp; that pair is an
  // unambiguous duplicate. Anything else (burst mode at the same EXIF
  // second, multiple existing rows) is ambiguous and goes through to
  // the server, where content-hash dedup is precise.
  const safeDuplicateSet = useMemo(() => {
    const set = new Set<string>();
    if (!duplicateCounts) return set;
    for (const [ts, dbCount] of Object.entries(duplicateCounts)) {
      if (dbCount === 1 && scanCounts.get(ts) === 1) set.add(ts);
    }
    return set;
  }, [duplicateCounts, scanCounts]);

  const duplicateCount = safeDuplicateSet.size;

  // Ask the server which registered camera matches the EXIF
  // SerialNumbers. Only fires when there's at least one serial; if
  // every image has no SerialNumber we skip it.
  const { data: suggest } = useQuery({
    queryKey: ['bulk-scan-suggest', projectId, serialCounts],
    queryFn: () => bulkUploadApi.scanSuggest(projectId, serialCounts),
    enabled: Object.keys(serialCounts).length > 0,
  });

  // Auto-pick the suggested camera the first time it arrives.
  useEffect(() => {
    if (!cameraId && suggest?.suggested_camera) {
      setCameraId(String(suggest.suggested_camera.camera_id));
    }
  }, [suggest, cameraId]);

  // The dominant EXIF SerialNumber across the scan, used to auto-fill
  // the new-camera device_id so scan-suggest will match this camera on
  // a future upload. Falls back to a generated id if no clear serial.
  const dominantSerial = useMemo(() => {
    let best: [string, number] | null = null;
    for (const [s, c] of Object.entries(serialCounts)) {
      if (!best || c > best[1]) best = [s, c];
    }
    return best && best[1] >= 2 ? best[0] : null;
  }, [serialCounts]);

  const enrichedManifest: BulkUploadManifest = useMemo(() => ({
    ...manifest,
    suggested_camera: suggest?.suggested_camera ?? null,
    matched_cameras: suggest?.matched_cameras ?? [],
  }), [manifest, suggest]);

  const rawValidCount = manifest.by_status.valid ?? 0;
  // Effective "uploadable" count after removing per-camera duplicate
  // hits returned by /check-duplicates. The pre-flight matches the
  // server-side dedup key it would have evaluated at ingestion time
  // (camera_id + captured_at), so a match here is one the worker
  // would have skipped anyway.
  const validCount = Math.max(0, rawValidCount - duplicateCount);
  const skipReasonEntries: [string, number][] = [
    ...(duplicateCount > 0 ? ([['duplicate', duplicateCount]] as [string, number][]) : []),
    ...(Object.entries(manifest.by_status).filter(([k]) => k !== 'valid') as [string, number][]),
  ];

  // Thumbnail strip: pick up to 8 valid entries spread evenly across
  // the date range. Render the File objects via createObjectURL.
  const thumbnails = useMemo(() => {
    const validEntries = entries
      .filter((e) => e.status === 'valid' && e.captured_at)
      .sort((a, b) => (a.captured_at! < b.captured_at! ? -1 : 1));
    if (validEntries.length === 0) return [];
    const sampleSize = Math.min(8, validEntries.length);
    const picks: ScanEntry[] = [];
    for (let i = 0; i < sampleSize; i++) {
      const idx = Math.floor((i * (validEntries.length - 1)) / Math.max(1, sampleSize - 1));
      picks.push(validEntries[idx]);
    }
    return picks.map((entry) => ({
      entry,
      url: URL.createObjectURL(files[entry.index]),
    }));
  }, [entries, files]);

  // Revoke thumbnail URLs when the review step unmounts so we don't
  // leak memory across modal opens.
  useEffect(() => {
    return () => {
      for (const t of thumbnails) URL.revokeObjectURL(t.url);
    };
  }, [thumbnails]);

  const createCameraMutation = useMutation({
    mutationFn: () => {
      const lat = newLatitude.trim() ? Number(newLatitude) : undefined;
      const lon = newLongitude.trim() ? Number(newLongitude) : undefined;
      // device_id is hidden in the bulk-upload form. Pre-fill with the
      // dominant EXIF SerialNumber so scan-suggest matches this camera
      // on a future bulk upload from the same hardware. Generate a
      // unique fallback when no serial dominates.
      const trimmed = newCameraName.trim();
      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const random = Math.random().toString(36).slice(2, 6);
      const deviceId = dominantSerial || `bulk-${slug || 'cam'}-${random}`;
      return camerasApi.create({
        device_id: deviceId,
        friendly_name: trimmed || undefined,
        project_id: projectId,
        latitude: lat,
        longitude: lon,
      });
    },
    onSuccess: (camera) => {
      queryClient.invalidateQueries({ queryKey: ['cameras', projectId] });
      setCameraId(String(camera.id));
      setShowAddCamera(false);
      setNewCameraName('');
      setNewLatitude('');
      setNewLongitude('');
      toast.success(`Camera "${camera.name}" created`);
    },
    onError: (err: any) => {
      toast.error(`Failed to create camera, ${err.response?.data?.detail || err.message}`);
    },
  });

  // Accept either a single field with both numbers ("52.0237,
  // 12.9829") or two-field entry. Splitting on paste lands the user
  // in the same end state without an extra UI mode.
  const acceptLatPaste = (raw: string): boolean => {
    const match = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return false;
    setNewLatitude(match[1]);
    setNewLongitude(match[2]);
    return true;
  };

  const handleConfirm = () => {
    const id = Number(cameraId);
    if (!id) {
      toast.error('Pick a camera before uploading');
      return;
    }
    if (validCount === 0) {
      toast.error('No images can be uploaded from this folder');
      return;
    }
    onConfirm({
      camera_id: id,
      folder_name: folderName,
      manifest: enrichedManifest,
      excluded_captured_ats: Array.from(safeDuplicateSet),
    });
  };

  const cameraOptions = (cameras ?? []).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));
  const suggested = suggest?.suggested_camera;

  return (
    <div className="space-y-4">
      <div className="border rounded-md p-3 space-y-2 bg-muted/30">
        <div className="text-sm">
          <span className="font-medium">{manifest.total_entries.toLocaleString()}</span>
          {' images in the folder, '}
          <span className="font-medium">{validCount.toLocaleString()}</span>
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

      {thumbnails.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Sample, spread across the date range.</div>
          <div className="flex gap-1.5 overflow-x-auto">
            {thumbnails.map((t) => (
              <img
                key={t.entry.index}
                src={t.url}
                alt=""
                className="h-16 w-16 object-cover rounded border border-input shrink-0"
              />
            ))}
          </div>
        </div>
      )}

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
                  setNewCameraName('');
                  setNewLatitude('');
                  setNewLongitude('');
                }}
              >
                Cancel
              </button>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Camera name</label>
                <input
                  type="text"
                  value={newCameraName}
                  onChange={(e) => setNewCameraName(e.target.value)}
                  placeholder="e.g. Duinpoort NW"
                  className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Latitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newLatitude}
                    onChange={(e) => {
                      if (!acceptLatPaste(e.target.value)) {
                        setNewLatitude(e.target.value);
                      }
                    }}
                    placeholder="52.0237 or paste lat, lon"
                    className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Longitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newLongitude}
                    onChange={(e) => setNewLongitude(e.target.value)}
                    placeholder="12.9829"
                    className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
                  />
                </div>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!newCameraName.trim() || createCameraMutation.isPending}
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

      <div
        role="note"
        className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900"
      >
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" />
        <div>
          <span className="font-medium">Keep this tab open during the upload.</span>
          {' '}
          Once the analysis starts, you can close it.
        </div>
      </div>

      <div className="flex justify-between gap-2 pt-2">
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <Button
          type="button"
          disabled={!cameraId || validCount === 0}
          onClick={handleConfirm}
        >
          <Upload className="h-4 w-4 mr-1" />
          Upload {validCount.toLocaleString()} image{validCount === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
};


// ----- JobRow -----

function jobSummaryText(job: BulkUploadJob): string {
  const summary = job.manifest?.process_summary;
  if (!summary) {
    return `${job.processed_files} of ${job.total_files} processed`
      + (job.skipped_files > 0 ? `, ${job.skipped_files} skipped` : '');
  }
  const queued = summary.queued_for_pipeline;
  const dups = summary.duplicates;
  const others = summary.other_skipped;
  if (queued === 0 && dups > 0 && others === 0) {
    return `All ${dups} images were already in the project, nothing new added`;
  }
  if (queued === 0 && dups + others > 0) {
    return `No new images added, ${dups} duplicate${dups === 1 ? '' : 's'}`
      + (others > 0 ? `, ${others} other skipped` : '');
  }
  const processed = job.processed_files;
  const skipParts: string[] = [];
  if (dups > 0) skipParts.push(`${dups} duplicate${dups === 1 ? '' : 's'}`);
  if (others > 0) skipParts.push(`${others} other skipped`);
  return `${processed} of ${queued} classified`
    + (skipParts.length ? `, ${skipParts.join(', ')}` : '');
}

function buildResultsHref(projectId: number, job: BulkUploadJob): string | null {
  if (job.status !== 'done' || job.camera_id == null) return null;
  const params = new URLSearchParams();
  params.set('camera_ids', String(job.camera_id));
  const start = job.manifest?.date_range?.start;
  const end = job.manifest?.date_range?.end;
  if (start) params.set('date_from', start.slice(0, 10));
  if (end) params.set('date_to', end.slice(0, 10));
  params.set('show_empty', 'true');
  return `/projects/${projectId}/images?${params.toString()}`;
}

const JobRow: React.FC<{
  job: BulkUploadJob;
  projectId: number;
  etaText: string | null;
  onResume?: () => void;
  onDiscard?: () => void;
  isDiscarding?: boolean;
}> = ({ job, projectId, etaText, onResume, onDiscard, isDiscarding }) => {
  // Subscribe to the active client-side upload session. If this row
  // is the one currently uploading from THIS browser, the store has
  // live counts; otherwise we fall back to the server-recorded state.
  const active = useBulkUploadStore((s) => s.active);
  const isActiveUpload =
    active !== null && active.jobUuid === job.uuid && !active.done;
  const uploadEta = useThrottledUploadEta(isActiveUpload ? active : null);

  const isTerminal = TERMINAL_STATUSES.has(job.status);
  const resultsHref = buildResultsHref(projectId, job);

  const counts = deriveRowCounts(job, isActiveUpload ? active : null);

  // Per-phase elapsed shown only after the phase has finished
  // ("took X"). In-flight phases stay silent on duration so the ETA
  // is the only forward-looking number in the row.
  const uploadElapsedSec =
    job.status === 'uploading'
      ? null
      : diffSeconds(job.created_at, job.process_started_at);
  const processElapsedSec =
    job.status === 'processing'
      ? null
      : diffSeconds(job.process_started_at, job.finished_at);

  const uploadCaption = renderUploadCaption({
    job, counts, isActiveUpload, uploadEta, uploadElapsedSec, failed: active?.failed ?? 0,
  });
  const processCaption = renderProcessCaption({
    job, counts, etaText, processElapsedSec,
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{job.original_filename}</span>
            <span
              className="px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1"
              style={statusBadgeStyle(job.status)}
            >
              {job.status === 'done' && <Check className="h-3 w-3" />}
              {job.status === 'failed' && <AlertTriangle className="h-3 w-3" />}
              {statusLabel(job.status)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {job.camera_name && (
              <>
                For{' '}
                <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
                  {job.camera_name}
                </code>
                {' · '}
              </>
            )}
            Started {formatRelative(job.created_at)}
            {job.created_by_email ? ` · By ${job.created_by_email}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onResume && (
            <Button size="sm" variant="outline" onClick={onResume}>
              <RotateCw className="h-4 w-4 mr-1" />
              Resume
            </Button>
          )}
          {isTerminal && (
            <a href={bulkUploadApi.logCsvUrl(projectId, job.uuid)}>
              <Button size="sm" variant="outline">
                <FileDown className="h-4 w-4 mr-1" />
                Log
              </Button>
            </a>
          )}
          {resultsHref && (
            <Link to={resultsHref}>
              <Button size="sm" variant="outline">
                <Images className="h-4 w-4 mr-1" />
                View images
              </Button>
            </Link>
          )}
          {onDiscard && (
            <Button
              size="sm"
              variant="outline"
              onClick={onDiscard}
              disabled={isDiscarding}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {isDiscarding ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {/* Same button, three different consequences depending
                  on state. "Remove" only takes the row off the list,
                  any classified Image rows survive. "Cancel" stops
                  the in-tab upload loop and deletes its staging.
                  "Discard" deletes a paused job that nobody is
                  actively driving. */}
              {isTerminal ? 'Remove' : isActiveUpload ? 'Cancel' : 'Discard'}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2 mt-3 text-xs">
        <PhaseRow
          label="Upload"
          percent={counts.uploadPercent}
          caption={uploadCaption}
        />
        <PhaseRow
          label="Analyse"
          percent={counts.processPercent}
          caption={processCaption}
          dim={job.status === 'uploading' || isActiveUpload}
        />
      </div>

      {isTerminal && (
        <p className="text-xs text-muted-foreground mt-2">
          {jobSummaryText(job)}
        </p>
      )}
      {job.error_message && (
        <div className="text-xs text-red-600 mt-2">{job.error_message}</div>
      )}
    </div>
  );
};

interface RowCounts {
  total: number;
  uploadDone: number;
  uploadPercent: number;
  processDone: number;
  processPercent: number;
}

function deriveRowCounts(job: BulkUploadJob, active: ActiveUpload | null): RowCounts {
  const total = Math.max(job.total_files, 1);
  let uploadDone: number;
  if (active !== null) {
    uploadDone = active.uploaded + active.skipped;
  } else if (job.status === 'uploading') {
    // No live session for this job in this tab. Server doesn't track
    // partial upload progress yet, so it's effectively unknown.
    uploadDone = 0;
  } else {
    // Past the upload phase by definition.
    uploadDone = job.total_files;
  }
  const uploadPercent = honestPercent(uploadDone, total);
  const processDone = job.processed_files + job.skipped_files;
  const processPercent =
    job.status === 'done' || job.status === 'processing'
      ? honestPercent(processDone, total)
      : 0;
  return {
    total: job.total_files,
    uploadDone,
    uploadPercent,
    processDone,
    processPercent,
  };
}

// Floor instead of round so we never claim 100 % while files are
// still in flight. 19,345 / 19,380 is 99.81 %; rounded it would
// show as 100 % alongside "Less than a minute left", which reads
// contradictory. Only show 100 % when the phase is genuinely
// complete.
function honestPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.max(0, Math.floor((done / total) * 100)));
}

function renderUploadCaption({
  job, counts, isActiveUpload, uploadEta, uploadElapsedSec, failed,
}: {
  job: BulkUploadJob;
  counts: RowCounts;
  isActiveUpload: boolean;
  uploadEta: string | null;
  uploadElapsedSec: number | null;
  failed: number;
}): string {
  if (isActiveUpload) {
    let s = `${counts.uploadDone.toLocaleString()} / ${counts.total.toLocaleString()} · ${counts.uploadPercent} %`;
    if (uploadEta) s += ` · ${uploadEta} left`;
    if (failed > 0) s += ` · ${failed.toLocaleString()} failed`;
    return s;
  }
  if (counts.uploadPercent === 100) {
    return uploadElapsedSec !== null
      ? `Uploaded in ${formatDuration(uploadElapsedSec)}`
      : 'Uploaded';
  }
  if (job.status === 'failed') return 'Incomplete';
  if (job.status === 'uploading') return 'Paused';
  return '—';
}

function renderProcessCaption({
  job, counts, etaText, processElapsedSec,
}: {
  job: BulkUploadJob;
  counts: RowCounts;
  etaText: string | null;
  processElapsedSec: number | null;
}): string {
  if (job.status === 'processing') {
    let s = `${counts.processDone.toLocaleString()} / ${counts.total.toLocaleString()} · ${counts.processPercent} %`;
    if (etaText) s += ` · ${etaText} left`;
    return s;
  }
  if (job.status === 'done') {
    let s = `${counts.processDone.toLocaleString()} / ${counts.total.toLocaleString()} · 100 %`;
    if (processElapsedSec !== null) {
      s += ` · Analysed in ${formatDuration(processElapsedSec)}`;
    }
    return s;
  }
  if (counts.uploadPercent === 100) return 'Pending';
  return 'Waiting on upload';
}

function PhaseBar({ percent, dim }: { percent: number; dim?: boolean }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div
        className="h-full transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          backgroundColor: dim ? '#71b7ba' : '#0f6064',
        }}
      />
    </div>
  );
}

// Label + bar on one line, caption stacked below. Stacking keeps
// the bar at full row width regardless of caption length, so bars
// in different job rows are visually comparable to each other.
function PhaseRow({
  label, percent, caption, dim,
}: {
  label: string;
  percent: number;
  caption: string;
  dim?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground w-20 shrink-0">{label}</span>
        <div className="flex-1 min-w-0">
          <PhaseBar percent={percent} dim={dim} />
        </div>
      </div>
      <p className="text-muted-foreground tabular-nums pl-[calc(5rem+0.75rem)] mt-0.5">
        {caption}
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) return `${hours} h`;
  return `${hours} h ${remMin} min`;
}

function diffSeconds(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, (b - a) / 1000);
}

// Re-evaluate the upload ETA at most every THROTTLE_MS. The bucket
// labels are coarse step values, so without this they flicker
// between two neighbouring buckets as the since-start rate drifts.
// 5 s is fast enough that the displayed estimate keeps up with
// real changes in throughput, slow enough that boundary jitter
// disappears.
const ETA_THROTTLE_MS = 5000;

function useThrottledUploadEta(active: ActiveUpload | null): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!active) {
      setText(null);
      return;
    }
    // Refresh immediately on mount so the first display isn't blank
    // for 5 s, then on a fixed cadence. Each tick reads the latest
    // active from the store rather than the closure-captured copy
    // so we always compute against fresh counts.
    const refresh = () => {
      const cur = useBulkUploadStore.getState().active;
      if (cur && cur.jobUuid === active.jobUuid && !cur.done) {
        setText(computeUploadEta(cur));
      }
    };
    refresh();
    const id = window.setInterval(refresh, ETA_THROTTLE_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [active?.jobUuid, active === null]);
  return text;
}

function computeUploadEta(active: ActiveUpload): string | null {
  const elapsedSeconds = (Date.now() - active.startedAt) / 1000;
  const remaining = Math.max(0, active.total - (active.uploaded + active.skipped));
  if (active.uploaded < 5 || elapsedSeconds <= 0 || remaining === 0) return null;
  const rate = active.uploaded / elapsedSeconds;
  if (rate <= 0) return null;
  return bucketEta(remaining / rate);
}
