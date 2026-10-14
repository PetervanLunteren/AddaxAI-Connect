/**
 * Create Project Modal
 *
 * Form to create a new project with name, description, country, and image
 * upload. The country is required, and on SpeciesNet servers so is the
 * taxonomy mapping CSV: it travels in the create request, so a project never
 * exists without its label list. Uses React Dropzone for image upload with
 * preview.
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
import { Callout } from '../ui/Callout';
import { CountrySelect } from '../ui/CountrySelect';
import { StateSelect } from '../ui/StateSelect';
import { TaxonomyDropzone } from './TaxonomyDropzone';
import { projectsApi } from '../../api/projects';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** SpeciesNet server: the project needs a taxonomy mapping CSV */
  requireTaxonomy: boolean;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ open, onClose, requireTaxonomy }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [admin1Region, setAdmin1Region] = useState('');
  const [taxonomyFile, setTaxonomyFile] = useState<File | null>(null);
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
        country_code: countryCode,
        admin1_region: admin1Region || null,
        taxonomy_csv: requireTaxonomy && taxonomyFile ? await taxonomyFile.text() : undefined,
      });

      // Then upload image if provided
      if (imageFile) {
        await projectsApi.uploadImage(project.id, imageFile);
      }

      return project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
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
    setCountryCode('');
    setAdmin1Region('');
    setTaxonomyFile(null);
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
    if (!countryCode) {
      setError('Country is required');
      return;
    }
    if (requireTaxonomy && !taxonomyFile) {
      setError('Species labels are required');
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Create a new wildlife monitoring project with a name, description, and optional image.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Project Name */}
            <div>
              <label htmlFor="name" className="text-sm font-medium block mb-1">
                Project name <span className="text-destructive">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Wildlife monitoring"
                className="w-full px-3 py-2 border rounded-md"
                maxLength={255}
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

            {/* Country, and the state for the USA */}
            <div>
              <label className="text-sm font-medium block mb-1">
                Country <span className="text-destructive">*</span>
              </label>
              <CountrySelect
                value={countryCode}
                onChange={(code) => {
                  setCountryCode(code);
                  if (code !== 'USA') setAdmin1Region('');
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Where the cameras of this project are
              </p>
            </div>
            {countryCode === 'USA' && (
              <div>
                <label className="text-sm font-medium block mb-1">
                  State (optional)
                </label>
                <StateSelect value={admin1Region} onChange={setAdmin1Region} />
              </div>
            )}

            {/* Species labels, SpeciesNet only */}
            {requireTaxonomy && (
              <div>
                <label className="text-sm font-medium block mb-1">
                  Species labels <span className="text-destructive">*</span>
                </label>
                <TaxonomyDropzone file={taxonomyFile} onFileChange={setTaxonomyFile} />
                <p className="text-xs text-muted-foreground mt-1">
                  A CSV with latin and common columns. See the{' '}
                  <a
                    href="https://connect.addaxai.com/speciesnet-setup/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    SpeciesNet setup guide
                  </a>{' '}
                  for how to make one.
                </p>
              </div>
            )}

            {/* Image Upload */}
            <div>
              <label className="text-sm font-medium block mb-1">
                Project image (optional)
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
            {error && <Callout variant="error">{error}</Callout>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !name.trim() || !countryCode || (requireTaxonomy && !taxonomyFile)}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create project'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
