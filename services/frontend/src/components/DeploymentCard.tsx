/**
 * Deployment card.
 *
 * One consistent card for a deployment, used by both the site slideout and the
 * camera slideout. Shows site name, camera id, date range and image count, each
 * with an icon. Clickable when onClick is given (the site slideout opens the
 * assign-site modal); static otherwise (the camera history is read-only).
 */
import React from 'react';
import { MapPin, Camera, Calendar, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  siteName: string | null;
  cameraName: string;
  startDate: string | null;
  endDate: string | null;
  imageCount: number;
  onClick?: () => void;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

export const DeploymentCard: React.FC<Props> = ({
  siteName,
  cameraName,
  startDate,
  endDate,
  imageCount,
  onClick,
}) => {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={cn(
        'w-full text-left rounded-md border p-3 space-y-1 text-sm',
        clickable ? 'cursor-pointer hover:bg-muted/50' : '',
      )}
    >
      <Row icon={<MapPin className="h-4 w-4 text-primary" />}>
        <span className="font-medium">{siteName ?? 'Unassigned site'}</span>
      </Row>
      <Row icon={<Camera className="h-4 w-4" />}>{cameraName}</Row>
      <Row icon={<Calendar className="h-4 w-4" />}>
        {fmtDate(startDate)} to {endDate ? fmtDate(endDate) : 'now'}
      </Row>
      <Row icon={<ImageIcon className="h-4 w-4" />}>
        {imageCount.toLocaleString()} images
      </Row>
    </button>
  );
};
