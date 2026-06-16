/**
 * Live feed page
 *
 * Shows the most recent items flowing into the project, newest first, and
 * refreshes on its own while the tab is focused. Successful images show how far
 * they are through the pipeline. Rejected files (for example an image sent at
 * setup before the GPS fix) show why they were refused, even though they never
 * enter the database. The newest item sits in a large focus area with its
 * metadata beside it; the filmstrip below swaps another item into focus.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { liveFeedApi, type LiveFeedItem } from '../api/liveFeed';
import { AuthenticatedImage } from '../components/AuthenticatedImage';

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
    case 'classified': return 'Done';
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

function capturedLabel(iso: string): string {
  // Camera clock, naive ISO like 2026-06-16T09:30:00. Show date and time only.
  return iso.replace('T', ' ').slice(0, 16);
}

function itemKey(item: LiveFeedItem): string {
  return item.kind === 'image' ? `image-${item.uuid}` : `rejection-${item.rejection_id}`;
}

// One tile, used both as the large hero (focus) and the smaller filmstrip
// thumbnails. Shows just the pixels with a status/reason badge and a relative
// time. The hero is static (its metadata sits beside it); thumbnails are
// buttons that swap an item into focus.
const FeedTile: React.FC<{
  item: LiveFeedItem;
  variant: 'hero' | 'thumb';
  selected?: boolean;
  onClick?: () => void;
}> = ({ item, variant, selected, onClick }) => {
  const isRejection = item.kind === 'rejection';
  const hero = variant === 'hero';
  const badgeColor = isRejection ? COLOR_BAD : statusColor(item.status);
  const badgeText = isRejection ? reasonLabel(item.reason) : statusLabel(item.status);
  // Hero shows the full image so it stays sharp when enlarged; thumbnails use
  // the small thumbnail. Rejected files only have their on-disk image.
  const src = isRejection
    ? item.image_url
    : hero && item.uuid
      ? `/api/images/${item.uuid}/full`
      : item.thumbnail_url;

  const fallback = (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <AlertTriangle className={hero ? 'h-10 w-10' : 'h-5 w-5'} />
    </div>
  );

  const base =
    (hero ? 'flex h-[60vh] w-fit items-center justify-center' : 'h-24 w-32 shrink-0') +
    ' relative overflow-hidden rounded-lg bg-muted' +
    (selected ? ' ring-2 ring-primary' : '');

  const inner = (
    <>
      {src ? (
        <AuthenticatedImage
          src={src}
          alt=""
          className={hero ? 'h-[60vh] w-auto object-contain' : 'h-24 w-32 object-cover'}
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
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={base + ' ring-offset-background transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring'}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
};

// Metadata of the focused item, shown beside the focus area.
const FocusMeta: React.FC<{ item: LiveFeedItem }> = ({ item }) => (
  <div className="w-full rounded-lg border p-4 lg:w-80 lg:shrink-0">
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Camera</dt>
      <dd className="col-span-2 break-all">{item.device_id ?? 'Unknown'}</dd>
      <dt className="text-muted-foreground">File</dt>
      <dd className="col-span-2 break-all">{item.filename}</dd>
      {item.captured_at && (
        <>
          <dt className="text-muted-foreground">Captured</dt>
          <dd className="col-span-2">{capturedLabel(item.captured_at)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Arrived</dt>
      <dd className="col-span-2">{relativeTime(item.timestamp)}</dd>
      {item.kind === 'rejection' && (
        <>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="col-span-2">{reasonLabel(item.reason)}</dd>
          {item.details && (
            <>
              <dt className="text-muted-foreground">Detail</dt>
              <dd className="col-span-2">{item.details}</dd>
            </>
          )}
        </>
      )}
    </dl>
  </div>
);

export const LiveFeedPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  // Which item sits in the focus area. Null means follow the newest; clicking a
  // filmstrip tile pins that one into focus instead.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ['live-feed', projectId],
    queryFn: () => liveFeedApi.get(projectId!, 20),
    enabled: projectId !== undefined,
    // Poll every 3s, but only while the tab is focused. react-query pauses the
    // interval in the background (refetchIntervalInBackground is off by
    // default), so it costs nothing when nobody is looking. That is why a fast
    // tick is fine here.
    refetchInterval: 3000,
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
        (() => {
          // Focus shows the pinned item, or the newest when nothing is pinned
          // (or the pinned one has aged out of the list).
          const heroItem = items.find((i) => itemKey(i) === selectedKey) ?? items[0];
          const heroKey = itemKey(heroItem);
          return (
            <div className="space-y-4">
              {/* Focus area with its metadata beside it */}
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <FeedTile item={heroItem} variant="hero" />
                <FocusMeta item={heroItem} />
              </div>

              {/* Filmstrip: click swaps the image into the focus area */}
              {items.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {items.map((item) => (
                    <FeedTile
                      key={itemKey(item)}
                      item={item}
                      variant="thumb"
                      selected={itemKey(item) === heroKey}
                      onClick={() => setSelectedKey(itemKey(item))}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
};
