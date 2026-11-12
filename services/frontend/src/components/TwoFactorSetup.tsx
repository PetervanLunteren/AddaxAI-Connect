/**
 * Setting up two-factor login, in two screens.
 *
 * First the QR code for the authenticator app and a field for the first
 * code. Then the recovery codes, which are shown this once.
 *
 * Used by the login page, when a project requires two-factor login and the
 * account has none (with a pending token), and by the account dialog in the
 * user menu (without one).
 */
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { CopyButton } from './ui/CopyButton';
import {
  TwoFactorSetup as SetupData,
  enableTwoFactor,
  setupTwoFactor,
  twoFactorErrorMessage,
} from '../api/auth';

/** One look for the code fields on the login page and in the account dialog */
export const CODE_INPUT_CLASS =
  'block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

interface TwoFactorSetupProps {
  /** Set when the setup is part of a login, see LoginTwoFactorStep */
  pendingToken?: string;
  /** Called after the user has seen the recovery codes. Gets the access
   *  token when the setup was part of a login. */
  onDone: (accessToken?: string) => void;
  /** Called when the setup cannot go on, with the error of the failed call */
  onFailed?: (err: any) => void;
  /** A way out, shown under the first screen only. Once the recovery codes
   *  are on screen two-factor is on, and leaving would skip saving them. */
  cancel?: React.ReactNode;
}

export const TwoFactorSetup: React.FC<TwoFactorSetupProps> = ({ pendingToken, onDone, onFailed, cancel }) => {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [accessToken, setAccessToken] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    // Every call makes a new key, so call once. React runs effects twice in
    // development, and the QR code on screen must be the key that is stored.
    if (started.current) return;
    started.current = true;

    setupTwoFactor(pendingToken)
      .then(setSetup)
      .catch((err) => {
        setError(twoFactorErrorMessage(err));
        onFailed?.(err);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await enableTwoFactor(code, pendingToken);
      setAccessToken(result.access_token);
      setRecoveryCodes(result.recovery_codes);
    } catch (err) {
      setError(twoFactorErrorMessage(err));
      onFailed?.(err);
    } finally {
      setLoading(false);
    }
  };

  if (recoveryCodes) {
    return (
      <div className="space-y-4">
        <Callout variant="success">Two-factor login is on.</Callout>
        <p className="text-sm text-gray-700">
          Save these recovery codes somewhere safe, for example in a password manager. Each code
          logs you in once when you do not have your phone. They are not shown again.
        </p>
        <div className="relative rounded-md border bg-gray-50 p-4">
          <ul className="grid grid-cols-1 gap-1 font-mono text-sm sm:grid-cols-2">
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <CopyButton text={recoveryCodes.join('\n')} className="absolute right-2 top-2" />
        </div>
        <Button type="button" className="w-full" onClick={() => onDone(accessToken)}>
          I saved my recovery codes
        </Button>
      </div>
    );
  }

  if (!setup) {
    return error
      ? <div className="space-y-4"><Callout variant="error">{error}</Callout>{cancel}</div>
      : <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <form className="space-y-4" onSubmit={handleConfirm}>
      {error && <Callout variant="error">{error}</Callout>}

      <p className="text-sm text-gray-700">
        Scan this QR code with an authenticator app on your phone, for example Google
        Authenticator, Microsoft Authenticator or 1Password.
      </p>
      <div className="flex justify-center rounded-lg bg-white p-4">
        <QRCode value={setup.otpauth_uri} size={180} />
      </div>
      <div className="text-sm text-gray-700">
        <p>Cannot scan it? Type this key into the app.</p>
        <div className="mt-1 flex items-center gap-1">
          <code className="break-all rounded bg-gray-100 px-2 py-1 text-xs">{setup.key}</code>
          <CopyButton text={setup.key} />
        </div>
      </div>

      <div>
        <label htmlFor="two-factor-setup-code" className="block text-sm font-medium text-gray-700">
          Code from the app
        </label>
        <input
          id="two-factor-setup-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`mt-1 ${CODE_INPUT_CLASS}`}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Checking...' : 'Switch on two-factor login'}
      </Button>
      {cancel}
    </form>
  );
};
