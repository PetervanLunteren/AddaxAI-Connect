/**
 * Live feed page
 *
 * Shows the most recent items flowing into the project, newest first, and
 * refreshes on its own. Successful images show how far they are through the
 * pipeline. Rejected files (for example an image sent at setup before the GPS
 * fix) show why they were refused, even though they never enter the database.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, AlertTriangle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { liveFeedApi, type LiveFeedItem } from '../api/liveFeed';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { ImageDetailModal } from '../components/ImageDetailModal';
import { Card } from '../components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog';

// Pipeline phases still in progress. While any image sits in one of these the
// feed polls fast, otherwise it idles.
const IN_FLIGHT = new Set(['pending', 'processing', 'detected', 'classifying']);

// Status colours follow the repo convention: teal done, light teal in flight,
// burnt orange for failure or rejection.
const COLOR_DONE = '#0f6064';
const COLOR_IN_FLIGHT = '#71b7ba';
const COLOR_BAD = '#882000';

function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'processing': return 'Processing';
    case 'detected': return 'Detected';
    case 'classifying': return 'Classifying';
    case 'classified': return 'Classified';
    case 'failed': return 'Failed';
    default: return status ?? 'Unknown';
  }
}

function statusColor(status: string | null | undefined): string {
  if (status === 'classified') return COLOR_DONE;
  if (status === 'failed') return COLOR_BAD;
  return COLOR_IN_FLIGHT;
}

// Plain, natural-caps labels for each rejection reason. No colons.
const REASON_LABELS: Record<string, string> = {
  missing_gps: 'Missing GPS',
  invalid_gps: 'Invalid GPS',
  missing_datetime: 'Missing date',
  missing_device_id: 'Missing device id',
  unknown_camera: 'Unknown camera',
  unsupported_camera: 'Unsupported camera',
  no_camera_exif: 'No camera info',
  exif_extraction_failed: 'No metadata',
  validation_failed: 'Invalid file',
  parse_failed: 'Bad report',
  unsupported_file_type: 'Unsupported file',
};

function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Rejected';
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function itemKey(item: LiveFeedItem): string {
  return item.kind === 'image' ? `image-${item.uuid}` : `rejection-${item.rejection_id}`;
}

export const LiveFeedPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [openImageUuid, setOpenImageUuid] = useState<string | null>(null);
  const [openRejection, setOpenRejection] = useState<LiveFeedItem | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ['live-feed', projectId],
    queryFn: () => liveFeedApi.get(projectId!, 20),
    enabled: projectId !== undefined,
    refetchInterval: (q) => {
      const data = q.state.data as LiveFeedItem[] | undefined;
      const anyInFlight = (data ?? []).some(
        (i) => i.kind === 'image' && IN_FLIGHT.has(i.status ?? ''),
      );
      return anyInFlight ? 3000 : 30000;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Live feed</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          The most recent images for this project, newest first. Each image shows how
          far it is through the pipeline. Files that were refused (for example an image
          sent before the camera had a GPS fix) appear here too, so you get instant
          feedback during setup. This page refreshes on its own.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Loading...
        </div>
      ) : !items || items.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Nothing has come in yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const isRejection = item.kind === 'rejection';
            const badgeColor = isRejection ? COLOR_BAD : statusColor(item.status);
            const badgeText = isRejection ? reasonLabel(item.reason) : statusLabel(item.status);
            const thumbSrc = isRejection ? item.image_url : item.thumbnail_url;

            return (
              <Card
                key={itemKey(item)}
                className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() =>
                  isRejection ? setOpenRejection(item) : setOpenImageUuid(item.uuid ?? null)
                }
              >
                <div className="relative h-40 bg-muted">
                  {thumbSrc ? (
                    <AuthenticatedImage
                      src={thumbSrc}
                      alt={item.filename}
                      className="h-40 w-full object-cover"
                      fallback={
                        <div className="flex h-40 w-full items-center justify-center text-muted-foreground">
                          <AlertTriangle className="h-6 w-6" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center text-muted-foreground">
                      <AlertTriangle className="h-6 w-6" />
                    </div>
                  )}
                  <span
                    className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: badgeColor, color: 'white' }}
                  >
                    {badgeText}
                  </span>
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Camera className="h-3 w-3 shrink-0" />
                    <span className="truncate">{item.device_id ?? 'Unknown camera'}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={item.filename}>
                    {item.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">{shortTime(item.timestamp)}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Image detail reuses the standard modal */}
      {openImageUuid && (
        <ImageDetailModal
          imageUuid={openImageUuid}
          isOpen={true}
          onClose={() => setOpenImageUuid(null)}
        />
      )}

      {/* Rejection detail: full image from disk plus why it was refused */}
      <Dialog open={openRejection !== null} onOpenChange={(o) => !o && setOpenRejection(null)}>
        {openRejection && (
          <DialogContent onClose={() => setOpenRejection(null)} className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{reasonLabel(openRejection.reason)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {openRejection.image_url && (
                <AuthenticatedImage
                  src={openRejection.image_url}
                  alt={openRejection.filename}
                  className="max-h-[60vh] w-full rounded-md object-contain"
                  fallback={
                    <div className="flex h-40 w-full items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                      Image is no longer available
                    </div>
                  }
                />
              )}
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">File</dt>
                <dd className="col-span-2 break-all">{openRejection.filename}</dd>
                <dt className="text-muted-foreground">Camera</dt>
                <dd className="col-span-2">{openRejection.device_id ?? 'Unknown'}</dd>
                {openRejection.captured_at && (
                  <>
                    <dt className="text-muted-foreground">Camera time</dt>
                    <dd className="col-span-2">{openRejection.captured_at}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Arrived</dt>
                <dd className="col-span-2">{shortTime(openRejection.timestamp)}</dd>
                {openRejection.details && (
                  <>
                    <dt className="text-muted-foreground">Detail</dt>
                    <dd className="col-span-2">{openRejection.details}</dd>
                  </>
                )}
              </dl>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};
