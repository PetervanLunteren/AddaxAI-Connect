/**
 * Theft watch rules manager (slideout, beta).
 *
 * Opens from the Notifications page. Lists the current user's own theft
 * watch rules for the project. Rules are private, the creator is the
 * only recipient. Supports add, edit, pause, and delete. One rule
 * carries two triggers, the instant person outlier alert and the hourly
 * adaptive silence alert, tuned by one sensitivity preset.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit2, Loader2, Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from './ui/Sheet';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { MultiSelect, type Option } from './ui/MultiSelect';
import { useToast } from './ui/Toaster';
import {
  theftWatchApi,
  type TheftWatchRule,
  type TheftWatchRulePayload,
  type TheftWatchSensitivity,
} from '../api/theftWatch';

interface TheftWatchSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  telegramLinked: boolean;
  siteOptions: Option[];
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; rule: TheftWatchRule };

const SENSITIVITY_LABELS: Record<TheftWatchSensitivity, string> = {
  low: 'Low sensitivity',
  medium: 'Medium sensitivity',
  high: 'High sensitivity',
};

export const TheftWatchSheet: React.FC<TheftWatchSheetProps> = ({
  open, onClose, projectId, telegramLinked, siteOptions,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: rules } = useQuery({
    queryKey: ['theft-watch-rules', projectId],
    queryFn: () => theftWatchApi.list(projectId),
    enabled: open && projectId > 0,
  });

  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [ruleToDelete, setRuleToDelete] = useState<TheftWatchRule | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['theft-watch-rules', projectId] });

  const createMutation = useMutation({
    mutationFn: (payload: TheftWatchRulePayload) => theftWatchApi.create(projectId, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Theft watch rule created');
    },
    onError: (error: any) => {
      toast.error(`Failed to create rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TheftWatchRulePayload }) =>
      theftWatchApi.update(projectId, id, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Theft watch rule updated');
    },
    onError: (error: any) => {
      toast.error(`Failed to update rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      theftWatchApi.update(projectId, id, { is_active: isActive }),
    onSuccess: () => invalidate(),
    onError: (error: any) => {
      toast.error(`Failed to update rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => theftWatchApi.remove(projectId, id),
    onSuccess: () => {
      invalidate();
      setRuleToDelete(null);
      toast.success('Theft watch rule deleted');
    },
    onError: (error: any) => {
      toast.error(`Failed to delete rule: ${error.response?.data?.detail || error.message}`);
      setRuleToDelete(null);
    },
  });

  const scopeLabel = (rule: TheftWatchRule): string => {
    if (!rule.site_ids) return 'All sites';
    return `${rule.site_ids.length} site${rule.site_ids.length !== 1 ? 's' : ''}`;
  };

  const channelsLabel = (rule: TheftWatchRule): string =>
    rule.channels
      .map((c) => (c === 'email' ? 'Email' : 'Telegram'))
      .join(' + ');

  return (
    <>
      {/* While the edit or delete dialog is open, Escape and backdrop
          clicks target the dialog, not the sheet behind it */}
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o && dialog.kind === 'closed' && ruleToDelete === null) onClose();
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              Theft watch
              <span className="ml-2 align-middle inline-flex items-center px-1.5 h-5 text-[10px] font-semibold uppercase tracking-wide rounded bg-[#882000]/10 text-[#882000]">
                beta
              </span>
            </SheetTitle>
            <SheetDescription>
              Two triggers watch your cameras. A person unusually close to a
              camera alerts you right away. Where people pass often, only a
              much closer person than usual counts, and where people are
              rare, any person counts. A camera that stays silent longer
              than its own normal rhythm alerts you within hours or days.
              A new or moved camera first learns its normal pattern for 14
              days before alerts start. This feature is in beta. It can
              miss real thefts and it can raise false alarms. Only you
              receive your alerts.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add rule
              </Button>
            </div>

            {(rules || []).length > 0 ? (
              <ul className="divide-y border rounded-md">
                {(rules || []).map((rule) => (
                  <li key={rule.id} className="p-3 flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.is_active}
                      onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.is_active })}
                      disabled={toggleMutation.isPending}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                        rule.is_active ? 'bg-[#0f6064]' : 'bg-gray-300'
                      }`}
                      aria-label={rule.is_active ? 'Pause rule' : 'Resume rule'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          rule.is_active ? 'translate-x-[1.15rem]' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <div className={`flex-1 min-w-0 ${rule.is_active ? '' : 'opacity-50'}`}>
                      <p className="text-sm font-medium">{SENSITIVITY_LABELS[rule.sensitivity]}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {scopeLabel(rule)} · {channelsLabel(rule)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: 'edit', rule })}
                      className="text-muted-foreground"
                      aria-label="Edit rule"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRuleToDelete(rule)}
                      className="text-muted-foreground"
                      aria-label="Delete rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No theft watch rules yet.</p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {(dialog.kind === 'add' || dialog.kind === 'edit') && (
        <TheftWatchEditDialog
          mode={dialog}
          siteOptions={siteOptions}
          telegramLinked={telegramLinked}
          isPending={dialog.kind === 'add' ? createMutation.isPending : updateMutation.isPending}
          onClose={() => setDialog({ kind: 'closed' })}
          onConfirm={(payload) => {
            if (dialog.kind === 'add') {
              createMutation.mutate(payload);
            } else {
              updateMutation.mutate({ id: dialog.rule.id, payload });
            }
          }}
        />
      )}

      <ConfirmDialog
        open={ruleToDelete !== null}
        onClose={() => setRuleToDelete(null)}
        onConfirm={() => {
          if (ruleToDelete) deleteMutation.mutate(ruleToDelete.id);
        }}
        title="Delete this theft watch rule?"
        body={
          ruleToDelete
            ? `The ${SENSITIVITY_LABELS[ruleToDelete.sensitivity].toLowerCase()} rule will stop alerting.`
            : ''
        }
        confirmLabel="Delete rule"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={deleteMutation.isPending}
      />
    </>
  );
};

interface TheftWatchEditDialogProps {
  mode: { kind: 'add' } | { kind: 'edit'; rule: TheftWatchRule };
  siteOptions: Option[];
  telegramLinked: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (payload: TheftWatchRulePayload) => void;
}

const TheftWatchEditDialog: React.FC<TheftWatchEditDialogProps> = ({
  mode, siteOptions, telegramLinked, isPending, onClose, onConfirm,
}) => {
  const isEdit = mode.kind === 'edit';
  const initial = isEdit ? mode.rule : null;

  const [sensitivity, setSensitivity] = useState<TheftWatchSensitivity>(
    initial?.sensitivity ?? 'medium',
  );
  const [channels, setChannels] = useState<string[]>(initial?.channels ?? ['email']);

  // Hydrate stored site ids back into Options for the MultiSelect
  const byId = useMemo(
    () => new Map(siteOptions.map((opt) => [opt.value as number, opt])),
    [siteOptions],
  );
  const [selectedSites, setSelectedSites] = useState<Option[]>(
    (initial?.site_ids ?? [])
      .map((id) => byId.get(id))
      .filter((opt): opt is Option => !!opt),
  );

  // A telegram-only rule without a linked account could never deliver,
  // the evaluator would skip the channel and the alert would be lost
  const telegramOnlyUnlinked =
    channels.length === 1 && channels[0] === 'telegram' && !telegramLinked;
  const canConfirm = channels.length > 0 && !telegramOnlyUnlinked;

  const toggleChannel = (channel: string) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit theft watch rule' : 'Add a theft watch rule'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changing the sensitivity or the sites re-arms the rule, so it can alert again on the next check.'
              : 'Person alerts arrive right away, silence alerts within hours or days depending on each camera.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Sensitivity</label>
            <select
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value as TheftWatchSensitivity)}
              className="w-full px-3 py-2 border rounded-md text-sm bg-background"
            >
              <option value="low">Low (fewer alerts, only strong outliers)</option>
              <option value="medium">Medium (balanced)</option>
              <option value="high">High (more alerts, earlier warnings)</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Higher sensitivity reacts sooner but raises more false alarms.
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Sites</label>
            <MultiSelect
              options={siteOptions}
              value={selectedSites}
              onChange={setSelectedSites}
              placeholder="All sites"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to watch all sites of the project.
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notify via</label>
            <div className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={channels.includes('email')}
                  onChange={() => toggleChannel('email')}
                />
                Email
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={channels.includes('telegram')}
                  onChange={() => toggleChannel('telegram')}
                />
                Telegram
              </label>
            </div>
            {channels.includes('telegram') && !telegramLinked && (
              <p className={`text-xs mt-1 ${telegramOnlyUnlinked ? 'text-destructive' : 'text-muted-foreground'}`}>
                {telegramOnlyUnlinked
                  ? 'No Telegram account is linked, so this rule could never reach you. Link Telegram on the notifications page, or add email.'
                  : 'Telegram alerts need a linked Telegram account, see the notifications page.'}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                sensitivity,
                site_ids:
                  selectedSites.length > 0
                    ? selectedSites.map((opt) => Number(opt.value))
                    : null,
                channels,
              })
            }
            disabled={isPending || !canConfirm}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
