/**
 * A connection row for an integration that is set up by pasting an API key.
 *
 * Built on SettingRow so it lines up with every other settings row. The left
 * side shows a status pill and a one-line description; the right side shows the
 * actions. Empty, there is one Connect button; connected, there is an optional
 * test button plus Replace key and Disconnect. The key itself is entered in a
 * modal, the way the Telegram bot token is, never inline.
 *
 * EarthRanger is the first user; the next API-key integrations (Sensing Clues,
 * Wildbook, GBIF) reuse it by passing their own status, labels and handlers.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SettingRow } from './ui/SettingRow';
import { StatusPill, PillTone } from './ui/StatusPill';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';

interface ApiKeyConnectionRowProps {
  title: string;
  isConfigured: boolean;
  /** Status pill shown when configured. */
  pill?: { tone: PillTone; label: string } | null;
  /** Left-column text after the pill, when configured. */
  statusDetail?: React.ReactNode;
  /** Left-column text when no key is saved. */
  emptyDescription?: React.ReactNode;
  /** Info callout shown under the row when no key is saved, e.g. to say
   *  that the rules below stay put and resume once a key is saved. */
  disconnectedNote?: React.ReactNode;
  /** Save a key. Return a promise so the modal closes only on success. */
  onSaveKey: (key: string) => Promise<unknown> | void;
  onDisconnect: () => void;
  /** Optional test action. Resolve on success, reject with an Error whose
   *  message is shown in the test modal on failure. Opens a modal with the
   *  explanation, a send button and the result, so the page stays clean. */
  onTest?: () => Promise<unknown> | void;
  testLabel?: string;
  testModalTitle?: string;
  /** What a test does, shown in the test modal. */
  testExplanation?: React.ReactNode;
  /** Shown on a passing test. */
  testSuccessMessage?: React.ReactNode;
  connectLabel?: string;
  modalTitle: string;
  keyLabel?: string;
  keyPlaceholder?: string;
  /** Help shown above the key field in the modal. */
  modalHelp?: React.ReactNode;
  /** Troubleshooting link, shown in the test modal. */
  docsUrl?: string;
  docsLabel?: string;
}

export const ApiKeyConnectionRow: React.FC<ApiKeyConnectionRowProps> = ({
  title, isConfigured, pill, statusDetail, emptyDescription, disconnectedNote,
  onSaveKey, onDisconnect, onTest,
  testLabel = 'Send test event', testModalTitle = 'Send a test event',
  testExplanation, testSuccessMessage = 'Test passed.',
  connectLabel = 'Connect',
  modalTitle, keyLabel = 'API key', keyPlaceholder, modalHelp,
  docsUrl, docsLabel = 'Setup and troubleshooting guide',
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: React.ReactNode } | null>(null);

  const openModal = () => { setKeyInput(''); setModalOpen(true); };

  const openTestModal = () => { setTestResult(null); setTestModalOpen(true); };

  const runTest = async () => {
    if (!onTest) return;
    try {
      setTestPending(true);
      setTestResult(null);
      await onTest();
      setTestResult({ ok: true, message: testSuccessMessage });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed.' });
    } finally {
      setTestPending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    try {
      setSubmitting(true);
      await onSaveKey(key);
      setModalOpen(false);
      setKeyInput('');
    } catch {
      // The caller surfaces the error as a toast; keep the modal open.
    } finally {
      setSubmitting(false);
    }
  };

  const description = isConfigured ? (
    <>
      {pill && <StatusPill tone={pill.tone} className="mr-2 align-middle">{pill.label}</StatusPill>}
      {statusDetail}
    </>
  ) : emptyDescription;

  return (
    <>
      <SettingRow title={title} description={description}>
        <div className="flex flex-wrap gap-2">
          {!isConfigured ? (
            <Button type="button" size="sm" onClick={openModal}>{connectLabel}</Button>
          ) : (
            <>
              {onTest && (
                <Button type="button" size="sm" onClick={openTestModal}>
                  {testLabel}
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={openModal}>Replace key</Button>
              <Button type="button" size="sm" variant="outline" onClick={onDisconnect}>Disconnect</Button>
            </>
          )}
        </div>
      </SettingRow>

      {!isConfigured && disconnectedNote && (
        <Callout variant="info" className="mt-4">{disconnectedNote}</Callout>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {modalHelp && (
              <p className="text-sm text-muted-foreground">{modalHelp}</p>
            )}
            <div>
              <label className="block text-sm font-medium mb-2">{keyLabel}</label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={keyPlaceholder}
                autoComplete="off"
                autoFocus
                className="w-full px-3 py-2 border rounded-md font-mono text-sm"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !keyInput.trim()}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save key
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent onClose={() => setTestModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{testModalTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {testExplanation && (
              <p className="text-sm text-muted-foreground">{testExplanation}</p>
            )}
            {testResult && (
              <Callout variant={testResult.ok ? 'success' : 'error'}>
                {testResult.message}
              </Callout>
            )}
            {docsUrl && testResult && !testResult.ok && (
              <p className="text-sm text-muted-foreground">
                <a href={docsUrl} target="_blank" rel="noreferrer" className="underline">{docsLabel}</a>
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setTestModalOpen(false)}>
                Close
              </Button>
              <Button type="button" size="sm" onClick={runTest} disabled={testPending}>
                {testPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {testLabel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
