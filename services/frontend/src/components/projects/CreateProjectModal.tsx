/**
 * Create Project Modal
 *
 * Form to create a new project with name, description, country, the
 * classification model and an optional image. The country and the model
 * are required, and for a SpeciesNet model so is the taxonomy mapping CSV:
 * it travels in the create request, so a project never exists without its
 * label list. The model is locked after creation.
 *
 * Every model in the catalog is listed, grouped by region. Models the
 * server cannot load right now (not enough memory, worker down) are greyed
 * out, with the reason under the list.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { classificationModelsApi, ClassificationModelInfo } from '../../api/classificationModels';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

const REGION_LABELS: Record<string, string> = {
  global: 'Global',
  europe: 'Europe',
  africa: 'Africa',
  americas: 'Americas',
  asia: 'Asia',
  oceania: 'Oceania',
};
const REGION_ORDER = Object.keys(REGION_LABELS);

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ open, onClose }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [admin1Region, setAdmin1Region] = useState('');
  const [modelId, setModelId] = useState('');
  const [taxonomyFile, setTaxonomyFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched while the dialog is open, so the memory check is fresh.
  const { data: models } = useQuery({
    queryKey: ['classification-models'],
    queryFn: classificationModelsApi.list,
    enabled: open,
    staleTime: 0,
  });
  const modelsByRegion = useMemo(() => {
    const groups: Record<string, ClassificationModelInfo[]> = {};
    for (const model of models ?? []) {
      (groups[model.region] ??= []).push(model);
    }
    return REGION_ORDER.filter((r) => groups[r]).map((r) => ({ region: r, models: groups[r] }));
  }, [models]);
  const selectedModel = models?.find((m) => m.id === modelId);
  const requireTaxonomy = selectedModel?.kind === 'speciesnet';
  const unavailableReasons = useMemo(
    () => [...new Set((models ?? []).filter((m) => !m.fits).map((m) => m.reason ?? ''))].filter(Boolean),
    [models],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      // First create the project
      const project = await projectsApi.create({
        name,
        description: description || undefined,
        included_species: null, // All species allowed
        country_code: countryCode,
        admin1_region: admin1Region || null,
        classification_model: modelId,
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
    setModelId('');
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
    if (!modelId) {
      setError('A species model is required');
      return;
    }
    if (requireTaxonomy && !taxonomyFile) {
      setError('Species labels are required');
      return;
    }
    setError(null); // a new attempt, so the last attempt's error no longer applies
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

            {/* Species model, locked after creation */}
            <div>
              <label htmlFor="model" className="text-sm font-medium block mb-1">
                Species model <span className="text-destructive">*</span>
              </label>
              <select
                id="model"
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setTaxonomyFile(null);
                }}
                className="w-full px-3 py-2 border rounded-md bg-background"
                required
              >
                <option value="">{models ? 'Pick a model' : 'Loading models...'}</option>
                {modelsByRegion.map(({ region, models: group }) => (
                  <optgroup key={region} label={REGION_LABELS[region]}>
                    {group.map((model) => (
                      <option key={model.id} value={model.id} disabled={!model.fits}>
                        {model.emoji} {model.name}{model.fits ? '' : ' (unavailable)'}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedModel
                  ? `${selectedModel.description}. By ${selectedModel.developer}. The model cannot be changed later.`
                  : 'The AI model that names the animals. Pick the one made for your region. It cannot be changed later.'}
              </p>
              {unavailableReasons.map((reason) => (
                <p key={reason} className="text-xs text-muted-foreground mt-1">
                  Unavailable models cannot be picked right now. {reason}.
                </p>
              ))}
            </div>

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
            <Button
              type="submit"
              disabled={
                createMutation.isPending || !name.trim() || !countryCode || !modelId || (requireTaxonomy && !taxonomyFile)
              }
            >
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
