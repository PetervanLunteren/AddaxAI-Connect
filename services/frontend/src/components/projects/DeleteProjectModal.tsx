/**
 * Delete Project Modal
 *
 * Danger zone UI for project deletion with cascade warning.
 * Requires exact project name match to confirm deletion.
 * Shows deletion counts after completion.
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
import { projectsApi } from '../../api/projects';
import type { Project, ProjectDeleteResponse } from '../../api/types';

interface DeleteProjectModalProps {
  project: Project;
  open: boolean;
  onClose: () => void;
}

export const DeleteProjectModal: React.FC<DeleteProjectModalProps> = ({ project, open, onClose }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  const [deleteResult, setDeleteResult] = useState<ProjectDeleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setConfirmName('');
      setDeleteResult(null);
      setError(null);
    }
  }, [open]);

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.delete(project.id, confirmName),
    onSuccess: (result) => {
      setDeleteResult(result);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      // Navigate to projects page after short delay to show results
      setTimeout(() => {
        handleClose();
        navigate('/projects');
      }, 3000);
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to delete project');
    },
  });

  const handleClose = () => {
    if (!deleteMutation.isPending) {
      setConfirmName('');
      setDeleteResult(null);
      setError(null);
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmName !== project.name) {
      setError('Project name does not match');
      return;
    }
    deleteMutation.mutate();
  };

  const isConfirmValid = confirmName === project.name;

  // Show success results
  if (deleteResult) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent onClose={handleClose}>
          <DialogHeader>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <DialogTitle>Project Deleted Successfully</DialogTitle>
            </div>
            <DialogDescription>
              The project and all associated data have been permanently removed.
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
              <p className="text-muted-foreground">MinIO Files Deleted</p>
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
            <DialogTitle>Delete Project</DialogTitle>
          </div>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the project and all associated data.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          {/* Danger Zone Warning */}
          <div className="border-2 border-destructive rounded-md p-4 my-4 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-destructive">Warning: This will delete:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>All cameras in this project</li>
                  <li>All camera trap images</li>
                  <li>All animal detections</li>
                  <li>All species classifications</li>
                  <li>All associated MinIO storage files</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Confirmation Input */}
          <div className="space-y-2">
            <label htmlFor="confirm" className="text-sm font-medium block">
              Type <span className="font-mono font-bold">{project.name}</span> to confirm:
            </label>
            <input
              id="confirm"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Enter project name"
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
                  Delete Project
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
