/**
 * Two-factor login for the account that is logged in, opened from the user
 * menu. Off: explain and set it up. On: switch it off, with a code.
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
import { CODE_INPUT_CLASS, TwoFactorSetup } from './TwoFactorSetup';
import { disableTwoFactor, twoFactorErrorMessage } from '../api/auth';
import { useAuth } from '../hooks/useAuth';

interface TwoFactorModalProps {
  open: boolean;
  onClose: () => void;
}

export const TwoFactorModal: React.FC<TwoFactorModalProps> = ({ open, onClose }) => {
  const { user, refreshUser } = useAuth();
  const [settingUp, setSettingUp] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    setSettingUp(false);
    setCode('');
    setError('');
    onClose();
  };

  const handleSetupDone = async () => {
    await refreshUser();
    handleClose();
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await disableTwoFactor(code);
      await refreshUser();
      handleClose();
    } catch (err) {
      setError(twoFactorErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // While the setup runs the account still counts as off, until the user
  // has seen the recovery codes and the account is read again.
  const isOn = !!user?.two_factor_enabled && !settingUp;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>Two-factor login</DialogTitle>
          <DialogDescription>
            {isOn
              ? 'Two-factor login is on. You log in with your password and a code from your authenticator app.'
              : 'Protect your account with a second step. After your password you type a code from an authenticator app on your phone.'}
          </DialogDescription>
        </DialogHeader>

        {isOn && (
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
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={loading}>
                {loading ? 'Switching off...' : 'Switch off'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {!isOn && !settingUp && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
            <Button type="button" onClick={() => setSettingUp(true)}>Set up</Button>
          </DialogFooter>
        )}

        {settingUp && <TwoFactorSetup onDone={handleSetupDone} />}
      </DialogContent>
    </Dialog>
  );
};
