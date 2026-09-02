/**
 * A small rounded status pill: connected, error, linked, and so on.
 *
 * One place for the tone-to-color mapping so every status badge in the app
 * reads the same. The neutral tone matches the count and "Linked" badges that
 * already exist.
 */
import React from 'react';

export type PillTone = 'success' | 'error' | 'warning' | 'neutral' | 'muted';

const TONES: Record<PillTone, string> = {
  success: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-800',
  neutral: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
};

interface StatusPillProps {
  tone: PillTone;
  children: React.ReactNode;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ tone, children, className = '' }) => (
  <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${TONES[tone]} ${className}`}>
    {children}
  </span>
);
