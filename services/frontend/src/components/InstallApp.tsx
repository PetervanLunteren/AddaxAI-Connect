/**
 * Install-as-app UI.
 *
 * Three pieces sharing one dialog:
 * - InstallAppButton, the quiet permanent entry at the bottom of the sidebar
 * - InstallAppDialog, per-platform install steps (Safari has no install API,
 *   so iPhone, iPad, and macOS Safari get short manual instructions)
 * - InstallHint, a small one-time card so users discover the feature at all,
 *   dismissed forever with one tap
 *
 * Everything renders nothing when the app already runs installed or the
 * browser cannot install, driven by useInstallPrompt.
 */
import React, { useState } from 'react';
import { MonitorSmartphone, MoreHorizontal, Share, SquarePlus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';
import { useInstallPrompt, promptInstall, type InstallMode } from '../hooks/useInstallPrompt';

const HINT_DISMISSED_KEY = 'install_hint_dismissed';

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <li className="flex items-start gap-3">
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
      {n}
    </span>
    <span className="text-sm">{children}</span>
  </li>
);

const IosSafariSteps: React.FC = () => (
  <ol className="space-y-3">
    <Step n={1}>
      Tap the share button
      <Share className="mx-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
      in Safari. On iPhone it sits at the bottom of the screen, sometimes
      behind the
      <MoreHorizontal className="mx-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
      button at the bottom right. On iPad it sits at the top right.
    </Step>
    <Step n={2}>
      Scroll down and tap Add to Home Screen
      <SquarePlus className="mx-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />.
    </Step>
    <Step n={3}>
      Tap Add.
    </Step>
  </ol>
);

const DialogSteps: React.FC<{ mode: InstallMode }> = ({ mode }) => {
  if (mode === 'ios-safari') return <IosSafariSteps />;

  if (mode === 'ios-browser') {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          On iPhone and iPad only Safari can install the app. Open this page in
          Safari first, then follow these steps there.
        </p>
        <IosSafariSteps />
      </div>
    );
  }

  if (mode === 'macos-safari') {
    return (
      <ol className="space-y-3">
        <Step n={1}>
          Open the File menu in Safari.
        </Step>
        <Step n={2}>
          Choose Add to Dock.
        </Step>
        <Step n={3}>
          Click Add.
        </Step>
      </ol>
    );
  }

  // 'native' never reaches the dialog (the browser dialog opens instead) and
  // 'none' renders no install UI at all. Crash early over showing wrong steps.
  throw new Error(`InstallAppDialog rendered with unexpected mode "${mode}"`);
};

const InstallAppDialog: React.FC<{
  mode: InstallMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ mode, open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent onClose={() => onOpenChange(false)}>
      <DialogHeader>
        <DialogTitle>Install as an app</DialogTitle>
      </DialogHeader>
      <DialogSteps mode={mode} />
    </DialogContent>
  </Dialog>
);

/**
 * Sidebar entry. Sits above the LastUpdate line, styled to match. In native
 * mode a click opens the browser's install dialog directly, otherwise the
 * instruction dialog.
 */
export const InstallAppButton: React.FC = () => {
  const mode = useInstallPrompt();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (mode === 'none') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (mode === 'native' ? promptInstall() : setDialogOpen(true))}
        className="flex w-full items-center space-x-3 px-4 py-3 border-t border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <MonitorSmartphone className="h-5 w-5" />
        <span>Install app</span>
      </button>
      <InstallAppDialog mode={mode} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
};

/**
 * One-time discovery hint, bottom-right like a toast but it stays until the
 * user reacts. Dismissing or installing hides it forever on this device, the
 * sidebar entry remains as the permanent way in.
 */
export const InstallHint: React.FC = () => {
  const mode = useInstallPrompt();
  const [dismissed, setDismissed] = useState<boolean>(
    () => localStorage.getItem(HINT_DISMISSED_KEY) === '1',
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  if (mode === 'none' || dismissed) return null;

  const dismiss = (): void => {
    localStorage.setItem(HINT_DISMISSED_KEY, '1');
    setDismissed(true);
  };

  const onAction = (): void => {
    if (mode === 'native') {
      promptInstall();
      dismiss();
    } else {
      setDialogOpen(true);
    }
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[90] flex max-w-xs items-start gap-3 rounded-md border border-primary/40 bg-background p-3 pr-2 shadow-lg">
        <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="text-sm">AddaxAI Connect can be installed as an app on this device.</p>
          <button
            type="button"
            onClick={onAction}
            className="mt-1.5 text-sm font-medium text-primary hover:underline"
          >
            {mode === 'native' ? 'Install' : 'Show steps'}
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install hint"
          className="p-0.5 -m-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <InstallAppDialog
        mode={mode}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          // Closing the steps counts as seen, do not nag again.
          if (!open) dismiss();
        }}
      />
    </>
  );
};
