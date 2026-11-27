/**
 * The words for a SIM expiry date, for the camera slide-out and the cameras
 * table. Whether a card counts as expiring is the server's rule
 * (`sim_expiring` on the camera, shared/camera_status.py), the same one the
 * monthly email and To do use.
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

/** Red text for a card that is expiring, muted otherwise. */
export const simExpiryClass = (expiring: boolean): string =>
  expiring ? 'text-destructive' : 'text-muted-foreground';
