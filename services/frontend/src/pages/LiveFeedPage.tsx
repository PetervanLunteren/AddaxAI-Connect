/**
 * Live feed page
 *
 * Shows the most recent items flowing into the project, newest first, and
 * refreshes on its own. Successful images show how far they are through the
 * pipeline. Rejected files (for example an image sent at setup before the GPS
 * fix) show why they were refused, even though they never enter the database.
 */
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { liveFeedApi, type LiveFeedItem } from '../api/liveFeed';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { ImageDetailModal } from '../components/ImageDetailModal';
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

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function itemKey(item: LiveFeedItem): string {
  return item.kind === 'image' ? `image-${item.uuid}` : `rejection-${item.rejection_id}`;
}

// One tile, used both as the large hero (newest item) and the smaller filmstrip
// thumbnails. Shows just the pixels with a status/reason badge and a relative
// time, no camera id or filename.
const FeedTile: React.FC<{
  item: LiveFeedItem;
  variant: 'hero' | 'thumb';
  onClick: () => void;
}> = ({ item, variant, onClick }) => {
  const isRejection = item.kind === 'rejection';
  const badgeColor = isRejection ? COLOR_BAD : statusColor(item.status);
  const badgeText = isRejection ? reasonLabel(item.reason) : statusLabel(item.status);
  const src = isRejection ? item.image_url : item.thumbnail_url;
  const hero = variant === 'hero';

  const fallback = (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <AlertTriangle className={hero ? 'h-10 w-10' : 'h-5 w-5'} />
    </div>
  );

  return (
    <button
      onClick={onClick}
      className={
        (hero
          ? 'flex h-[60vh] w-full items-center justify-center'
          : 'h-24 w-32 shrink-0') +
        ' relative overflow-hidden rounded-lg bg-muted ring-offset-background transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring'
      }
    >
      {src ? (
        <AuthenticatedImage
          src={src}
          alt=""
          className={hero ? 'max-h-[60vh] max-w-full object-contain' : 'h-24 w-32 object-cover'}
          fallback={fallback}
        />
      ) : (
        fallback
      )}
      <span
        className={
          'absolute top-2 left-2 rounded-full font-semibold ' +
          (hero ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[10px]')
        }
        style={{ backgroundColor: badgeColor, color: 'white' }}
      >
        {badgeText}
      </span>
      <span
        className={
          'absolute bottom-2 right-2 rounded-full bg-black/60 text-white ' +
          (hero ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]')
        }
      >
        {relativeTime(item.timestamp)}
      </span>
    </button>
  );
};

export const LiveFeedPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [openImageUuid, setOpenImageUuid] = useState<string | null>(null);
  const [openRejection, setOpenRejection] = useState<LiveFeedItem | null>(null);

  // Re-render every 15s so the relative times stay current between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const openItem = (item: LiveFeedItem) =>
    item.kind === 'rejection'
      ? setOpenRejection(item)
      : setOpenImageUuid(item.uuid ?? null);

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
          The most recent images for this project, newest first.
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
        <div className="space-y-4">
          {/* Newest item, large and in focus */}
          <FeedTile item={items[0]} variant="hero" onClick={() => openItem(items[0])} />

          {/* Older items as a filmstrip below */}
          {items.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {items.slice(1).map((item) => (
                <FeedTile
                  key={itemKey(item)}
                  item={item}
                  variant="thumb"
                  onClick={() => openItem(item)}
                />
              ))}
            </div>
          )}
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
                <dd className="col-span-2">{relativeTime(openRejection.timestamp)}</dd>
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
