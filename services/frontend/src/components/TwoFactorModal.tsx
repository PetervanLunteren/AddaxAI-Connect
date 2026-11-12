/**
 * Two-factor login for the account that is logged in, opened from the
 * Account page. Off: the setup starts at once, the button on the page was
 * the decision. On: switch it off, with a code.
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { useToast } from './ui/Toaster';
import { CODE_INPUT_CLASS, TwoFactorSetup } from './TwoFactorSetup';
import { disableTwoFactor, twoFactorErrorMessage } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';

interface TwoFactorModalProps {
  open: boolean;
  onClose: () => void;
}

export const TwoFactorModal: React.FC<TwoFactorModalProps> = ({ open, onClose }) => {
  const { user, refreshUser } = useAuth();
  const { projects } = useProject();
  const toast = useToast();
  // True from the moment two-factor is on until the user confirms the
  // recovery codes. They are shown once, so the dialog cannot be closed
  // around them.
  const [showingCodes, setShowingCodes] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const close = () => {
    setShowingCodes(false);
    setCode('');
    setError('');
    onClose();
  };

  // Escape, the X and a click outside. Not while the recovery codes are up.
  const handleDismiss = () => {
    if (!showingCodes) close();
  };

  const handleEnabled = () => {
    setShowingCodes(true);
    // Read the account again right away, so the menu says "On" whatever
    // happens to this dialog next.
    refreshUser();
  };

  const handleSetupDone = () => {
    close();
    toast.success('Two-factor login is on');
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await disableTwoFactor(code);
      await refreshUser();
      close();
      toast.success('Two-factor login is off');
    } catch (err) {
      setError(twoFactorErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // While the recovery codes are up this dialog still shows the setup,
  // although the account itself already reads as on.
  const isOn = !!user?.two_factor_enabled && !showingCodes;
  // The API refuses to switch it off while a project requires it. Say so up
  // front, the user's projects are loaded already.
  const isRequired = !!projects?.some((project) => project.require_two_factor);

  return (
    <Dialog open={open} onOpenChange={handleDismiss}>
      <DialogContent onClose={showingCodes ? undefined : close}>
        <DialogHeader>
          <DialogTitle>Two-factor login</DialogTitle>
          {!showingCodes && (
            <DialogDescription>
              {isOn
                ? 'Two-factor login is on. You log in with your password and a code from your authenticator app.'
                : 'Protect your account with a second step. After your password you type a code from an authenticator app on your phone.'}
            </DialogDescription>
          )}
        </DialogHeader>

        {isOn && isRequired && (
          <>
            <Callout variant="info">
              A project you can open requires two-factor login, so you cannot switch it off.
            </Callout>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Close</Button>
            </DialogFooter>
          </>
        )}

        {isOn && !isRequired && (
          <form onSubmit={handleDisable}>
            <div className="space-y-4 py-2">
              {error && <Callout variant="error">{error}</Callout>}
              <div>
                <label htmlFor="two-factor-disable-code" className="block text-sm font-medium mb-1">
                  To switch it off, type a code from the app or a recovery code
                </label>
                <input
                  id="two-factor-disable-code"
                  type="text"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={CODE_INPUT_CLASS}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={loading}>
                {loading ? 'Switching off...' : 'Switch off'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {!isOn && <TwoFactorSetup onEnabled={handleEnabled} onDone={handleSetupDone} />}
      </DialogContent>
    </Dialog>
  );
};
