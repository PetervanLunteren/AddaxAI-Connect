/**
 * Asked before a project loses a label that rules or thresholds use: a new
 * SpeciesNet label list without it, or a narrower species list of a
 * fixed-class project. The server answers such a save with the impact and
 * writes nothing until it is sent again with the confirm flag.
 *
 * The label is then removed from the rules that use it, a rule with no label
 * left is deleted, and a threshold on it is deleted. Counts only: rules are
 * private, so the admin never sees whose they are.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ImpactBox } from '../ui/ImpactBox';
import { normalizeLabel } from '../../utils/labels';
import type { LabelChangeImpact } from '../../api/types';

interface LabelChangeDialogProps {
  /** The impact the server reported, or null when there is nothing to ask */
  impact: LabelChangeImpact | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending?: boolean;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "wolf", "wolf and fox", "wolf, fox and badger" */
const listed = (labels: string[]): string => {
  const names = labels.map(normalizeLabel);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
};

export const LabelChangeDialog: React.FC<LabelChangeDialogProps> = ({
  impact, onClose, onConfirm, isPending = false,
}) => {
  if (!impact) return null;

  const rules = impact.rules_updated + impact.rules_deleted;
  const bullets: string[] = [];
  if (rules > 0) {
    bullets.push(`${listed(impact.labels)} from ${count(rules, 'detection rule or species report', 'detection rules and species reports')}`);
  }
  if (impact.rules_deleted > 0) {
    bullets.push(`${count(impact.rules_deleted, 'of those has no other label and is deleted', 'of those have no other label and are deleted')}`);
  }
  if (impact.thresholds_removed > 0) {
    bullets.push(count(impact.thresholds_removed, 'confidence threshold', 'confidence thresholds'));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent onClose={isPending ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>
            {impact.labels.length === 1 ? 'A label that is in use disappears' : 'Labels that are in use disappear'}
          </DialogTitle>
          <DialogDescription>
            Nothing is saved yet. Everything that does not use {impact.labels.length === 1 ? 'this label' : 'these labels'} stays as it is.
          </DialogDescription>
        </DialogHeader>
        <ImpactBox sections={[{ heading: 'This will remove', bullets }]}>
          {impact.users_emailed > 0 && (
            <p className="text-muted-foreground">
              {count(impact.users_emailed, 'user gets', 'users get')} an email that says what changed in their rules.
            </p>
          )}
        </ImpactBox>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save and remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
