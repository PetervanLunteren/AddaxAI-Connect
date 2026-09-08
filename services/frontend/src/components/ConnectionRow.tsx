/**
 * A connection row for an integration that is set up by filling in a short
 * form: one API key, or an account and the group it posts into.
 *
 * Built on SettingRow so it lines up with every other settings row. The left
 * side shows a status pill and a one-line description; the right side shows the
 * actions. Empty, there is one Connect button; connected, there is an optional
 * test button plus a replace button and Disconnect. The values are entered in a
 * modal, the way the Telegram bot token is, never inline.
 *
 * EarthRanger uses it with one secret field, Sensing Clues with an address, an
 * account and a group id. A secret is never prefilled, so changing anything
 * else means typing the password again; that keeps one rule instead of an
 * "empty means keep the old one" branch.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SettingRow } from './ui/SettingRow';
import { StatusPill, PillTone } from './ui/StatusPill';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog';

export interface ConnectionField {
  /** Key in the object handed to onSave. */
  name: string;
  label: string;
  placeholder?: string;
  /** Masked, never prefilled, never trimmed. */
  secret?: boolean;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>['inputMode'];
  /** Filled in when the modal opens. Ignored for a secret. */
  defaultValue?: string;
  /** One line under the field. */
  help?: React.ReactNode;
}

interface ConnectionRowProps {
  title: string;
  isConfigured: boolean;
  /** Status pill shown when configured. */
  pill?: { tone: PillTone; label: string } | null;
  /** Left-column text after the pill, when configured. */
  statusDetail?: React.ReactNode;
  /** Left-column text when nothing is saved. */
  emptyDescription?: React.ReactNode;
  /** Info callout shown under the row, for a state the pill does not
   *  cover: nothing saved (the rules below stay put and resume once
   *  something is), or saved but no rule active (nothing is sent yet). The
   *  caller decides which applies; null hides it. */
  note?: React.ReactNode;
  /** What the modal asks for. */
  fields: ConnectionField[];
  /** Save the form. Return a promise so the modal closes only on success. */
  onSave: (values: Record<string, string>) => Promise<unknown> | void;
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
  /** Label of the button that opens the modal again once connected. */
  replaceLabel?: string;
  /** Modal title when connecting. */
  modalTitle: string;
  /** Modal title when changing an existing connection. Defaults to modalTitle. */
  replaceModalTitle?: string;
  /** Submit button in the modal. */
  saveLabel?: string;
  /** Help shown above the fields in the modal. */
  modalHelp?: React.ReactNode;
  /** Troubleshooting link, shown in the test modal. */
  docsUrl?: string;
  docsLabel?: string;
}

export const ConnectionRow: React.FC<ConnectionRowProps> = ({
  title, isConfigured, pill, statusDetail, emptyDescription, note,
  fields, onSave, onDisconnect, onTest,
  testLabel = 'Send test event', testModalTitle = 'Send a test event',
  testExplanation, testSuccessMessage = 'Test passed.',
  connectLabel = 'Connect', replaceLabel = 'Replace key',
  modalTitle, replaceModalTitle, saveLabel = 'Save', modalHelp,
  docsUrl, docsLabel = 'Setup and troubleshooting guide',
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: React.ReactNode } | null>(null);

  const openModal = () => {
    setValues(Object.fromEntries(
      fields.map((field) => [field.name, field.secret ? '' : field.defaultValue ?? '']),
    ));
    setModalOpen(true);
  };

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

  // A secret is sent as typed: trimming it would silently break a
  // password that really ends in a space.
  const cleaned = Object.fromEntries(fields.map((field) => [
    field.name,
    field.secret ? values[field.name] ?? '' : (values[field.name] ?? '').trim(),
  ]));
  const canSubmit = fields.every((field) => cleaned[field.name]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      await onSave(cleaned);
      setModalOpen(false);
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
              <Button type="button" size="sm" variant="outline" onClick={openModal}>{replaceLabel}</Button>
              <Button type="button" size="sm" variant="outline" onClick={onDisconnect}>Disconnect</Button>
            </>
          )}
        </div>
      </SettingRow>

      {note && (
        <Callout variant="info" className="mt-4">{note}</Callout>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{isConfigured ? (replaceModalTitle ?? modalTitle) : modalTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {modalHelp && (
              <p className="text-sm text-muted-foreground">{modalHelp}</p>
            )}
            {fields.map((field, index) => (
              <div key={field.name}>
                <label className="block text-sm font-medium mb-2">{field.label}</label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  inputMode={field.inputMode}
                  value={values[field.name] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  autoFocus={index === 0}
                  className={`w-full px-3 py-2 border rounded-md text-sm${field.secret ? ' font-mono' : ''}`}
                />
                {field.help && (
                  <p className="text-xs text-muted-foreground mt-1">{field.help}</p>
                )}
              </div>
            ))}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !canSubmit}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {saveLabel}
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
