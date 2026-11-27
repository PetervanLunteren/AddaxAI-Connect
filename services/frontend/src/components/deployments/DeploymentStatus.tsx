/**
 * The status of a deployment, as one pill, for the Deployments table and
 * the deployment card alike, so the words and colours are the same in both.
 *
 * Quiet: most deployments show nothing. A suspicious one (rows.ts) shows an
 * amber pill with the reason on hover; a corrected one a plain pill.
 */
import { AlertTriangle } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';
import { SUSPICIOUS_REASON, type DeploymentRow } from './rows';

export function DeploymentStatus({ row }: { row: DeploymentRow }) {
  if (row.suspicious) {
    return (
      <span title={SUSPICIOUS_REASON}>
        <StatusPill tone="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Suspicious
        </StatusPill>
      </span>
    );
  }
  if (row.corrected) return <StatusPill tone="neutral">Corrected</StatusPill>;
  return null;
}
