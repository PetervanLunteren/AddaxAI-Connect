/**
 * Bulk-edit dialogs for the cameras page.
 *
 * Four small dialogs that share the same Dialog shell. Each takes the
 * selection count for its title, the action-specific value state, and a
 * confirm/close pair. Co-located in one file because they share the
 * visual language; splitting into four files would just add imports.
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
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { TagInput } from '../TagInput';

interface CommonProps {
  open: boolean;
  onClose: () => void;
  cameraCount: number;
  isPending: boolean;
}

interface TagsDialogProps extends CommonProps {
  suggestions: string[];
  onConfirm: (tags: string[]) => void;
}

export const BulkAddTagsDialog: React.FC<TagsDialogProps> = ({
  open, onClose, cameraCount, isPending, suggestions, onConfirm,
}) => {
  const [tags, setTags] = useState<string[]>([]);
  // Reset on open so a previously-typed list does not leak across uses.
  useEffect(() => { if (open) setTags([]); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Add tags to {cameraCount} camera{cameraCount === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            Tags are appended to each selected camera. Existing tags are kept and duplicates collapse.
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
  open, onClose, cameraCount, isPending, suggestions, onConfirm,
}) => {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { if (open) setTags([]); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Remove tags from {cameraCount} camera{cameraCount === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            Each tag listed here is taken off every selected camera. Tags that are not present on a camera are skipped.
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
  open, onClose, cameraCount, isPending, onConfirm,
}) => {
  const [date, setDate] = useState('');
  const [clear, setClear] = useState(false);
  useEffect(() => { if (open) { setDate(''); setClear(false); } }, [open]);

  const canConfirm = clear || date !== '';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Set SIM expiry on {cameraCount} camera{cameraCount === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            This overwrites any existing SIM expiry date on every selected camera.
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
  onConfirm: (notes: string) => void;
}

export const BulkSetNotesDialog: React.FC<NotesDialogProps> = ({
  open, onClose, cameraCount, isPending, onConfirm,
}) => {
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) setNotes(''); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Set notes on {cameraCount} camera{cameraCount === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            This replaces the notes field on every selected camera with the text below. Leave it empty to clear notes.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="e.g. Mounted on oak tree, facing north"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
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
