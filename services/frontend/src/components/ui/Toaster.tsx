/**
 * Lightweight toast notifications.
 *
 * Replaces in-browser alert() popups across the app. Toasts stack in the
 * bottom-right corner and auto-dismiss after a few seconds. Two kinds:
 * success (teal) and error (destructive). No external dependency.
 *
 * Usage:
 *   1. Mount <Toaster /> once near the root (App.tsx).
 *   2. From any component: const toast = useToast(); toast.success('Saved');
 *      Errors: toast.error('Save failed: ...').
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

type ToastKind = 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;
let nextId = 1;

export const Toaster: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => remove(id), DEFAULT_DURATION_MS);
  }, [remove]);

  const value: ToastContextValue = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-auto"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  // Tiny entrance animation: fade + slide up.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 10);
    return () => window.clearTimeout(timer);
  }, []);

  const isError = toast.kind === 'error';
  return (
    <div
      className={`flex items-start gap-3 rounded-md border bg-background shadow-lg p-3 pr-2 transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      } ${isError ? 'border-destructive/40' : 'border-primary/40'}`}
    >
      {isError ? (
        <XCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
      )}
      <p className="text-sm flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-muted-foreground hover:text-foreground p-0.5 -m-0.5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Crash early so a forgotten <Toaster> wrapper does not silently swallow
    // notifications. CONVENTIONS rule #1.
    throw new Error('useToast() used outside <Toaster>. Wrap the app in <Toaster> in App.tsx.');
  }
  return ctx;
}
