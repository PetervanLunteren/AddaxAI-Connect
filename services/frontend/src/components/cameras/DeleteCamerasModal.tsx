/**
 * Delete Cameras Modal
 *
 * One dialog for taking cameras out of a project, two ways. Retire keeps
 * everything the camera recorded and only frees its Camera ID, so the same
 * device can be registered in another project; delete removes it all.
 * Retire comes first and is preselected, same reasoning as the Curation
 * delete: a wrong retire can still be followed by a delete, a wrong delete
 * cannot be undone. Both need the typed word. Shows counts after completion.
 * Mirrors DeleteProjectModal so the destructive flows feel identical.
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Trash2, CheckCircle, Archive } from 'lucide-react';
import { DeleteImpactList, impactTotals } from '../DeleteImpactList';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ConfirmWordField } from '../ui/ConfirmWordField';
import { camerasApi, type CameraBulkDeleteResponse } from '../../api/cameras';

interface DeleteCamerasModalProps {
  cameraIds: number[];
  open: boolean;
  onClose: () => void;
  // Called after a successful delete or retire so the parent can clear its selection.
  onDeleted?: () => void;
}

type Mode = 'retire' | 'delete';

// The word names the action, so nobody types DELETE to keep their data.
const CONFIRM_WORDS: Record<Mode, string> = { retire: 'RETIRE', delete: 'DELETE' };

export const DeleteCamerasModal: React.FC<DeleteCamerasModalProps> = ({
  cameraIds,
  open,
  onClose,
  onDeleted,
}) => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('retire');
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<CameraBulkDeleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const many = cameraIds.length !== 1;
  const noun = many ? 'cameras' : 'camera';

  // What the cameras hold. Fetched while the dialog is open so the user sees
  // real numbers before typing anything. Until it lands the button stays
  // disabled: if we cannot say what goes, we do not let it go.
  const {
    data: impact,
    isLoading: impactLoading,
    error: impactError,
  } = useQuery({
    queryKey: ['camera-delete-preview', cameraIds],
    queryFn: () => camerasApi.deletePreview(cameraIds),
    enabled: open && cameraIds.length > 0,
    staleTime: 0,
  });

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setMode('retire');
      setConfirmText('');
      setResult(null);
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => camerasApi.bulkDelete(cameraIds, mode === 'retire'),
    onSuccess: (response) => {
      setResult(response);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['camera-tags'] });
      queryClient.invalidateQueries({ queryKey: ['service-tasks'] });
      onDeleted?.();
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || err.message || `Failed to ${mode} cameras`);
    },
  });

  const handleClose = () => {
    if (!mutation.isPending) {
      setConfirmText('');
      setResult(null);
      setError(null);
      onClose();
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    // The word changes with the mode, so a half-typed word never carries over.
    setConfirmText('');
  };

  // Fail closed. Nobody confirms an action whose size we could not read.
  const canSubmit =
    confirmText === CONFIRM_WORDS[mode] && !impactLoading && !impactError && impact != null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) mutation.mutate();
  };

  if (result) {
    const retired = result.retired_cameras > 0;
    const kept = impactTotals(impact);
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent onClose={handleClose}>
          <DialogHeader>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <DialogTitle>{retired ? 'Cameras retired' : 'Cameras deleted successfully'}</DialogTitle>
            </div>
            <DialogDescription>
              {retired
                ? 'The cameras stay in the project as retired, with everything they recorded. Their Camera IDs are free to register again.'
                : 'The cameras and all associated data have been permanently removed.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            {retired ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-gray-50 rounded-md">
                  <p className="text-muted-foreground">Cameras retired</p>
                  <p className="text-2xl font-bold">{result.retired_cameras}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-md">
                  <p className="text-muted-foreground">Images kept</p>
                  <p className="text-2xl font-bold">{kept.images}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-md">
                  <p className="text-muted-foreground">Open service tasks removed</p>
                  <p className="text-2xl font-bold">{result.deleted_tasks}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-gray-50 rounded-md">
                    <p className="text-muted-foreground">Cameras</p>
                    <p className="text-2xl font-bold">{result.deleted_cameras}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-md">
                    <p className="text-muted-foreground">Images</p>
                    <p className="text-2xl font-bold">{result.deleted_images}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-md">
                    <p className="text-muted-foreground">Detections</p>
                    <p className="text-2xl font-bold">{result.deleted_detections}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-md">
                    <p className="text-muted-foreground">Classifications</p>
                    <p className="text-2xl font-bold">{result.deleted_classifications}</p>
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded-md text-sm">
                  <p className="text-muted-foreground">Stored files deleted</p>
                  <p className="text-lg font-bold">{result.deleted_minio_files}</p>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const options: { mode: Mode; title: string; detail: string }[] = [
    {
      mode: 'retire',
      title: `Retire the ${noun}, keep the data`,
      detail:
        `The ${noun} ${many ? 'stay' : 'stays'} in the project as retired. Photos, labels, placements, health and service history stay. The Camera ID is free to register again, in this project or another one.`,
    },
    {
      mode: 'delete',
      title: `Delete the ${noun} and all ${many ? 'their' : 'its'} data`,
      detail:
        `Everything the ${noun} recorded disappears, including the stored photo files. This cannot be undone.`,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <div className={`flex items-center gap-2 ${mode === 'delete' ? 'text-destructive' : ''}`}>
            {mode === 'delete' ? <AlertTriangle className="h-5 w-5" /> : <Archive className="h-5 w-5" />}
            <DialogTitle>{mode === 'delete' ? `Delete ${noun}` : `Retire ${noun}`}</DialogTitle>
          </div>
          <DialogDescription>
            Choose what happens to the selected {noun}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-2 text-sm" role="radiogroup" aria-label="What to do">
            {options.map((option) => {
              const selected = mode === option.mode;
              return (
                <label
                  key={option.mode}
                  className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                    selected ? 'border-[#0f6064] bg-[#0f6064]/5' : 'hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="camera-delete-mode"
                    className="mt-0.5 accent-primary"
                    checked={selected}
                    onChange={() => switchMode(option.mode)}
                    disabled={mutation.isPending}
                  />
                  <span>
                    <span className="font-medium">{option.title}</span>
                    <span className="block text-muted-foreground">{option.detail}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {/* What the cameras hold. Red only when it is about to go. */}
          <div
            className={`rounded-md p-4 my-4 ${
              mode === 'delete'
                ? 'border-2 border-destructive bg-destructive/5'
                : 'border bg-muted/40'
            }`}
          >
            <div className="flex items-start gap-3">
              {mode === 'delete' && (
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              )}
              <DeleteImpactList
                items={impact}
                isLoading={impactLoading}
                error={impactError ? (impactError as Error).message : null}
                mode={mode}
              />
            </div>
          </div>

          <ConfirmWordField
            word={CONFIRM_WORDS[mode]}
            value={confirmText}
            onChange={setConfirmText}
            disabled={mutation.isPending}
          />

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
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === 'delete' ? 'destructive' : 'default'}
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {mode === 'delete' ? 'Deleting...' : 'Retiring...'}
                </>
              ) : mode === 'delete' ? (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {noun}
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-2" />
                  Retire {noun}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
