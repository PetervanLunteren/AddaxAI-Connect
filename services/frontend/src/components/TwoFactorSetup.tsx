/**
 * Setting up two-factor login, in two screens.
 *
 * First three numbered steps: install an app, scan the QR code, type the
 * first code. Then the recovery codes, which are shown this once.
 *
 * Used by the login page, when a project requires two-factor login and the
 * account has none (with a pending token), and by the dialog on the Account
 * page (without one).
 */
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Download, Loader2 } from 'lucide-react';
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
  /** Called the moment two-factor login is on and the recovery codes come
   *  on screen. From here on the parent must not offer a way to leave
   *  except through onDone, or the codes are gone unseen. */
  onEnabled?: () => void;
  /** Called after the user has seen the recovery codes. Gets the access
   *  token when the setup was part of a login. */
  onDone: (accessToken?: string) => void;
  /** Called when the setup cannot go on, with the error of the failed call */
  onFailed?: (err: any) => void;
  /** A way out, shown under the first screen only. Once the recovery codes
   *  are on screen two-factor is on, and leaving would skip saving them. */
  cancel?: React.ReactNode;
}

/** One numbered step of the setup: the number, what to do, and what it needs */
const Step: React.FC<{
  number: number;
  title: string;
  /** Set when the step is one input, so its title is the input's label */
  titleFor?: string;
  children: React.ReactNode;
}> = ({ number, title, titleFor, children }) => (
  <li className="flex gap-3">
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
      aria-hidden="true"
    >
      {number}
    </span>
    <div className="min-w-0 flex-1 space-y-2 text-sm text-gray-700">
      <label htmlFor={titleFor} className="block font-medium text-foreground">{title}</label>
      {children}
    </div>
  </li>
);

export const TwoFactorSetup: React.FC<TwoFactorSetupProps> = ({ pendingToken, onEnabled, onDone, onFailed, cancel }) => {
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
    // The first code is always six digits from the app. Anything else is a
    // typo, and it should not count as one of the five wrong codes the server
    // allows before it blocks the account.
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      setError('Type the six digits the app shows.');
      return;
    }
    setLoading(true);
    try {
      const result = await enableTwoFactor(code, pendingToken);
      setAccessToken(result.access_token);
      setRecoveryCodes(result.recovery_codes);
      onEnabled?.();
    } catch (err) {
      setError(twoFactorErrorMessage(err));
      onFailed?.(err);
    } finally {
      setLoading(false);
    }
  };

  // The codes as a text file, with what they belong to. A year from now a
  // bare list of codes in a downloads folder means nothing.
  const downloadRecoveryCodes = () => {
    const text = [
      'AddaxAI Connect recovery codes',
      `Server: ${window.location.host}`,
      `Account: ${setup?.email ?? ''}`,
      '',
      'Each code logs you in once when you do not have your phone.',
      '',
      ...(recoveryCodes ?? []),
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'addaxai-connect-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (recoveryCodes) {
    return (
      <div className="space-y-4">
        <Callout variant="success">Two-factor login is on.</Callout>
        <p className="text-sm text-gray-700">
          Save these recovery codes somewhere safe, for example in a password manager. Each code
          logs you in once when you do not have your phone. They are not shown again.
        </p>
        <div className="rounded-md border bg-gray-50 px-4 pb-4 pt-2">
          {/* The buttons have their own row, so they never sit on a code */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Recovery codes</span>
            <div className="flex items-center">
              <button
                type="button"
                onClick={downloadRecoveryCodes}
                className="inline-flex items-center justify-center p-2 hover:bg-accent rounded transition-colors"
                title="Download as a text file"
                aria-label="Download as a text file"
              >
                <Download className="h-3 w-3 text-muted-foreground" />
              </button>
              <CopyButton text={recoveryCodes.join('\n')} />
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-sm sm:grid-cols-2">
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode} className="whitespace-nowrap">{recoveryCode}</li>
            ))}
          </ul>
        </div>
        {/* A plain label. "I saved my codes" made people claim it, not do it. */}
        <Button type="button" className="w-full" onClick={() => onDone(accessToken)}>
          Continue
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
    <form className="space-y-5" onSubmit={handleConfirm}>
      <ol className="space-y-5">
        <Step number={1} title="Install an authenticator app on your phone">
          <p>
            For example Google Authenticator or Microsoft Authenticator. Both are free in the
            App Store and on Google Play.
          </p>
        </Step>

        <Step number={2} title="Scan this QR code with the app">
          <div className="flex justify-center rounded-lg bg-white p-4">
            <QRCode value={setup.otpauth_uri} size={180} />
          </div>
          {/* A phone cannot scan its own screen. The link holds what the QR
              code holds and opens the authenticator app on the phone itself. */}
          <p className="text-center sm:hidden">
            <a href={setup.otpauth_uri} className="font-medium text-primary underline underline-offset-4">
              Open in your authenticator app
            </a>
          </p>
          <p>Cannot scan it? Type this key into the app.</p>
          <div className="flex items-center justify-center gap-1 rounded-md border bg-gray-50 px-3 py-1">
            <code className="break-all font-mono text-xs">{setup.key}</code>
            <CopyButton text={setup.key} />
          </div>
        </Step>

        <Step number={3} title="Type the six-digit code the app shows" titleFor="two-factor-setup-code">
          <input
            id="two-factor-setup-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={CODE_INPUT_CLASS}
          />
          {/* Next to the field it is about. At the top of the form it can be
              out of view on a phone, three steps up. */}
          {error && <Callout variant="error">{error}</Callout>}
        </Step>
      </ol>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Checking...' : 'Switch on two-factor login'}
      </Button>
      {cancel}
    </form>
  );
};
