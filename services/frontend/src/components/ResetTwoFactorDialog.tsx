/**
 * The admin side of two-factor login, shared by the project users page and
 * the server admins page: the pill that shows an account has it on, the
 * button that opens the reset, and the dialog that confirms it.
 *
 * A reset switches two-factor login off for someone else, for example after
 * a lost phone. The user gets an email about it.
 */
import React from 'react';
import { Loader2, ShieldOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';

export const TwoFactorPill: React.FC = () => (
  <span
    className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap"
    style={{ backgroundColor: '#0f60641a', color: '#0f6064' }}
  >
    Two-factor
  </span>
);

export const ResetTwoFactorButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    title="Reset two-factor login"
    aria-label="Reset two-factor login"
  >
    <ShieldOff className="h-4 w-4" />
  </Button>
);

interface ResetTwoFactorDialogProps {
  /** The account to reset, null keeps the dialog closed */
  email: string | null;
  /** Set when the user cannot stay without two-factor login, as the start of
   *  a sentence that says why, for example "This project requires two-factor
   *  login for all users". The dialog then says the setup comes back at the
   *  next login. Left out when two-factor is the user's own choice. */
  requiredBecause?: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ResetTwoFactorDialog: React.FC<ResetTwoFactorDialogProps> = ({
  email, requiredBecause, pending, onCancel, onConfirm,
}) => (
  <Dialog open={email !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reset two-factor login</DialogTitle>
        <DialogDescription>
          For a user who lost their phone and their recovery codes.
        </DialogDescription>
      </DialogHeader>

      {/* What happens, in plain sentences. The second one depends on whether
          two-factor login is the user's own choice or a requirement. */}
      <Callout variant="info">
        <p>
          This switches two-factor login off for {email} and sends them an email about it.
        </p>
        <p className="mt-2">
          {requiredBecause
            ? `${requiredBecause}, so they have to set it up again at their next login.`
            : 'They can switch it on again themselves, on their Account page.'}
        </p>
      </Callout>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button onClick={onConfirm} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Reset two-factor login
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
