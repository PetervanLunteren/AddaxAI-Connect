/**
 * Bulk-upload runtime store
 *
 * One active client-side upload session per project. The store owns
 * both the live state (counts, started-at, cancellation flag) and
 * the actual upload loop, so the modal can close right after the
 * user clicks Upload without losing progress. The job row in the
 * list page subscribes to this store to render live counts; once
 * the upload finishes and the worker takes over, the row falls
 * back to the server-recorded `processed_files`.
 *
 * Why module-level: the upload loop must survive React unmounts
 * (modal close, navigation away from the bulk-upload page). React
 * state can't do that, refs go with the component. Zustand outside
 * React gives us a singleton that lives for the lifetime of the
 * page.
 */
import { create } from 'zustand';
import {
  bulkUploadApi,
  type BulkUploadJob,
  type BulkUploadManifest,
} from '../api/bulkUpload';
import { apiErrorMessage } from '../api/client';
import type { ScanEntry } from '../workers/bulkScanWorker';

const UPLOAD_CONCURRENCY = 4;
const UPLOAD_RETRIES = 3;

export interface ActiveUpload {
  jobUuid: string;
  projectId: number;
  // Number of files this upload sends in total, over all sessions.
  // Excludes files the scan could not read and files already in the
  // project.
  total: number;
  uploaded: number;
  // Files already on the server when we started (resume case, or
  // pre-flight dedup hits). Counted into "done" so the bar and
  // percent reflect what's left for THIS session.
  skipped: number;
  failed: number;
  startedAt: number;
  // Set when the upload loop has finished sending everything and
  // called finalize. The store keeps the row "live" for a beat
  // afterwards so the UI shows the success state before going
  // back to server-recorded progress.
  done: boolean;
  // Set by cancelActive(). The loop reads it on each iteration
  // and exits cleanly without calling finalize. The discard call
  // happens once the loop has actually stopped, so MinIO doesn't
  // see partial-state races.
  cancelled: boolean;
}

interface BeginNewArgs {
  projectId: number;
  folderName: string;
  // Exactly one of deviceId (Mode A, profile-matched camera) or siteId
  // (Mode B, manual site). cameraId is Mode B only: an existing camera to
  // attach the batch to instead of the default synthetic camera.
  deviceId?: string;
  siteId?: number;
  cameraId?: number;
  manifest: BulkUploadManifest;
  // Paths of files already in the project, left out of the upload.
  excludedPaths: string[];
  // Camera clock correction, already applied to manifest and entries.
  timeOffsetSeconds: number;
  files: File[];
  entries: ScanEntry[];
  onError: (msg: string) => void;
  onSuccess: () => void;
  onCacheInvalidate: () => void;
}

interface BeginResumeArgs {
  projectId: number;
  resumeJob: BulkUploadJob;
  files: File[];
  entries: ScanEntry[];
  onError: (msg: string) => void;
  onSuccess: () => void;
  onCacheInvalidate: () => void;
}

interface State {
  active: ActiveUpload | null;
}

interface Actions {
  beginNew: (args: BeginNewArgs) => void;
  beginResume: (args: BeginResumeArgs) => void;
  cancelActive: () => void;
  clear: () => void;
}

export const useBulkUploadStore = create<State & Actions>((set, get) => ({
  active: null,
  beginNew: (args) => {
    if (get().active && !get().active!.done && !get().active!.cancelled) {
      args.onError('An upload is already in progress, wait for it to finish.');
      return;
    }
    void runNewUpload(args, set, get);
  },
  beginResume: (args) => {
    if (get().active && !get().active!.done && !get().active!.cancelled) {
      args.onError('An upload is already in progress, wait for it to finish.');
      return;
    }
    void runResumeUpload(args, set, get);
  },
  cancelActive: () => {
    const active = get().active;
    if (!active || active.done) return;
    set({ active: { ...active, cancelled: true } });
  },
  clear: () => set({ active: null }),
}));

/**
 * The upload plan for a scanned folder.
 *
 * Every valid file gets a fixed index: its position in the valid files
 * sorted by path. The index is the file's key on the server, so a resume
 * must give every file the same index again. That is why files already in
 * the project are left out of `toSend`, never out of the numbering.
 */
function planUpload(entries: ScanEntry[], excludedPaths: string[]) {
  const excluded = new Set(excludedPaths);
  const indexed = entries
    .filter((e) => e.status === 'valid')
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path))
    .map((entry, index) => ({ entry, index }));
  return indexed.filter(({ entry }) => !excluded.has(entry.relative_path));
}

type PlannedFile = ReturnType<typeof planUpload>[number];

async function runNewUpload(
  args: BeginNewArgs,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  const toSend = planUpload(args.entries, args.excludedPaths);
  const totalBytes = toSend.reduce((sum, f) => sum + f.entry.size, 0);

  let job: BulkUploadJob;
  try {
    job = await bulkUploadApi.createJob(args.projectId, {
      folder_name: args.folderName,
      device_id: args.deviceId,
      site_id: args.siteId,
      total_files: toSend.length,
      camera_id: args.cameraId,
      total_bytes: totalBytes,
      manifest: args.manifest,
      time_offset_seconds: args.timeOffsetSeconds,
    });
  } catch (err) {
    args.onError(
      `Failed to create job, ${apiErrorMessage(err)}`,
    );
    return;
  }

  await runSession(args, job.uuid, toSend, new Set(), set, get);
}

async function runResumeUpload(
  args: BeginResumeArgs,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  const job = args.resumeJob;
  // Ask the server again which files are already in the project, so the
  // plan, and with it every file's index, matches the first session.
  let excludedPaths: string[];
  let alreadyUploaded: Set<number>;
  try {
    excludedPaths = job.camera_id
      ? await bulkUploadApi.checkDuplicates(args.projectId, { camera_id: job.camera_id }, args.entries)
      : [];
    alreadyUploaded = new Set(await bulkUploadApi.uploadedIndexes(args.projectId, job.uuid));
  } catch (err) {
    args.onError(
      `Failed to read upload progress, ${apiErrorMessage(err)}`,
    );
    return;
  }

  const toSend = planUpload(args.entries, excludedPaths);
  await runSession(args, job.uuid, toSend, alreadyUploaded, set, get);
}

/**
 * Send what is not on the server yet, then hand the job to the worker.
 * Shared by a new upload and a resume.
 */
async function runSession(
  args: Pick<BeginNewArgs, 'projectId' | 'files' | 'onError' | 'onSuccess' | 'onCacheInvalidate'>,
  jobUuid: string,
  toSend: PlannedFile[],
  alreadyUploaded: Set<number>,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  const queue = toSend.filter((f) => !alreadyUploaded.has(f.index));
  set({
    active: {
      jobUuid,
      projectId: args.projectId,
      total: toSend.length,
      uploaded: 0,
      skipped: toSend.length - queue.length,
      failed: 0,
      startedAt: Date.now(),
      done: false,
      cancelled: false,
    },
  });
  args.onCacheInvalidate();

  await runUploadLoop(args.projectId, jobUuid, args.files, queue, set, get);

  if (get().active?.cancelled) {
    try {
      // Mark the job cancelled (keeps the row as "Cancelled", clears staging)
      // rather than removing it, so a stopped upload behaves like a stopped
      // processing job. The user can remove the row separately.
      await bulkUploadApi.cancel(args.projectId, jobUuid);
    } catch {
      // The row may already be gone, or the worker may have flipped
      // state. Either way the user asked to stop, do not block.
    }
    endSession(jobUuid, set, get, args.onCacheInvalidate);
    return;
  }

  // Never start an incomplete job. The job stays paused and the row offers
  // Resume, which sends only the files that are missing.
  const failed = get().active?.failed ?? 0;
  if (failed > 0) {
    args.onError(
      `${failed.toLocaleString()} file${failed === 1 ? '' : 's'} did not upload. `
      + 'Check the connection and resume the upload.',
    );
    endSession(jobUuid, set, get, args.onCacheInvalidate);
    return;
  }

  try {
    await bulkUploadApi.finalize(args.projectId, jobUuid, toSend.length);
  } catch (err) {
    args.onError(
      `Failed to start processing, ${apiErrorMessage(err)}`,
    );
    endSession(jobUuid, set, get, args.onCacheInvalidate);
    return;
  }
  const a = get().active;
  if (a && a.jobUuid === jobUuid) set({ active: { ...a, done: true } });
  args.onSuccess();
  args.onCacheInvalidate();
  // Hold the "done" state for a beat so the row shows the success before
  // falling back to server-recorded progress, then clear so a follow-up
  // upload can start.
  setTimeout(() => {
    const cur = get().active;
    if (cur && cur.jobUuid === jobUuid) set({ active: null });
  }, 3000);
}

// Drop the live session, so the row shows the server state again (and the
// Resume button for a paused upload).
function endSession(
  jobUuid: string,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  onCacheInvalidate: () => void,
) {
  if (get().active?.jobUuid === jobUuid) set({ active: null });
  onCacheInvalidate();
}

async function runUploadLoop(
  projectId: number,
  jobUuid: string,
  files: File[],
  queue: PlannedFile[],
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  let cursor = 0;

  const isCancelled = () => Boolean(get().active?.cancelled);
  const incUploaded = () => {
    const a = get().active;
    if (a) set({ active: { ...a, uploaded: a.uploaded + 1 } });
  };
  const incFailed = () => {
    const a = get().active;
    if (a) set({ active: { ...a, failed: a.failed + 1 } });
  };

  const worker = async () => {
    while (true) {
      if (isCancelled()) return;
      const next = queue[cursor];
      if (!next) return;
      cursor += 1;
      const { entry, index } = next;
      let attempt = 0;
      while (attempt < UPLOAD_RETRIES) {
        try {
          await bulkUploadApi.uploadFile(projectId, jobUuid, index, files[entry.index]);
          incUploaded();
          break;
        } catch {
          attempt += 1;
          if (attempt >= UPLOAD_RETRIES) {
            incFailed();
          } else {
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: UPLOAD_CONCURRENCY }, () => worker()),
  );
}
