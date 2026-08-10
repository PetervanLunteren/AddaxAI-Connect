/**
 * Real-time detection alert rules manager (slideout).
 *
 * Opens from the Notifications page. Lists the current user's own
 * detection rules for the project. Rules are private, the creator is the
 * only recipient. Supports add, edit, pause, and delete. The happy path
 * is two clicks, pick labels and save; every condition is optional and
 * sits collapsed behind sensible defaults.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Edit2, Loader2, Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from './ui/Sheet';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { MultiSelect, type Option } from './ui/MultiSelect';
import { useToast } from './ui/Toaster';
import { normalizeLabel } from '../utils/labels';
import {
  detectionAlertRulesApi,
  type DetectionRule,
  type DetectionRulePayload,
} from '../api/detectionAlertRules';

interface DetectionAlertRulesSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  telegramLinked: boolean;
  speciesOptions: Option[];
  siteOptions: Option[];
  defaultCooldownMinutes: number;
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; rule: DetectionRule };

const formatHour = (hour: number): string => `${String(hour).padStart(2, '0')}h`;

const ruleTitle = (rule: DetectionRule): string =>
  rule.species.map(normalizeLabel).join(', ');

const ruleSummary = (rule: DetectionRule): string => {
  const parts: string[] = [];
  if (rule.site_ids === null) {
    parts.push('All sites');
  } else {
    parts.push(`${rule.site_ids.length} site${rule.site_ids.length !== 1 ? 's' : ''}`);
  }
  parts.push(
    rule.channels.map((c) => (c === 'email' ? 'Email' : 'Telegram')).join(' + '),
  );
  if (rule.hour_from !== null && rule.hour_to !== null) {
    parts.push(`${formatHour(rule.hour_from)} to ${formatHour(rule.hour_to)}`);
  }
  if (rule.min_group_size !== null) {
    parts.push(`${rule.min_group_size} or more`);
  }
  if (rule.cooldown_minutes !== null) {
    parts.push(`${rule.cooldown_minutes} min cooldown`);
  }
  if (rule.rarity_days !== null) {
    parts.push(`absent ${rule.rarity_days}+ days`);
  }
  return parts.join(' · ');
};

export const DetectionAlertRulesSheet: React.FC<DetectionAlertRulesSheetProps> = ({
  open, onClose, projectId, telegramLinked, speciesOptions, siteOptions, defaultCooldownMinutes,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: rules } = useQuery({
    queryKey: ['detection-alert-rules', projectId],
    queryFn: () => detectionAlertRulesApi.list(projectId),
    enabled: open && projectId > 0,
  });

  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [ruleToDelete, setRuleToDelete] = useState<DetectionRule | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['detection-alert-rules', projectId] });

  const createMutation = useMutation({
    mutationFn: (payload: DetectionRulePayload) => detectionAlertRulesApi.create(projectId, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Detection rule created');
    },
    onError: (error: any) => {
      toast.error(`Failed to create detection rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DetectionRulePayload }) =>
      detectionAlertRulesApi.update(projectId, id, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Detection rule updated');
    },
    onError: (error: any) => {
      toast.error(`Failed to update detection rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      detectionAlertRulesApi.update(projectId, id, { is_active: isActive }),
    onSuccess: () => invalidate(),
    onError: (error: any) => {
      toast.error(`Failed to update detection rule: ${error.response?.data?.detail || error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => detectionAlertRulesApi.remove(projectId, id),
    onSuccess: () => {
      invalidate();
      setRuleToDelete(null);
      toast.success('Detection rule deleted');
    },
    onError: (error: any) => {
      toast.error(`Failed to delete detection rule: ${error.response?.data?.detail || error.message}`);
      setRuleToDelete(null);
    },
  });

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
            <SheetTitle>Real-time detection alerts</SheetTitle>
            <SheetDescription>
              Get an instant email or Telegram message with a photo when one
              of your selected labels is detected. Each rule can be narrowed
              by site, time of day, or group size, quieted with a cooldown,
              or limited to species that return after a long absence. Only
              you receive your alerts.
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
                      <p className="text-sm font-medium">{ruleTitle(rule)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ruleSummary(rule)}
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
              <p className="text-sm text-muted-foreground">No detection rules yet.</p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {(dialog.kind === 'add' || dialog.kind === 'edit') && (
        <DetectionRuleEditDialog
          mode={dialog}
          speciesOptions={speciesOptions}
          siteOptions={siteOptions}
          telegramLinked={telegramLinked}
          defaultCooldownMinutes={defaultCooldownMinutes}
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
        title="Delete this detection rule?"
        body={
          ruleToDelete
            ? `The rule for ${ruleTitle(ruleToDelete)} will stop alerting.`
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

interface DetectionRuleEditDialogProps {
  mode: { kind: 'add' } | { kind: 'edit'; rule: DetectionRule };
  speciesOptions: Option[];
  siteOptions: Option[];
  telegramLinked: boolean;
  defaultCooldownMinutes: number;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (payload: DetectionRulePayload) => void;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const DetectionRuleEditDialog: React.FC<DetectionRuleEditDialogProps> = ({
  mode, speciesOptions, siteOptions, telegramLinked, defaultCooldownMinutes,
  isPending, onClose, onConfirm,
}) => {
  const isEdit = mode.kind === 'edit';
  const initial = isEdit ? mode.rule : null;

  const speciesById = useMemo(
    () => new Map(speciesOptions.map((opt) => [opt.value as string, opt])),
    [speciesOptions],
  );
  const sitesById = useMemo(
    () => new Map(siteOptions.map((opt) => [opt.value as number, opt])),
    [siteOptions],
  );

  const [selectedSpecies, setSelectedSpecies] = useState<Option[]>(
    (initial?.species ?? [])
      .map((s) => speciesById.get(s) ?? { label: normalizeLabel(s), value: s })
  );
  // Empty selection means all sites, matching the camera rules dialog
  const [selectedSites, setSelectedSites] = useState<Option[]>(
    (initial?.site_ids ?? [])
      .map((id) => sitesById.get(id))
      .filter((opt): opt is Option => !!opt),
  );
  const [channels, setChannels] = useState<string[]>(
    initial?.channels ?? (telegramLinked ? ['telegram'] : ['email']),
  );

  // Conditions, '' means off for the numeric ones. New rules get the
  // cooldown on by default so a burst collapses into one message.
  const [hourFrom, setHourFrom] = useState<string>(initial?.hour_from?.toString() ?? '');
  const [hourTo, setHourTo] = useState<string>(initial?.hour_to?.toString() ?? '');
  const [minGroupSize, setMinGroupSize] = useState<string>(initial?.min_group_size?.toString() ?? '');
  const [cooldownMinutes, setCooldownMinutes] = useState<string>(
    isEdit ? (initial?.cooldown_minutes?.toString() ?? '') : String(defaultCooldownMinutes),
  );
  const [rarityDays, setRarityDays] = useState<string>(initial?.rarity_days?.toString() ?? '');

  const activeConditionCount =
    (hourFrom !== '' && hourTo !== '' ? 1 : 0) +
    (minGroupSize !== '' ? 1 : 0) +
    (cooldownMinutes !== '' ? 1 : 0) +
    (rarityDays !== '' ? 1 : 0);
  const [showConditions, setShowConditions] = useState<boolean>(
    isEdit && activeConditionCount > 0,
  );

  const toggleChannel = (channel: string) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  const groupSizeNumber = minGroupSize === '' ? null : Number(minGroupSize);
  const cooldownNumber = cooldownMinutes === '' ? null : Number(cooldownMinutes);
  const rarityNumber = rarityDays === '' ? null : Number(rarityDays);

  const hoursConsistent = (hourFrom === '') === (hourTo === '')
    && (hourFrom === '' || hourFrom !== hourTo);
  const groupSizeValid = groupSizeNumber === null
    || (Number.isInteger(groupSizeNumber) && groupSizeNumber >= 2 && groupSizeNumber <= 100);
  const cooldownValid = cooldownNumber === null
    || (Number.isInteger(cooldownNumber) && cooldownNumber >= 1 && cooldownNumber <= 10080);
  const rarityValid = rarityNumber === null
    || (Number.isInteger(rarityNumber) && rarityNumber >= 1 && rarityNumber <= 3650);
  // A telegram-only rule without a linked account could never deliver,
  // the evaluator would skip the channel and the alert would be lost
  const telegramOnlyUnlinked =
    channels.length === 1 && channels[0] === 'telegram' && !telegramLinked;
  const canConfirm =
    selectedSpecies.length > 0 &&
    channels.length > 0 &&
    !telegramOnlyUnlinked &&
    hoursConsistent && groupSizeValid && cooldownValid && rarityValid;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit detection rule' : 'Add a detection rule'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changing what the rule matches also restarts its cooldown.'
              : 'You get a message each time a selected label is detected.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Labels</label>
            {/* No selectedNoun: with it the trigger would always show a
                count and the placeholder would never appear. An empty
                sites selection means all sites, so the trigger must say
                "All sites", not "0 sites selected". */}
            <MultiSelect
              options={speciesOptions}
              value={selectedSpecies}
              onChange={setSelectedSpecies}
              placeholder="Select labels"
            />
            <p className="text-xs text-muted-foreground mt-1">
              At least one label is required.
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

          <button
            type="button"
            onClick={() => setShowConditions((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {showConditions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Conditions
            {activeConditionCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] px-1 h-4 text-xs font-medium rounded-full bg-primary/10 text-primary">
                {activeConditionCount}
              </span>
            )}
          </button>

          {showConditions && (
            <div className="space-y-3 pl-5 border-l">
              <div>
                <label className="text-xs text-muted-foreground">Time of day</label>
                <div className="flex gap-2 items-center mt-1">
                  <select
                    value={hourFrom}
                    onChange={(e) => setHourFrom(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-md text-sm bg-background"
                  >
                    <option value="">Any time</option>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{formatHour(h)}</option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">to</span>
                  <select
                    value={hourTo}
                    onChange={(e) => setHourTo(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-md text-sm bg-background"
                  >
                    <option value="">Any time</option>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{formatHour(h)}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Camera clock time. The window wraps past midnight, so 21h to
                  05h covers the night.
                </p>
                {!hoursConsistent && (
                  <p className="text-xs text-destructive mt-1">
                    {hourFrom !== '' && hourFrom === hourTo
                      ? 'Pick two different hours, or set both to any time.'
                      : 'Set both hours, or both to any time.'}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Minimum group size</label>
                <input
                  type="number"
                  value={minGroupSize}
                  min={2}
                  max={100}
                  step={1}
                  placeholder="Off"
                  onChange={(e) => setMinGroupSize(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Alert only when the image shows at least this many
                  individuals of the label.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Cooldown in minutes</label>
                <input
                  type="number"
                  value={cooldownMinutes}
                  min={1}
                  max={10080}
                  step={1}
                  placeholder="Off"
                  onChange={(e) => setCooldownMinutes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  No repeat alert for the same label at the same site within
                  this many minutes. Turns a feeding sequence into one
                  message.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Absent for days</label>
                <input
                  type="number"
                  value={rarityDays}
                  min={1}
                  max={3650}
                  step={1}
                  placeholder="Off"
                  onChange={(e) => setRarityDays(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Alert only when the label was not detected anywhere in the
                  project for at least this many days. Useful for rare
                  visitors that return after a long absence.
                </p>
              </div>
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
                species: selectedSpecies.map((opt) => String(opt.value)),
                site_ids:
                  selectedSites.length > 0
                    ? selectedSites.map((opt) => Number(opt.value))
                    : null,
                channels,
                hour_from: hourFrom === '' ? null : Number(hourFrom),
                hour_to: hourTo === '' ? null : Number(hourTo),
                min_group_size: groupSizeNumber,
                cooldown_minutes: cooldownNumber,
                rarity_days: rarityNumber,
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
