/**
 * Asked before a project loses a label that detection rules or species
 * reports use: a new SpeciesNet label list without it, or a narrower species
 * list of a fixed-class project. The server answers such a save with the
 * impact and writes nothing until it is sent again with the confirm flag.
 *
 * The label is then removed from the rules that use it, and a rule with no
 * label left is deleted. Counts only: rules are private, so the admin never
 * sees whose they are.
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
  const bullets = [`${listed(impact.labels)} from ${count(rules, 'rule', 'rules')}`];
  if (impact.rules_deleted > 0) {
    bullets.push(count(impact.rules_deleted, 'rule has no other label and is deleted', 'rules have no other label and are deleted'));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent onClose={isPending ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>Your new list breaks some detection rules</DialogTitle>
          <DialogDescription>
            Users in this project have detection rules and species reports on labels that are not in your new list.
          </DialogDescription>
        </DialogHeader>
        <ImpactBox sections={[{ heading: 'This will remove', bullets }]}>
          {impact.users_emailed > 0 && (
            <p className="text-muted-foreground">
              {count(impact.users_emailed, 'user gets', 'users get')} an email that says what changed.
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
