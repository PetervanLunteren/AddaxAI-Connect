/**
 * The status of a row on the Moves page, as one pill, for the table and the
 * check window alike, so the words and colours are the same in both.
 *
 * Quiet: a move nobody checked shows nothing. A suspicious one (a move
 * nobody checked that came back within a week, `suspicious` in
 * moves.ts) shows an amber pill with the reason on hover; a checked
 * move or a correction shows a plain pill.
 */
import { AlertTriangle } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';
import { STATUS_LABELS, SUSPICIOUS_REASON, rowStatus, type MoveRow } from './moves';

export function MoveStatus({ it }: { it: MoveRow }) {
  if (it.suspicious) {
    return (
      <span title={SUSPICIOUS_REASON}>
        <StatusPill tone="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Suspicious
        </StatusPill>
      </span>
    );
  }
  const status = rowStatus(it);
  if (status === 'notChecked') return null;
  return <StatusPill tone="neutral">{STATUS_LABELS[status]}</StatusPill>;
}
