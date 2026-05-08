/**
 * Scheduled reminders manager (slideout).
 *
 * Opens from the Notifications page. Lists the current user's own
 * reminders for the project, plus a History accordion of sent and
 * cancelled rows. Supports add, edit, and cancel.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Edit2, Loader2, Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from './ui/Sheet';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/Toaster';
import { remindersApi, type Reminder } from '../api/reminders';

interface RemindersSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; reminder: Reminder };

export const RemindersSheet: React.FC<RemindersSheetProps> = ({ open, onClose, projectId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: reminders } = useQuery({
    queryKey: ['project-reminders', projectId],
    queryFn: () => remindersApi.list(projectId),
    enabled: open && projectId > 0,
  });

  const active = (reminders || []).filter((r) => !r.sent_at && !r.cancelled_at);
  const history = (reminders || []).filter((r) => r.sent_at || r.cancelled_at);

  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [reminderToCancel, setReminderToCancel] = useState<Reminder | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['project-reminders', projectId] });

  const createMutation = useMutation({
    mutationFn: ({ sendOn, message }: { sendOn: string; message: string }) =>
      remindersApi.create(projectId, sendOn, message),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Reminder scheduled');
    },
    onError: (error: any) => {
      toast.error(`Failed to schedule reminder: ${error.response?.data?.detail || error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, sendOn, message }: { id: number; sendOn: string; message: string }) =>
      remindersApi.update(projectId, id, { send_on: sendOn, message }),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Reminder updated');
    },
    onError: (error: any) => {
      toast.error(`Failed to update reminder: ${error.response?.data?.detail || error.message}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => remindersApi.cancel(projectId, id),
    onSuccess: () => {
      invalidate();
      setReminderToCancel(null);
      toast.success('Reminder cancelled');
    },
    onError: (error: any) => {
      toast.error(`Failed to cancel reminder: ${error.response?.data?.detail || error.message}`);
      setReminderToCancel(null);
    },
  });

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Scheduled reminders</SheetTitle>
            <SheetDescription>
              Schedule a one-shot email to yourself on a future date. The email
              arrives on that date and does not repeat. Useful for project end
              dates, seasonal cleanup deadlines, hardware swaps.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add reminder
              </Button>
            </div>

            {active.length > 0 ? (
              <ul className="divide-y border rounded-md">
                {active.map((r) => (
                  <li key={r.id} className="p-3 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.send_on}</p>
                      <p className="text-sm mt-1 whitespace-pre-wrap break-words">{r.message}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: 'edit', reminder: r })}
                      className="text-muted-foreground"
                      aria-label="Edit reminder"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReminderToCancel(r)}
                      className="text-muted-foreground"
                      aria-label="Cancel reminder"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No scheduled reminders.</p>
            )}

            {history.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((o) => !o)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  {historyOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  History ({history.length})
                </button>
                {historyOpen && (
                  <ul className="mt-2 divide-y border rounded-md text-muted-foreground">
                    {history.map((r) => {
                      const status = r.cancelled_at
                        ? `Cancelled ${r.cancelled_at.slice(0, 10)}`
                        : `Sent ${r.sent_at?.slice(0, 10)}`;
                      return (
                        <li key={r.id} className="p-3">
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="font-medium">{r.send_on}</span>
                            <span>·</span>
                            <span>{status}</span>
                          </div>
                          <p className="text-sm mt-1 whitespace-pre-wrap break-words">{r.message}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {(dialog.kind === 'add' || dialog.kind === 'edit') && (
        <ReminderEditDialog
          mode={dialog}
          isPending={
            dialog.kind === 'add' ? createMutation.isPending : updateMutation.isPending
          }
          onClose={() => setDialog({ kind: 'closed' })}
          onConfirm={(sendOn, message) => {
            if (dialog.kind === 'add') {
              createMutation.mutate({ sendOn, message });
            } else {
              updateMutation.mutate({ id: dialog.reminder.id, sendOn, message });
            }
          }}
        />
      )}

      <ConfirmDialog
        open={reminderToCancel !== null}
        onClose={() => setReminderToCancel(null)}
        onConfirm={() => {
          if (reminderToCancel) cancelMutation.mutate(reminderToCancel.id);
        }}
        title="Cancel this reminder?"
        body={
          reminderToCancel
            ? `The reminder for ${reminderToCancel.send_on} will not be sent.`
            : ''
        }
        confirmLabel="Cancel reminder"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={cancelMutation.isPending}
      />
    </>
  );
};

interface ReminderEditDialogProps {
  mode: { kind: 'add' } | { kind: 'edit'; reminder: Reminder };
  isPending: boolean;
  onClose: () => void;
  onConfirm: (sendOn: string, message: string) => void;
}

const ReminderEditDialog: React.FC<ReminderEditDialogProps> = ({
  mode, isPending, onClose, onConfirm,
}) => {
  const initialDate = mode.kind === 'edit' ? mode.reminder.send_on : '';
  const initialMessage = mode.kind === 'edit' ? mode.reminder.message : '';
  const [date, setDate] = useState(initialDate);
  const [message, setMessage] = useState(initialMessage);
  const todayIso = new Date().toISOString().slice(0, 10);

  const isEdit = mode.kind === 'edit';
  const canConfirm = !!date && message.trim().length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit reminder' : 'Add a scheduled reminder'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Adjust the date or message. The reminder will fire on the new date.'
              : 'Pick a future date and write the message you want to send yourself. The email arrives in your inbox on that date and does not repeat.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Date</label>
            <input
              type="date"
              value={date}
              min={todayIso}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="e.g., The breeding season is about to start, do not forget to remove the cameras before it is too late."
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(date, message)}
            disabled={isPending || !canConfirm}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Schedule reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
