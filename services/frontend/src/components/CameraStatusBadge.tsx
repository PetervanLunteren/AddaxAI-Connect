import React from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../utils/camera-colors';

export type CameraStatus = keyof typeof STATUS_COLORS;

interface CameraStatusBadgeProps {
  status: CameraStatus | string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  title?: string;
}

const DOT_SIZE = { sm: 'w-2 h-2', md: 'w-3 h-3' } as const;

export const CameraStatusBadge: React.FC<CameraStatusBadgeProps> = ({
  status,
  size = 'md',
  showLabel = true,
  title,
}) => {
  const color = STATUS_COLORS[status as CameraStatus];
  const label = STATUS_LABELS[status as CameraStatus] ?? status;
  const dotClass = DOT_SIZE[size];

  if (!showLabel) {
    return (
      <span
        className={`${dotClass} rounded-full inline-block`}
        style={{ backgroundColor: color }}
        title={title ?? label}
        aria-label={label}
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title={title}>
      <span
        className={`${dotClass} rounded-full`}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
};
