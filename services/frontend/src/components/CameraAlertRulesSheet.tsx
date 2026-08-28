/**
 * Camera condition alert rules manager (slideout).
 *
 * Opens from the Notifications page. Lists the current user's own alert
 * rules for the project. Rules are private, the creator is the only
 * recipient. Supports add, edit, pause, and delete. Evaluated daily,
 * alerts fire once per incident and re-arm when a camera recovers.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit2, Loader2, Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from './ui/Sheet';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { MultiSelect, type Option } from './ui/MultiSelect';
import { channelLabel } from '../utils/channels';
import { useToast } from './ui/Toaster';
import { camerasApi } from '../api/cameras';
import {
  cameraAlertRulesApi,
  type AlertRule,
  type AlertRulePayload,
  type AlertRuleType,
} from '../api/cameraAlertRules';

interface CameraAlertRulesSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  telegramLinked: boolean;
  // Set to list and edit the project's EarthRanger rules instead of your
  // own; the dialog then locks the channel and hides the picker.
  channel?: 'earthranger';
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; rule: AlertRule };

const RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  battery_low: 'Battery below',
  sd_full: 'SD card above',
  camera_silent: 'Silent for more than',
  rejections: 'Rejected files per day, at least',
};

// Threshold unit and bounds per rule family. Must match validate_rule_fields
// in services/api/routers/camera_alert_rules.py.
const THRESHOLD_UNIT: Record<AlertRuleType, { min: number; max: number; default: number; label: (n: number) => string }> = {
  battery_low: { min: 1, max: 99, default: 20, label: () => '%' },
  sd_full: { min: 1, max: 99, default: 90, label: () => '%' },
  camera_silent: { min: 1, max: 365, default: 7, label: (n) => (n === 1 ? 'day' : 'days') },
  rejections: { min: 1, max: 999, default: 1, label: (n) => (n === 1 ? 'file' : 'files') },
};

const ruleSentence = (rule: AlertRule): string => {
  const unit = THRESHOLD_UNIT[rule.rule_type].label(rule.threshold);
  const spaced = unit === '%' ? `${rule.threshold}%` : `${rule.threshold} ${unit}`;
  return `${RULE_TYPE_LABELS[rule.rule_type]} ${spaced}`;
};

export const CameraAlertRulesSheet: React.FC<CameraAlertRulesSheetProps> = ({
  open, onClose, projectId, telegramLinked, channel,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: rules } = useQuery({
    queryKey: ['camera-alert-rules', projectId, channel ?? 'own'],
    queryFn: () => cameraAlertRulesApi.list(projectId, channel),
    enabled: open && projectId > 0,
  });

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: open && projectId > 0,
  });

  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [ruleToDelete, setRuleToDelete] = useState<AlertRule | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['camera-alert-rules', projectId] });

  const createMutation = useMutation({
    mutationFn: (payload: AlertRulePayload) => cameraAlertRulesApi.create(projectId, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Alert rule created');
    },
    onError: (error: any) => {
      toast.error(`Failed to create alert rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AlertRulePayload & { scope_all: boolean } }) =>
      cameraAlertRulesApi.update(projectId, id, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Alert rule updated');
    },
    onError: (error: any) => {
      toast.error(`Failed to update alert rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      cameraAlertRulesApi.update(projectId, id, { is_active: isActive }),
    onSuccess: () => invalidate(),
    onError: (error: any) => {
      toast.error(`Failed to update alert rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => cameraAlertRulesApi.remove(projectId, id),
    onSuccess: () => {
      invalidate();
      setRuleToDelete(null);
      toast.success('Alert rule deleted');
    },
    onError: (error: any) => {
      toast.error(`Failed to delete alert rule: ${error.response?.data?.detail || error.message}`);
      setRuleToDelete(null);
    },
  });

  const scopeLabel = (rule: AlertRule): string => {
    if (!rule.camera_ids) return 'All cameras';
    return `${rule.camera_ids.length} camera${rule.camera_ids.length !== 1 ? 's' : ''}`;
  };

  const channelsLabel = (rule: AlertRule): string =>
    rule.channels
      .map(channelLabel)
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
              {channel ? 'Camera condition events for EarthRanger' : 'Camera condition alerts'}
            </SheetTitle>
            <SheetDescription>
              {channel
                ? 'Each camera that needs attention posts one event at its site on the ranger map, once per incident. Rules are checked once a day and re-arm when the camera recovers. These rules belong to the project and any admin can change them.'
                : 'Get a message when a camera needs attention. Rules are checked once a day, alert once per incident, and re-arm when the camera recovers. Only you receive your alerts. Battery and SD rules need cameras that send daily health reports; the silent rule counts any sign of life reaching the server, reports or live images.'}
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
                      <p className="text-sm font-medium">{ruleSentence(rule)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {scopeLabel(rule)} · {channelsLabel(rule)}
                        {rule.notified_camera_ids.length > 0 && (
                          <span> · {rule.notified_camera_ids.length} firing</span>
                        )}
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
              <p className="text-sm text-muted-foreground">No alert rules yet.</p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {(dialog.kind === 'add' || dialog.kind === 'edit') && (
        <AlertRuleEditDialog
          mode={dialog}
          fixedChannels={channel ? [channel] : undefined}
          cameraOptions={(cameras ?? []).map((c) => ({ label: c.name, value: c.id }))}
          telegramLinked={telegramLinked}
          isPending={dialog.kind === 'add' ? createMutation.isPending : updateMutation.isPending}
          onClose={() => setDialog({ kind: 'closed' })}
          onConfirm={(payload) => {
            if (dialog.kind === 'add') {
              createMutation.mutate(payload);
            } else {
              updateMutation.mutate({
                id: dialog.rule.id,
                payload: { ...payload, scope_all: payload.camera_ids === null },
              });
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
        title="Delete this alert rule?"
        body={
          ruleToDelete
            ? `The rule "${ruleSentence(ruleToDelete)}" will stop alerting.`
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

interface AlertRuleEditDialogProps {
  mode: { kind: 'add' } | { kind: 'edit'; rule: AlertRule };
  cameraOptions: Option[];
  telegramLinked: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (payload: AlertRulePayload) => void;
  fixedChannels?: string[];
}

const AlertRuleEditDialog: React.FC<AlertRuleEditDialogProps> = ({
  mode, cameraOptions, telegramLinked, isPending, onClose, onConfirm, fixedChannels,
}) => {
  const isEdit = mode.kind === 'edit';
  const initial = isEdit ? mode.rule : null;

  const [ruleType, setRuleType] = useState<AlertRuleType>(initial?.rule_type ?? 'battery_low');
  const [threshold, setThreshold] = useState<string>(String(initial?.threshold ?? THRESHOLD_UNIT.battery_low.default));
  const [channels, setChannels] = useState<string[]>(initial?.channels ?? fixedChannels ?? ['email']);

  // Hydrate stored camera ids back into Options for the MultiSelect
  const byId = useMemo(
    () => new Map(cameraOptions.map((opt) => [opt.value as number, opt])),
    [cameraOptions],
  );
  const [selectedCameras, setSelectedCameras] = useState<Option[]>(
    (initial?.camera_ids ?? [])
      .map((id) => byId.get(id))
      .filter((opt): opt is Option => !!opt),
  );

  const unit = THRESHOLD_UNIT[ruleType];
  const thresholdNumber = Number(threshold);
  // Whole numbers only, the API stores an integer and would reject 20.5
  const thresholdValid =
    Number.isInteger(thresholdNumber) &&
    thresholdNumber >= unit.min && thresholdNumber <= unit.max;
  // A telegram-only rule without a linked account could never deliver,
  // the evaluator would skip the channel and the alert would be lost
  const telegramOnlyUnlinked =
    !fixedChannels && channels.length === 1 && channels[0] === 'telegram' && !telegramLinked;
  const canConfirm = thresholdValid && channels.length > 0 && !telegramOnlyUnlinked;

  const toggleChannel = (channel: string) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit alert rule' : 'Add an alert rule'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changing what the rule measures re-arms it, so it can alert again on the next check.'
              : 'The rule is checked once a day and alerts you once per incident.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Condition</label>
            <div className="flex gap-2 items-center">
              <select
                value={ruleType}
                onChange={(e) => {
                  const next = e.target.value as AlertRuleType;
                  setRuleType(next);
                  // Sensible default when switching rule types
                  setThreshold(String(THRESHOLD_UNIT[next].default));
                }}
                className="flex-1 px-3 py-2 border rounded-md text-sm bg-background"
              >
                <option value="battery_low">Battery below</option>
                <option value="sd_full">SD card above</option>
                <option value="camera_silent">Silent for more than</option>
                <option value="rejections">Rejected files per day, at least</option>
              </select>
              <input
                type="number"
                value={threshold}
                min={unit.min}
                max={unit.max}
                step={1}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-20 px-3 py-2 border rounded-md text-sm"
              />
              <span className="text-sm text-muted-foreground w-10">
                {unit.label(thresholdNumber)}
              </span>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Cameras</label>
            <MultiSelect
              options={cameraOptions}
              value={selectedCameras}
              onChange={setSelectedCameras}
              placeholder="All cameras"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to watch all cameras of the project.
            </p>
          </div>
          {!fixedChannels && (
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
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                rule_type: ruleType,
                threshold: thresholdNumber,
                camera_ids:
                  selectedCameras.length > 0
                    ? selectedCameras.map((opt) => Number(opt.value))
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
