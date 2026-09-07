/**
 * The connection row's pill and one-line detail, shared by the integration
 * pages so EarthRanger and Sensing Clues describe their state the same way.
 */
import { PillTone } from '../components/ui/StatusPill';

export interface ConnectionHealth {
  health_status: 'healthy' | 'error' | null;
  last_health_check: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  events_sent: number;
}

export const errorDetail = (error: any): string =>
  error?.response?.data?.detail || error?.message || 'Unknown error';

export const formatWhen = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : 'never';

export const connectionPill = (status: ConnectionHealth | undefined): { tone: PillTone; label: string } =>
  status?.health_status === 'healthy' ? { tone: 'success', label: 'Connected' }
  : status?.health_status === 'error' ? { tone: 'error', label: 'Error' }
  : { tone: 'muted', label: 'Untested' };

/**
 * One line after the pill. hint is the leading fragment that identifies
 * the setting ("Key ending abcd. " or "Group 3523928. "), sentTerm is what
 * the integration sends ("event", "observation"), untested is the text for
 * a connection that has never been tried.
 */
export const connectionDetail = (
  status: ConnectionHealth,
  hint: string,
  sentTerm: string,
  untested: string,
): string => {
  if (status.health_status === 'error') {
    return `${hint}Last attempt failed${status.last_health_check ? ` on ${formatWhen(status.last_health_check)}` : ''}.${status.last_error ? ` ${status.last_error}` : ''}`;
  }
  if (status.health_status === 'healthy') {
    const sent = status.events_sent > 0
      ? ` Last ${sentTerm} sent ${formatWhen(status.last_sent_at)}, ${status.events_sent} ${sentTerm}${status.events_sent !== 1 ? 's' : ''} in total.`
      : '';
    return `${hint}Last confirmed ${formatWhen(status.last_health_check)}.${sent}`;
  }
  return `${hint}${untested}`;
};
