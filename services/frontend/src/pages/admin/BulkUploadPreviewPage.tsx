/**
 * Bulk-upload row design preview
 *
 * Sandbox page that renders the bulk-upload row in four candidate
 * layouts against four sample job states. Project admins reach it
 * at /projects/{id}/bulk-upload/preview. Once a variant is picked,
 * we replace the JobRow in BulkUploadPage with that one and drop
 * this file.
 *
 * Mock data only, no API calls, no live progress, no actions wired.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import {
  Check,
  AlertTriangle,
  Trash2,
  Images,
  FileDown,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { useProject } from '../../contexts/ProjectContext';
import type { BulkUploadJob } from '../../api/bulkUpload';

// ----- Mock jobs -----

interface MockState {
  label: string;
  job: BulkUploadJob;
  // Active client-side upload state, when relevant.
  upload?: {
    uploaded: number;
    skipped: number;
    failed: number;
    etaText: string;
  };
  // Process phase ETA the row would compute from the job list.
  processEtaText?: string;
}

const MOCK_STATES: MockState[] = [
  {
    label: 'Active upload (client streaming)',
    job: {
      uuid: 'mock-1',
      project_id: 1,
      camera_id: 1,
      camera_name: 'Duinpoort NW',
      original_filename: 'sd-card-march-2026',
      status: 'uploading',
      total_files: 19380,
      processed_files: 0,
      skipped_files: 0,
      error_message: null,
      manifest: {
        total_entries: 19380,
        valid_count: 19380,
        by_status: { valid: 19380 },
        date_range: { start: '2026-03-01T00:00:00', end: '2026-03-30T23:59:00' },
        suggested_camera: null,
        matched_cameras: [],
      },
      queue_position: null,
      started_at: null,
      process_started_at: null,
      finished_at: null,
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      created_by_email: 'peter@addaxdatascience.com',
    },
    upload: {
      uploaded: 1944,
      skipped: 0,
      failed: 0,
      etaText: 'about 10 minutes',
    },
  },
  {
    label: 'Processing (worker pipeline)',
    job: {
      uuid: 'mock-2',
      project_id: 1,
      camera_id: 1,
      camera_name: 'Duinpoort NW',
      original_filename: 'sd-card-march-2026',
      status: 'processing',
      total_files: 19380,
      processed_files: 3500,
      skipped_files: 120,
      error_message: null,
      manifest: {
        total_entries: 19380,
        valid_count: 19380,
        by_status: { valid: 19380 },
        date_range: { start: '2026-03-01T00:00:00', end: '2026-03-30T23:59:00' },
        suggested_camera: null,
        matched_cameras: [],
      },
      queue_position: 0,
      started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      process_started_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      finished_at: null,
      created_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      created_by_email: 'peter@addaxdatascience.com',
    },
    processEtaText: 'about half an hour',
  },
  {
    label: 'Done',
    job: {
      uuid: 'mock-3',
      project_id: 1,
      camera_id: 2,
      camera_name: 'Bremerberg-Z',
      original_filename: 'autumn-pull-A',
      status: 'done',
      total_files: 4825,
      processed_files: 4700,
      skipped_files: 125,
      error_message: null,
      manifest: {
        total_entries: 4825,
        valid_count: 4825,
        by_status: { valid: 4825 },
        date_range: { start: '2026-02-01T00:00:00', end: '2026-02-28T23:59:00' },
        suggested_camera: null,
        matched_cameras: [],
        process_summary: {
          queued_for_pipeline: 4825,
          duplicates: 0,
          other_skipped: 125,
        },
      },
      queue_position: null,
      started_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      process_started_at: new Date(Date.now() - 23 * 3600 * 1000).toISOString(),
      finished_at: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
      created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      created_by_email: 'peter@addaxdatascience.com',
    },
  },
  {
    label: 'Failed',
    job: {
      uuid: 'mock-4',
      project_id: 1,
      camera_id: 3,
      camera_name: 'Camera 17',
      original_filename: 'damaged-card',
      status: 'failed',
      total_files: 200,
      processed_files: 12,
      skipped_files: 50,
      error_message: 'MinIO upstream connection refused',
      manifest: null,
      queue_position: null,
      started_at: null,
      process_started_at: null,
      finished_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      created_by_email: 'peter@addaxdatascience.com',
    },
  },
];

// ----- Shared helpers (copied small from BulkUploadPage) -----

const TEAL = '#0f6064';
const MIDDLE = '#71b7ba';
const BAD = '#882000';

function statusBadgeStyle(status: BulkUploadJob['status']): React.CSSProperties {
  switch (status) {
    case 'done':
      return { backgroundColor: TEAL, color: 'white' };
    case 'failed':
      return { backgroundColor: BAD, color: 'white' };
    default:
      return { backgroundColor: MIDDLE, color: 'white' };
  }
}

function statusLabel(status: BulkUploadJob['status']): string {
  // Match BulkUploadPage: every in-flight server status collapses
  // to "Active" so the badge mirrors the filter chips.
  switch (status) {
    case 'done': return 'Done';
    case 'failed': return 'Failed';
    default: return 'Active';
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
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

// Elapsed time for the variant that shows ONE bar (A, C, D). Returns
// the wall-clock duration of whichever phase is most informative for
// the current status: upload elapsed while uploading, process
// elapsed while processing, process time for done, total runtime
// for failed.
function activeElapsedSeconds(state: MockState): number | null {
  const { job } = state;
  const now = new Date().toISOString();
  switch (job.status) {
    case 'uploading':
      return diffSeconds(job.created_at, now);
    case 'processing':
      return diffSeconds(job.process_started_at, now);
    case 'done':
      return diffSeconds(job.process_started_at, job.finished_at);
    case 'failed':
      return diffSeconds(job.created_at, job.finished_at);
    default:
      return null;
  }
}

function StatusBadge({ status }: { status: BulkUploadJob['status'] }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1"
      style={statusBadgeStyle(status)}
    >
      {status === 'done' && <Check className="h-3 w-3" />}
      {status === 'failed' && <AlertTriangle className="h-3 w-3" />}
      {statusLabel(status)}
    </span>
  );
}

function Bar({ percent, dim = false }: { percent: number; dim?: boolean }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div
        className="h-full transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          backgroundColor: dim ? MIDDLE : TEAL,
        }}
      />
    </div>
  );
}

function deriveCounts(state: MockState) {
  const { job, upload } = state;
  const total = Math.max(job.total_files, 1);
  // Upload phase: how many files crossed the wire (uploaded + skipped duplicates).
  let uploadDone: number;
  let uploadPercent: number;
  if (upload) {
    uploadDone = upload.uploaded + upload.skipped;
    uploadPercent = Math.round((uploadDone / total) * 100);
  } else if (job.status === 'uploading') {
    // Paused upload: server-recorded value (we don't track it yet
    // server-side, so 0 is honest).
    uploadDone = 0;
    uploadPercent = 0;
  } else {
    // Past the upload phase, so the upload is complete by definition.
    uploadDone = job.total_files;
    uploadPercent = 100;
  }

  // Process phase: server's processed_files / total_files.
  const processDone = job.processed_files + job.skipped_files;
  const processPercent =
    job.status === 'done' || job.status === 'processing'
      ? Math.min(100, Math.round((processDone / total) * 100))
      : 0;

  return {
    total: job.total_files,
    uploadDone,
    uploadPercent,
    processDone,
    processPercent,
    failed: upload?.failed ?? 0,
  };
}

// ----- Variant A: Stat grid + single bar -----

const VariantA: React.FC<{ state: MockState }> = ({ state }) => {
  const c = deriveCounts(state);
  const { job, upload } = state;
  const eta = upload?.etaText ?? state.processEtaText ?? null;
  const bar = job.status === 'uploading' ? c.uploadPercent : c.processPercent;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{job.original_filename}</span>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            For {job.camera_name} · by {job.created_by_email}
          </p>
        </div>
        <RowActions job={job} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
        <Stat label="Started" value={formatRelative(job.created_at)} />
        <Stat
          label="Files"
          value={
            job.status === 'uploading'
              ? `${c.uploadDone.toLocaleString()} / ${c.total.toLocaleString()}`
              : `${c.processDone.toLocaleString()} / ${c.total.toLocaleString()}`
          }
        />
        <Stat
          label="Progress"
          value={`${job.status === 'uploading' ? c.uploadPercent : c.processPercent} %`}
        />
        <Stat label="ETA" value={eta ?? '—'} />
      </div>
      {c.failed > 0 && (
        <p className="text-xs mt-2" style={{ color: BAD }}>
          {c.failed.toLocaleString()} failed
        </p>
      )}
      <div className="mt-3">
        <Bar percent={bar} />
      </div>
      {job.error_message && (
        <div className="text-xs text-red-600 mt-2">{job.error_message}</div>
      )}
    </div>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}

// ----- Variant B: Two-phase bars -----

const VariantB: React.FC<{ state: MockState }> = ({ state }) => {
  const c = deriveCounts(state);
  const { job, upload } = state;

  // Per-phase elapsed. Upload starts at created_at and ends when the
  // worker begins processing (process_started_at). Process starts at
  // process_started_at and ends at finished_at. For an in-flight
  // phase we measure to "now".
  const uploadElapsedSec =
    job.status === 'uploading'
      ? diffSeconds(job.created_at, new Date().toISOString())
      : diffSeconds(job.created_at, job.process_started_at);
  const processElapsedSec =
    job.status === 'processing'
      ? diffSeconds(job.process_started_at, new Date().toISOString())
      : diffSeconds(job.process_started_at, job.finished_at);

  const uploadCaption =
    job.status === 'uploading' && upload
      ? `${c.uploadDone.toLocaleString()} / ${c.total.toLocaleString()} · ${c.uploadPercent} % · ${upload.etaText} left`
      : c.uploadPercent === 100
        ? (uploadElapsedSec !== null ? `took ${formatDuration(uploadElapsedSec)}` : 'done')
        : c.uploadPercent === 0 && job.status === 'failed'
          ? 'incomplete'
          : 'paused, open Bulk upload to resume';
  const processCaption =
    job.status === 'processing'
      ? `${c.processDone.toLocaleString()} / ${c.total.toLocaleString()} · ${c.processPercent} %`
        + (state.processEtaText ? ` · ${state.processEtaText} left` : '')
      : job.status === 'done'
        ? `${c.processDone.toLocaleString()} / ${c.total.toLocaleString()} · 100 %`
          + (processElapsedSec !== null ? ` · took ${formatDuration(processElapsedSec)}` : '')
        : c.uploadPercent === 100
          ? 'pending'
          : 'waiting on upload';

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{job.original_filename}</span>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            For {job.camera_name} · started {formatRelative(job.created_at)} · by {job.created_by_email}
          </p>
        </div>
        <RowActions job={job} />
      </div>

      <div className="grid grid-cols-[5rem_1fr_auto] gap-x-3 gap-y-1 mt-3 items-center text-xs">
        <span className="text-muted-foreground">Upload</span>
        <Bar percent={c.uploadPercent} />
        <span className="text-muted-foreground tabular-nums">{uploadCaption}</span>

        <span className="text-muted-foreground">Process</span>
        <Bar percent={c.processPercent} dim={job.status === 'uploading'} />
        <span className="text-muted-foreground tabular-nums">{processCaption}</span>
      </div>
      {c.failed > 0 && (
        <p className="text-xs mt-2" style={{ color: BAD }}>
          {c.failed.toLocaleString()} failed
        </p>
      )}
      {job.error_message && (
        <div className="text-xs text-red-600 mt-2">{job.error_message}</div>
      )}
    </div>
  );
};

// ----- Variant C: Compact stat strip + single bar -----

const VariantC: React.FC<{ state: MockState }> = ({ state }) => {
  const c = deriveCounts(state);
  const { job, upload } = state;
  const eta = upload?.etaText ?? state.processEtaText ?? null;
  const bar = job.status === 'uploading' ? c.uploadPercent : c.processPercent;
  const done = job.status === 'uploading' ? c.uploadDone : c.processDone;
  const percent = job.status === 'uploading' ? c.uploadPercent : c.processPercent;

  const elapsedSec = activeElapsedSeconds(state);
  const isActive = job.status === 'uploading' || job.status === 'processing';
  const facts: string[] = [];
  facts.push(`started ${formatRelative(job.created_at)}`);
  facts.push(`${done.toLocaleString()} of ${c.total.toLocaleString()}`);
  facts.push(`${percent} %`);
  // Elapsed is only useful retrospectively; while the row is active
  // the ETA carries the relevant info and "X min in" is noise.
  if (!isActive && elapsedSec !== null) {
    facts.push(`took ${formatDuration(elapsedSec)}`);
  }
  if (eta) facts.push(`${eta} left`);
  if (c.failed > 0) facts.push(`${c.failed.toLocaleString()} failed`);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{job.original_filename}</span>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            For {job.camera_name} · {job.created_by_email}
          </p>
        </div>
        <RowActions job={job} />
      </div>

      <p className="text-xs text-muted-foreground mt-2 tabular-nums">
        {facts.join(' · ')}
      </p>
      <div className="mt-2">
        <Bar percent={bar} />
      </div>
      {job.error_message && (
        <div className="text-xs text-red-600 mt-2">{job.error_message}</div>
      )}
    </div>
  );
};

// ----- Variant D: Single segmented bar (upload + process side by side) -----

const VariantD: React.FC<{ state: MockState }> = ({ state }) => {
  const c = deriveCounts(state);
  const { job, upload } = state;
  const eta = upload?.etaText ?? state.processEtaText ?? null;
  const elapsedSec = activeElapsedSeconds(state);
  const done = job.status === 'uploading' ? c.uploadDone : c.processDone;
  const percent = job.status === 'uploading' ? c.uploadPercent : c.processPercent;
  const phase = job.status === 'uploading' ? 'upload' : 'process';

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{job.original_filename}</span>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            For {job.camera_name} · started {formatRelative(job.created_at)} · by {job.created_by_email}
          </p>
        </div>
        <RowActions job={job} />
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span className="tabular-nums">
            {phase}: {done.toLocaleString()} / {c.total.toLocaleString()} ({percent} %)
          </span>
          <span>
            {/* Elapsed only after the phase has finished, no noise
                while it's running. */}
            {elapsedSec !== null
              && !(job.status === 'uploading' || job.status === 'processing')
              && `took ${formatDuration(elapsedSec)}`}
            {eta && `${eta} left`}
          </span>
        </div>
        <div className="flex h-2 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full transition-all"
            style={{ width: `${c.uploadPercent / 2}%`, backgroundColor: TEAL }}
            title={`upload ${c.uploadPercent} %`}
          />
          <div
            className="h-full transition-all"
            style={{
              width: `${c.processPercent / 2}%`,
              backgroundColor: MIDDLE,
            }}
            title={`process ${c.processPercent} %`}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>upload</span>
          <span>process</span>
        </div>
      </div>
      {c.failed > 0 && (
        <p className="text-xs mt-2" style={{ color: BAD }}>
          {c.failed.toLocaleString()} failed
        </p>
      )}
      {job.error_message && (
        <div className="text-xs text-red-600 mt-2">{job.error_message}</div>
      )}
    </div>
  );
};

// ----- Shared row actions (read-only here) -----

function RowActions({ job }: { job: BulkUploadJob }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      {(job.status === 'done' || job.status === 'failed') && (
        <Button size="sm" variant="outline" disabled>
          <FileDown className="h-4 w-4 mr-1" />
          Log
        </Button>
      )}
      {job.status === 'done' && (
        <Button size="sm" variant="outline" disabled>
          <Images className="h-4 w-4 mr-1" />
          View images
        </Button>
      )}
      {job.status !== 'processing' && (
        <Button
          size="sm"
          variant="outline"
          disabled
          className="text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Discard
        </Button>
      )}
    </div>
  );
}

// ----- Page -----

const VARIANTS: { key: 'A' | 'B' | 'C' | 'D'; title: string; blurb: string; Component: React.FC<{ state: MockState }> }[] = [
  {
    key: 'A',
    title: 'Stat grid + single bar',
    blurb:
      'Named columns for every metric, then one progress bar for whichever phase is active. Most scannable, but does not surface the two-phase pipeline.',
    Component: VariantA,
  },
  {
    key: 'B',
    title: 'Two-phase bars (recommended)',
    blurb:
      'Separate "Upload" and "Process" rows, each with its own bar and caption. Makes the pipeline explicit, supports independent ETAs, costs more vertical space.',
    Component: VariantB,
  },
  {
    key: 'C',
    title: 'Compact stat strip + single bar',
    blurb:
      'Dot-separated facts on one line, one bar below. Tight, but the two-phase distinction is lost again.',
    Component: VariantC,
  },
  {
    key: 'D',
    title: 'Segmented bar',
    blurb:
      'One bar split into two halves, upload + process. Visually unified but easy to misread (a half-coloured bar at 100 % upload looks like 50 % overall).',
    Component: VariantD,
  },
];

export const BulkUploadPreviewPage: React.FC = () => {
  const { selectedProject, canAdminCurrentProject } = useProject();
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${selectedProject?.id}/dashboard`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bulk upload row preview</h1>
        <p className="text-sm text-gray-600 mt-1">
          Four candidate layouts for the bulk-upload job row, against four
          sample states. Pick one and the production row will be replaced
          with that layout. Mock data only, no live progress.
        </p>
      </div>

      {VARIANTS.map((v) => (
        <Card key={v.key}>
          <CardContent className="p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">
                Variant {v.key} &mdash; {v.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{v.blurb}</p>
            </div>
            <div className="space-y-6">
              {MOCK_STATES.map((s, i) => (
                <div key={s.job.uuid}>
                  {i > 0 && <div className="border-t mb-6" />}
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    {s.label}
                  </p>
                  <v.Component state={s} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
