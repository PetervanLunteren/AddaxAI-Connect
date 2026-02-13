/**
 * Edit Project Modal
 *
 * Form to edit existing project name, description, and replace image.
 * Pre-populated with current project data.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Loader2, Upload, X, Trash2 } from 'lucide-react';
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
import type { Project } from '../../api/types';

interface EditProjectModalProps {
  project: Project;
  open: boolean;
  onClose: () => void;
}

export const EditProjectModal: React.FC<EditProjectModalProps> = ({ project, open, onClose }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when project changes
  useEffect(() => {
    setName(project.name);
    setDescription(project.description || '');
    setImageFile(null);
    setImagePreview(null);
    setRemoveCurrentImage(false);
    setError(null);
  }, [project, open]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      // Update project metadata
      await projectsApi.update(project.id, {
        name,
        description: description || undefined,
      });

      // Handle image changes
      if (removeCurrentImage && project.image_path) {
        await projectsApi.deleteImage(project.id);
      }

      if (imageFile) {
        await projectsApi.uploadImage(project.id, imageFile);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
      handleClose();
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to update project');
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB');
        return;
      }

      // Validate file type
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        setError('Image must be JPEG or PNG');
        return;
      }

      setImageFile(file);
      setRemoveCurrentImage(false);
      setError(null);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 1,
    multiple: false,
  });

  const handleClose = () => {
    setName(project.name);
    setDescription(project.description || '');
    setImageFile(null);
    setImagePreview(null);
    setRemoveCurrentImage(false);
    setError(null);
    onClose();
  };

  const handleRemoveNewImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleRemoveCurrentImage = () => {
    setRemoveCurrentImage(true);
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    updateMutation.mutate();
  };

  // Determine which image to show
  const currentImageUrl = !removeCurrentImage ? project.thumbnail_url : null;
  const showCurrentImage = currentImageUrl && !imagePreview;
  const showNewImage = imagePreview;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Update project name, description, and image.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Project Name */}
            <div>
              <label htmlFor="name" className="text-sm font-medium block mb-1">
                Project Name <span className="text-destructive">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Wildlife Monitoring"
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="text-sm font-medium block mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the project (optional)"
                rows={3}
                className="w-full px-3 py-2 border rounded-md resize-none"
              />
            </div>

            {/* Image Upload/Replace */}
            <div>
              <label className="text-sm font-medium block mb-1">
                Project Image
              </label>

              {showNewImage ? (
                // New image preview
                <div className="relative">
                  <img
                    src={imagePreview}
                    alt="New image preview"
                    className="w-full h-48 object-cover rounded-md border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={handleRemoveNewImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                    New image (will replace current)
                  </div>
                </div>
              ) : showCurrentImage ? (
                // Current image
                <div className="relative">
                  <img
                    src={currentImageUrl}
                    alt="Current project image"
                    className="w-full h-48 object-cover rounded-md border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={handleRemoveCurrentImage}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div
                    {...getRootProps()}
                    className="absolute inset-0 bg-black/0 hover:bg-black/50 transition-colors cursor-pointer flex items-center justify-center group rounded-md"
                  >
                    <input {...getInputProps()} />
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium">
                      Click to replace
                    </div>
                  </div>
                </div>
              ) : (
                // No image (upload new)
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
                    isDragActive ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/50'
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isDragActive ? 'Drop image here' : 'Drag and drop an image, or click to select'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    JPEG or PNG, max 5MB
                  </p>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
