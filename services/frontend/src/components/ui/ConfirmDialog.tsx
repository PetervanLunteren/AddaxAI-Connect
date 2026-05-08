/**
 * Tiny confirmation dialog used to replace blocking window.confirm() calls.
 *
 * Caller controls open/close + onConfirm. The component renders a
 * <Dialog> with a title, body, Cancel button, and a primary action.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  isPending?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isPending = false,
}) => {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent onClose={isPending ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && <DialogDescription>{body}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
