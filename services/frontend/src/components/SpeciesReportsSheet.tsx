/**
 * Scheduled species reports manager (slideout).
 *
 * Opens from the Notifications page. Lists the current user's own
 * species report rules for the project. Rules are private, the creator
 * is the only recipient, email only. The form is deliberately tiny, pick
 * species and a rhythm, everything else is fixed report content.
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
import { normalizeLabel } from '../utils/labels';
import {
  scheduledReportsApi,
  type ReportFrequency,
  type SpeciesReportRule,
  type SpeciesReportPayload,
} from '../api/scheduledReports';

interface SpeciesReportsSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  speciesOptions: Option[];
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; rule: SpeciesReportRule };

const FREQUENCY_SUMMARIES: Record<ReportFrequency, string> = {
  weekly: 'Weekly, sent every Monday',
  monthly: 'Monthly, sent on the 1st',
  quarterly: 'Quarterly, sent on the first day of each quarter',
};

const ruleTitle = (rule: SpeciesReportRule): string =>
  rule.species.map(normalizeLabel).join(', ');

export const SpeciesReportsSheet: React.FC<SpeciesReportsSheetProps> = ({
  open, onClose, projectId, speciesOptions,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: rules } = useQuery({
    queryKey: ['species-report-rules', projectId],
    queryFn: () => scheduledReportsApi.list(projectId),
    enabled: open && projectId > 0,
  });

  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [ruleToDelete, setRuleToDelete] = useState<SpeciesReportRule | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['species-report-rules', projectId] });

  const createMutation = useMutation({
    mutationFn: (payload: SpeciesReportPayload) => scheduledReportsApi.create(projectId, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Species report created');
    },
    onError: (error: any) => {
      toast.error(`Failed to create species report: ${error.response?.data?.detail || error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SpeciesReportPayload }) =>
      scheduledReportsApi.update(projectId, id, payload),
    onSuccess: () => {
      invalidate();
      setDialog({ kind: 'closed' });
      toast.success('Species report updated');
    },
    onError: (error: any) => {
      toast.error(`Failed to update species report: ${error.response?.data?.detail || error.message}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      scheduledReportsApi.update(projectId, id, { is_active: isActive }),
    onSuccess: () => invalidate(),
    onError: (error: any) => {
      toast.error(`Failed to update species report: ${error.response?.data?.detail || error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => scheduledReportsApi.remove(projectId, id),
    onSuccess: () => {
      invalidate();
      setRuleToDelete(null);
      toast.success('Species report deleted');
    },
    onError: (error: any) => {
      toast.error(`Failed to delete species report: ${error.response?.data?.detail || error.message}`);
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
            <SheetTitle>Species reports</SheetTitle>
            <SheetDescription>
              Get an email with the numbers for your selected species at the
              end of every week, month, or quarter. The report shows the
              total with the change since the previous period and a per-site
              table with counts, trap-days, and detections per 100
              trap-days. Only you receive your reports.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add report
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
                      aria-label={rule.is_active ? 'Pause report' : 'Resume report'}
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
                        {FREQUENCY_SUMMARIES[rule.frequency]}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: 'edit', rule })}
                      className="text-muted-foreground"
                      aria-label="Edit report"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRuleToDelete(rule)}
                      className="text-muted-foreground"
                      aria-label="Delete report"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No species reports yet.</p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {(dialog.kind === 'add' || dialog.kind === 'edit') && (
        <SpeciesReportEditDialog
          mode={dialog}
          speciesOptions={speciesOptions}
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
        title="Delete this species report?"
        body={
          ruleToDelete
            ? `The report for ${ruleTitle(ruleToDelete)} will stop arriving.`
            : ''
        }
        confirmLabel="Delete report"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={deleteMutation.isPending}
      />
    </>
  );
};

interface SpeciesReportEditDialogProps {
  mode: { kind: 'add' } | { kind: 'edit'; rule: SpeciesReportRule };
  speciesOptions: Option[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (payload: SpeciesReportPayload) => void;
}

const FREQUENCY_CHOICES: { value: ReportFrequency; label: string; hint: string }[] = [
  { value: 'weekly', label: 'Weekly', hint: 'Sent every Monday for the previous week' },
  { value: 'monthly', label: 'Monthly', hint: 'Sent on the 1st for the previous month' },
  { value: 'quarterly', label: 'Quarterly', hint: 'Sent on 1 January, April, July, and October for the previous quarter' },
];

const SpeciesReportEditDialog: React.FC<SpeciesReportEditDialogProps> = ({
  mode, speciesOptions, isPending, onClose, onConfirm,
}) => {
  const isEdit = mode.kind === 'edit';
  const initial = isEdit ? mode.rule : null;

  const speciesById = useMemo(
    () => new Map(speciesOptions.map((opt) => [opt.value as string, opt])),
    [speciesOptions],
  );

  const [selectedSpecies, setSelectedSpecies] = useState<Option[]>(
    (initial?.species ?? [])
      .map((s) => speciesById.get(s) ?? { label: normalizeLabel(s), value: s })
  );
  const [frequency, setFrequency] = useState<ReportFrequency>(initial?.frequency ?? 'monthly');

  const canConfirm = selectedSpecies.length > 0;
  const frequencyHint = FREQUENCY_CHOICES.find((c) => c.value === frequency)?.hint ?? '';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit species report' : 'Add a species report'}</DialogTitle>
          <DialogDescription>
            One email per period with the numbers for your selected species.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Labels</label>
            <MultiSelect
              options={speciesOptions}
              value={selectedSpecies}
              onChange={setSelectedSpecies}
              placeholder="Select labels"
            />
            <p className="text-xs text-muted-foreground mt-1">
              At least one label is required. Several labels share one email
              with a section per label.
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Rhythm</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
              className="w-full px-3 py-2 border rounded-md text-sm bg-background mt-1"
            >
              {FREQUENCY_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">{frequencyHint}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                species: selectedSpecies.map((opt) => String(opt.value)),
                frequency,
              })
            }
            disabled={isPending || !canConfirm}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
