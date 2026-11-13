/**
 * The admin side of two-factor login, shared by the project users page and
 * the server admins page: the label that shows an account has it on, and the
 * dialog that confirms a reset. The reset itself is an item in the row menu.
 *
 * A reset switches two-factor login off for someone else, for example after
 * a lost phone. The user gets an email about it.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
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
import { StatusPill } from './ui/StatusPill';

/** The label for an account that has two-factor login on */
export const TwoFactorPill: React.FC = () => <StatusPill tone="neutral">Two-factor</StatusPill>;

interface ResetTwoFactorDialogProps {
  /** The account to reset, null keeps the dialog closed */
  email: string | null;
  /** Set when the user cannot stay without two-factor login, as the start of
   *  a sentence that says why, for example "This project requires two-factor
   *  login for all users". The dialog then shows a note that the setup comes
   *  back at the next login. Left out when two-factor is the user's own
   *  choice. */
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
      {/* Like the other confirm dialogs: a title and a plain sentence with
          the address in bold. The box is only for the one thing that depends
          on the project, so it means something when it shows. */}
      <DialogHeader>
        <DialogTitle>Reset two-factor login</DialogTitle>
        <DialogDescription>
          This switches two-factor login off for <strong>{email}</strong>. They get an email
          about it.
          {!requiredBecause && ' They can switch it on again themselves, on their Account page.'}
        </DialogDescription>
      </DialogHeader>

      {requiredBecause && (
        <Callout variant="info">
          {requiredBecause}, so they set it up again at their next login.
        </Callout>
      )}

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
