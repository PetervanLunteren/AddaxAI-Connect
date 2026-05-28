/**
 * Deployment edit modal.
 *
 * One shared Dialog for editing a deployment's orientation label and free-text
 * notes. The site detail opens it editable; the camera deployment history
 * opens it read-only (single edit point on the site detail). The caller passes
 * the React-Query keys to invalidate after a successful save.
 *
 * Sheets do not stack in this codebase, so this is a centered Dialog over the
 * site sheet, not another sheet.
 */
import React, { useEffect, useState } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { sitesApi } from '../api/sites';
import { useToast } from './ui/Toaster';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  deploymentId: number;
  cameraName: string;
  siteName: string | null;
  initialName: string | null;
  initialNotes: string | null;
  editable: boolean;
  // React-Query keys to invalidate on a successful save. The caller decides
  // which views need to refetch (site detail, camera deployment history).
  invalidateKeys: QueryKey[];
}

const NAME_MAX = 100;
const NOTES_MAX = 10000;

export const DeploymentEditModal: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  deploymentId,
  cameraName,
  siteName,
  initialName,
  initialNotes,
  editable,
  invalidateKeys,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(initialName ?? '');
  const [notes, setNotes] = useState(initialNotes ?? '');

  useEffect(() => {
    if (open) {
      setName(initialName ?? '');
      setNotes(initialNotes ?? '');
    }
  }, [open, initialName, initialNotes]);

  const dirty =
    name !== (initialName ?? '') || notes !== (initialNotes ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      sitesApi.updateDeployment(projectId, deploymentId, { name, notes }),
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success('Deployment updated');
      onClose();
    },
    onError: (error: any) => {
      toast.error(
        `Update failed. ${error.response?.data?.detail || error.message || ''}`,
      );
    },
  });

  const handleClose = () => {
    if (!saveMutation.isPending) onClose();
  };

  const title = editable ? 'Edit deployment' : 'Deployment';
  const subhead = `${cameraName} at ${siteName ?? 'unassigned site'}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subhead}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs text-muted-foreground">Label</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              disabled={!editable || saveMutation.isPending}
              placeholder="e.g. NW, main view"
              className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={NOTES_MAX}
              rows={5}
              disabled={!editable || saveMutation.isPending}
              placeholder="e.g. Mounted at 1.5m, oak tree, lens cracked Feb 2026"
              className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-muted disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <DialogFooter>
          {editable ? (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!dirty || saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save changes
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
