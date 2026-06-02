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
import type { ScanEntry } from '../workers/bulkScanWorker';

const UPLOAD_CONCURRENCY = 4;
const UPLOAD_RETRIES = 3;

export interface ActiveUpload {
  jobUuid: string;
  projectId: number;
  // total = number of files we'll actually send. Excludes scan
  // skips (corrupt / missing-EXIF / safe-duplicates).
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
  // Set if the upload loop hit an unrecoverable error (createJob,
  // finalize, hash-check). The row falls back to the server-
  // recorded state, which will surface the failure too.
  errored: boolean;
}

interface BeginNewArgs {
  projectId: number;
  folderName: string;
  cameraId: number;
  siteId: number;
  manifest: BulkUploadManifest;
  excludedCapturedAts: string[];
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

function makeValidEntries(entries: ScanEntry[], excluded: Set<string>): ScanEntry[] {
  return entries
    .filter(
      (e) =>
        e.status === 'valid'
        && !(e.captured_at && excluded.has(e.captured_at)),
    )
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

async function runNewUpload(
  args: BeginNewArgs,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  const excluded = new Set(args.excludedCapturedAts);
  const validEntries = makeValidEntries(args.entries, excluded);
  const total = validEntries.length;

  let job: BulkUploadJob;
  try {
    job = await bulkUploadApi.createJob(args.projectId, {
      folder_name: args.folderName,
      camera_id: args.cameraId,
      site_id: args.siteId,
      total_files: total,
      manifest: args.manifest,
    });
  } catch (err: any) {
    args.onError(
      `Failed to create job, ${err.response?.data?.detail || err.message}`,
    );
    return;
  }

  set({
    active: {
      jobUuid: job.uuid,
      projectId: args.projectId,
      total,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      startedAt: Date.now(),
      done: false,
      cancelled: false,
      errored: false,
    },
  });
  args.onCacheInvalidate();

  await runUploadLoop(args.projectId, job.uuid, args.files, validEntries, new Set(), set, get);
  await finishOrCancel(args.projectId, job.uuid, set, get, args.onSuccess, args.onError, args.onCacheInvalidate);
}

async function runResumeUpload(
  args: BeginResumeArgs,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  const validEntries = makeValidEntries(args.entries, new Set());
  const total = validEntries.length;

  let alreadyUploaded: Set<number> = new Set();
  try {
    const indexes = await bulkUploadApi.uploadedIndexes(
      args.projectId,
      args.resumeJob.uuid,
    );
    alreadyUploaded = new Set(indexes);
  } catch (err: any) {
    args.onError(
      `Failed to read upload progress, ${err.response?.data?.detail || err.message}`,
    );
    return;
  }

  set({
    active: {
      jobUuid: args.resumeJob.uuid,
      projectId: args.projectId,
      total,
      uploaded: 0,
      skipped: alreadyUploaded.size,
      failed: 0,
      startedAt: Date.now(),
      done: false,
      cancelled: false,
      errored: false,
    },
  });
  args.onCacheInvalidate();

  await runUploadLoop(
    args.projectId,
    args.resumeJob.uuid,
    args.files,
    validEntries,
    alreadyUploaded,
    set,
    get,
  );
  await finishOrCancel(
    args.projectId,
    args.resumeJob.uuid,
    set,
    get,
    args.onSuccess,
    args.onError,
    args.onCacheInvalidate,
  );
}

async function runUploadLoop(
  projectId: number,
  jobUuid: string,
  files: File[],
  validEntries: ScanEntry[],
  alreadyUploaded: Set<number>,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
) {
  const queue = validEntries
    .map((e, i) => ({ entry: e, position: i }))
    .filter((row) => !alreadyUploaded.has(row.position));
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
      const { entry, position } = next;
      let attempt = 0;
      while (attempt < UPLOAD_RETRIES) {
        try {
          await bulkUploadApi.uploadFile(
            projectId,
            jobUuid,
            position,
            files[entry.index],
          );
          incUploaded();
          break;
        } catch (err) {
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

async function finishOrCancel(
  projectId: number,
  jobUuid: string,
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  onSuccess: () => void,
  onError: (msg: string) => void,
  onCacheInvalidate: () => void,
) {
  if (isCancelledNow(get)) {
    try {
      await bulkUploadApi.discard(projectId, jobUuid);
    } catch {
      // The row may already be gone, or the worker may have flipped
      // state. Either way the user asked to discard, do not block.
    }
    set({ active: null });
    onCacheInvalidate();
    return;
  }
  try {
    await bulkUploadApi.finalize(projectId, jobUuid);
    const a = get().active;
    if (a && a.jobUuid === jobUuid) {
      set({ active: { ...a, done: true } });
    }
    onSuccess();
    onCacheInvalidate();
    // Hold the "done" state for a beat so the row shows the success
    // before falling back to server-recorded progress, then clear so
    // a follow-up upload can start.
    setTimeout(() => {
      const cur = get().active;
      if (cur && cur.jobUuid === jobUuid) set({ active: null });
    }, 3000);
  } catch (err: any) {
    onError(
      `Failed to start processing, ${err.response?.data?.detail || err.message}`,
    );
    const a = get().active;
    if (a && a.jobUuid === jobUuid) {
      set({ active: { ...a, errored: true } });
    }
  }
}

function isCancelledNow(get: () => State & Actions): boolean {
  return Boolean(get().active?.cancelled);
}
