/**
 * Bulk-edit dialogs, shared by the cameras and sites pages.
 *
 * Small dialogs that share the same Dialog shell. Each takes the selection
 * count and entity noun for its title, the action-specific value state, and
 * a confirm/close pair. Co-located in one file because they share the
 * visual language; splitting into files would just add imports. The SIM
 * expiry and habitat dialogs are single-entity today (cameras and sites
 * respectively) but keep the same props shape as the rest.
 */
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { TagInput } from './TagInput';

interface CommonProps {
  open: boolean;
  onClose: () => void;
  count: number;
  // Singular entity noun for dialog titles, e.g. "camera" or "site".
  noun: string;
  isPending: boolean;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

interface TagsDialogProps extends CommonProps {
  suggestions: string[];
  onConfirm: (tags: string[]) => void;
}

export const BulkAddTagsDialog: React.FC<TagsDialogProps> = ({
  open, onClose, count, noun, isPending, suggestions, onConfirm,
}) => {
  const [tags, setTags] = useState<string[]>([]);
  // Reset on open so a previously-typed list does not leak across uses.
  useEffect(() => { if (open) setTags([]); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Add tags to {plural(count, noun)}</DialogTitle>
          <DialogDescription>
            Tags are appended to each selected {noun}. Existing tags are kept and duplicates collapse.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={suggestions}
            placeholder="Add tag..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={() => onConfirm(tags)}
            disabled={isPending || tags.length === 0}
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Add tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const BulkRemoveTagsDialog: React.FC<TagsDialogProps> = ({
  open, onClose, count, noun, isPending, suggestions, onConfirm,
}) => {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { if (open) setTags([]); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Remove tags from {plural(count, noun)}</DialogTitle>
          <DialogDescription>
            Each tag listed here is taken off every selected {noun}. Tags that are not present on a {noun} are skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={suggestions}
            placeholder="Tag to remove..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(tags)}
            disabled={isPending || tags.length === 0}
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Remove tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface SimExpiryDialogProps extends CommonProps {
  onConfirm: (date: string | null) => void;
}

export const BulkSetSimExpiryDialog: React.FC<SimExpiryDialogProps> = ({
  open, onClose, count, noun, isPending, onConfirm,
}) => {
  const [date, setDate] = useState('');
  const [clear, setClear] = useState(false);
  useEffect(() => { if (open) { setDate(''); setClear(false); } }, [open]);

  const canConfirm = clear || date !== '';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Set SIM expiry on {plural(count, noun)}</DialogTitle>
          <DialogDescription>
            This overwrites any existing SIM expiry date on every selected {noun}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setClear(false); }}
            disabled={clear}
            className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={clear}
              onChange={(e) => setClear(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-primary"
            />
            <span>Clear the SIM expiry date instead</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={() => onConfirm(clear ? null : date)}
            disabled={isPending || !canConfirm}
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {clear ? 'Clear date' : 'Set date'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface NotesDialogProps extends CommonProps {
  placeholder?: string;
  onConfirm: (notes: string) => void;
}

export const BulkSetNotesDialog: React.FC<NotesDialogProps> = ({
  open, onClose, count, noun, isPending, placeholder, onConfirm,
}) => {
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) setNotes(''); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Set notes on {plural(count, noun)}</DialogTitle>
          <DialogDescription>
            This replaces the notes field on every selected {noun} with the text below. Leave it empty to clear notes.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder={placeholder}
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={() => onConfirm(notes)}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {notes.length === 0 ? 'Clear notes' : 'Replace notes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface HabitatDialogProps extends CommonProps {
  onConfirm: (habitat: string) => void;
}

export const BulkSetHabitatDialog: React.FC<HabitatDialogProps> = ({
  open, onClose, count, noun, isPending, onConfirm,
}) => {
  const [habitat, setHabitat] = useState('');
  useEffect(() => { if (open) setHabitat(''); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Set habitat on {plural(count, noun)}</DialogTitle>
          <DialogDescription>
            This replaces the habitat type on every selected {noun}. Leave it empty to clear it.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <input
            type="text"
            value={habitat}
            onChange={(e) => setHabitat(e.target.value)}
            maxLength={100}
            placeholder="e.g. Deciduous forest"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={() => onConfirm(habitat)}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {habitat.trim() === '' ? 'Clear habitat' : 'Set habitat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
