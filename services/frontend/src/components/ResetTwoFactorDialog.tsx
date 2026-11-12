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
import { ImpactBox } from './ui/ImpactBox';

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
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ResetTwoFactorDialog: React.FC<ResetTwoFactorDialogProps> = ({
  email, pending, onCancel, onConfirm,
}) => (
  <Dialog open={email !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reset two-factor login</DialogTitle>
        <DialogDescription>
          For a user who lost their phone and their recovery codes. Make sure the request really
          comes from {email}.
        </DialogDescription>
      </DialogHeader>

      <ImpactBox
        tone="neutral"
        sections={[{
          heading: 'This will',
          bullets: [
            'Switch two-factor login off for this account',
            'End the authenticator app entry and the recovery codes of this account',
            'Send the user an email about it',
          ],
        }]}
      >
        <p className="text-sm text-muted-foreground">
          The user logs in with the password only and can set it up again. When a project requires
          two-factor login, the setup comes at the next login.
        </p>
      </ImpactBox>

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
