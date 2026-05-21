/**
 * Delete Cameras Modal
 *
 * Danger zone UI for bulk camera deletion with cascade warning.
 * Requires typing DELETE to confirm. Shows deletion counts after completion.
 * Mirrors DeleteProjectModal so the two destructive flows feel identical.
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Trash2, CheckCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { camerasApi, type CameraBulkDeleteResponse } from '../../api/cameras';

interface DeleteCamerasModalProps {
  cameraIds: number[];
  open: boolean;
  onClose: () => void;
  // Called after a successful delete so the parent can clear its selection.
  onDeleted?: () => void;
}

const CONFIRM_WORD = 'DELETE';

export const DeleteCamerasModal: React.FC<DeleteCamerasModalProps> = ({
  cameraIds,
  open,
  onClose,
  onDeleted,
}) => {
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState('');
  const [deleteResult, setDeleteResult] = useState<CameraBulkDeleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = cameraIds.length;

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setConfirmText('');
      setDeleteResult(null);
      setError(null);
    }
  }, [open]);

  const deleteMutation = useMutation({
    mutationFn: () => camerasApi.bulkDelete(cameraIds),
    onSuccess: (result) => {
      setDeleteResult(result);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['camera-tags'] });
      onDeleted?.();
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to delete cameras');
    },
  });

  const handleClose = () => {
    if (!deleteMutation.isPending) {
      setConfirmText('');
      setDeleteResult(null);
      setError(null);
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText !== CONFIRM_WORD) {
      setError(`Type ${CONFIRM_WORD} to confirm`);
      return;
    }
    deleteMutation.mutate();
  };

  const isConfirmValid = confirmText === CONFIRM_WORD;

  // Show success results
  if (deleteResult) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent onClose={handleClose}>
          <DialogHeader>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <DialogTitle>Cameras deleted successfully</DialogTitle>
            </div>
            <DialogDescription>
              The cameras and all associated data have been permanently removed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-muted-foreground">Cameras</p>
                <p className="text-2xl font-bold">{deleteResult.deleted_cameras}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-muted-foreground">Images</p>
                <p className="text-2xl font-bold">{deleteResult.deleted_images}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-muted-foreground">Detections</p>
                <p className="text-2xl font-bold">{deleteResult.deleted_detections}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-muted-foreground">Classifications</p>
                <p className="text-2xl font-bold">{deleteResult.deleted_classifications}</p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-md text-sm">
              <p className="text-muted-foreground">Stored files deleted</p>
              <p className="text-lg font-bold">{deleteResult.deleted_minio_files}</p>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle>Delete cameras</DialogTitle>
          </div>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the selected cameras and all associated data.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          {/* Danger Zone Warning */}
          <div className="border-2 border-destructive rounded-md p-4 my-4 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-destructive">
                  Warning: This will delete {count} camera{count === 1 ? '' : 's'} and:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>All their camera trap images</li>
                  <li>All animal detections</li>
                  <li>All species classifications</li>
                  <li>All deployment and health records</li>
                  <li>All associated stored files</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Confirmation Input */}
          <div className="space-y-2">
            <label htmlFor="confirm" className="text-sm font-medium block">
              Type <span className="font-mono font-bold">{CONFIRM_WORD}</span> to confirm:
            </label>
            <input
              id="confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Enter ${CONFIRM_WORD}`}
              className="w-full px-3 py-2 border rounded-md"
              autoComplete="off"
              disabled={deleteMutation.isPending}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md">
              {error}
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isConfirmValid || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete cameras
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
