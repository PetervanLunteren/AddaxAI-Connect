/**
 * The amber mark on a move nobody checked yet that looks like a GPS error
 * (`suspicious` in update-items.ts). One part for the Moves table and the
 * check window, so the word and the colour are the same in both.
 */
import { AlertTriangle } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';
import { SUSPICIOUS_REASON } from './update-items';

export function SuspiciousPill() {
  return (
    <span title={SUSPICIOUS_REASON}>
      <StatusPill tone="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Suspicious
      </StatusPill>
    </span>
  );
}
