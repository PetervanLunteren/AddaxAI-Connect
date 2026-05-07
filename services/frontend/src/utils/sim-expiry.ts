/**
 * SIM expiry helpers shared between the camera detail slideout and the
 * cameras list column. The "is in the alert window" rule must match the
 * monthly cron exactly (services/notifications/sim_expiry.py); both
 * surfaces compare expiry against the 1st of (today's month + 2).
 */

// Human-readable status for a SIM expiry date. Used as a caption next to
// the date input on the slideout edit form and inside the cameras table cell.
export function formatSimExpiryStatus(date: string | null | undefined): string {
  if (!date) return 'Not set';
  const expiry = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  const days = Math.round((expiry.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `Expired ${Math.abs(days)} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

// Tailwind class for the SIM expiry caption. Red whenever the camera would
// appear in the next monthly SIM expiry alert (already expired or expiring
// on or before the 1st of (today's month + 2), matching the cron's
// calendar-aligned threshold). Muted otherwise so the line stays unobtrusive.
export function simExpiryStatusClass(date: string | null | undefined): string {
  if (!date) return 'text-muted-foreground';
  const expiry = new Date(date);
  expiry.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threshold = new Date(today.getFullYear(), today.getMonth() + 2, 1);
  threshold.setHours(0, 0, 0, 0);
  return expiry <= threshold ? 'text-destructive' : 'text-muted-foreground';
}
