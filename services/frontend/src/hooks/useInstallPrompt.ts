/**
 * Install-to-device support.
 *
 * Chromium browsers (Android, desktop Chrome/Edge) fire beforeinstallprompt
 * when the app can be installed, and calling prompt() on that event opens the
 * real install dialog. The event can fire before any component mounts, so the
 * listener lives at module scope and runs when the bundle loads.
 *
 * Safari has no install API at all. iPhone, iPad, and macOS Safari get manual
 * instructions instead (see components/InstallApp.tsx), and after an install
 * there is no signal, so on those platforms the install entry stays visible
 * in the browser even when the app is already on the home screen.
 */
import { useSyncExternalStore } from 'react';

// Chromium-only event, not in lib.dom.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode =
  | 'native' // Chromium, one click opens the browser's install dialog
  | 'ios-safari' // iPhone/iPad Safari, show the Add to Home Screen steps
  | 'ios-browser' // other iPhone/iPad browsers, user must switch to Safari
  | 'macos-safari' // macOS Safari, show the Add to Dock steps
  | 'none'; // already installed, or the browser cannot install

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

window.addEventListener('beforeinstallprompt', (e: Event) => {
  // preventDefault suppresses Chrome's own mini-infobar on Android, the
  // sidebar entry and hint are the app's install UI.
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installedThisSession = true;
  notify();
});

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

// iPadOS Safari reports itself as a Mac, touch support is the tell.
const isIosDevice = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// Every iOS browser is WebKit, but only Safari itself can put the app on the
// home screen as a standalone app. Third-party browsers add their own UA
// token (CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge, GSA = Google app).
const isIosSafari = (): boolean =>
  !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);

const isMacSafari = (): boolean =>
  /Macintosh/.test(navigator.userAgent) &&
  /Safari/.test(navigator.userAgent) &&
  !/Chrome|Chromium|Edg/.test(navigator.userAgent) &&
  navigator.maxTouchPoints <= 1;

const currentMode = (): InstallMode => {
  if (installedThisSession || isStandalone()) return 'none';
  if (deferredPrompt) return 'native';
  if (isIosDevice()) return isIosSafari() ? 'ios-safari' : 'ios-browser';
  if (isMacSafari()) return 'macos-safari';
  // Chromium without a captured event (already installed, or the browser
  // decided the app is not installable) and Firefox desktop end up here.
  return 'none';
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Open the browser's install dialog. Only valid in 'native' mode.
 */
export function promptInstall(): void {
  if (!deferredPrompt) {
    // Crash early, callers must only offer this action in 'native' mode.
    throw new Error('promptInstall() called without a captured beforeinstallprompt event');
  }
  const prompt = deferredPrompt;
  void prompt.prompt();
  // The event is single-use. Chrome fires a fresh one on a later visit if
  // the user dismissed the dialog.
  void prompt.userChoice.finally(() => {
    deferredPrompt = null;
    notify();
  });
}

export function useInstallPrompt(): InstallMode {
  return useSyncExternalStore(subscribe, currentMode);
}
