/**
 * Create Project Modal
 *
 * Form to create a new project with name, description, and image upload.
 * Uses React Dropzone for image upload with preview.
 */
import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Loader2, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { TimezoneSelect } from '../ui/TimezoneSelect';
import { projectsApi } from '../../api/projects';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ open, onClose }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      // First create the project
      const project = await projectsApi.create({
        name,
        description: description || undefined,
        included_species: null, // All species allowed
        timezone,
      });

      // Then upload image if provided
      if (imageFile) {
        await projectsApi.uploadImage(project.id, imageFile);
      }

      return project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      handleClose();
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to create project');
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
    setName('');
    setDescription('');
    setTimezone('');
    setImageFile(null);
    setImagePreview(null);
    setError(null);
    onClose();
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    if (!timezone) {
      setError('Please select a timezone');
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a new wildlife monitoring project with a name, description, and optional image.
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

            {/* Camera Timezone */}
            <div>
              <label className="text-sm font-medium block mb-1">
                Camera timezone <span className="text-destructive">*</span>
              </label>
              <TimezoneSelect
                value={timezone}
                onChange={setTimezone}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Timezone the cameras are set to
              </p>
            </div>

            {/* Image Upload */}
            <div>
              <label className="text-sm font-medium block mb-1">
                Project Image (optional)
              </label>

              {imagePreview ? (
                <div className="relative">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-48 object-cover rounded-md border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={handleRemoveImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
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
            <Button type="submit" disabled={createMutation.isPending || !name.trim() || !timezone}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
