/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Includes detection confidence threshold and species filtering.
 */
import React, { useState, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MultiSelect, Option } from '../../components/ui/MultiSelect';
import { useProject } from '../../contexts/ProjectContext';
import { adminApi } from '../../api/admin';
import { projectsApi } from '../../api/projects';
import { normalizeLabel } from '../../utils/labels';
import type { ProjectUpdate } from '../../api/types';

// DeepFaune v1.4 species list (38 European wildlife species)
const DEEPFAUNE_SPECIES = [
  'badger', 'bear', 'beaver', 'bird', 'bison', 'cat', 'chamois', 'cow',
  'dog', 'equid', 'fallow_deer', 'fox', 'genet', 'goat', 'golden_jackal',
  'hedgehog', 'ibex', 'lagomorph', 'lynx', 'marmot', 'micromammal', 'moose',
  'mouflon', 'muskrat', 'mustelid', 'nutria', 'otter', 'porcupine', 'raccoon',
  'raccoon_dog', 'red_deer', 'reindeer', 'roe_deer', 'sheep', 'squirrel',
  'wild_boar', 'wolf', 'wolverine'
].sort();

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject: currentProject, canAdminCurrentProject, refreshProjects } = useProject();
  const queryClient = useQueryClient();

  // State
  const [threshold, setThreshold] = useState<number>(currentProject?.detection_threshold ?? 0.2);
  const [includedSpecies, setIncludedSpecies] = useState<Option[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Load values when project changes
  useEffect(() => {
    if (currentProject) {
      setThreshold(currentProject.detection_threshold ?? 0.2);
      const included = currentProject.included_species || [];
      setIncludedSpecies(
        included.map(species => ({
          label: normalizeLabel(species),
          value: species
        }))
      );
    }
  }, [currentProject]);

  // Detection threshold mutation (must be before any conditional returns)
  const updateThresholdMutation = useMutation({
    mutationFn: async (newThreshold: number) => {
      if (!currentProject) throw new Error('No project selected');
      return await adminApi.updateDetectionThreshold(currentProject.id, newThreshold);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
    },
  });

  // Species filtering mutation (must be before any conditional returns)
  const updateSpeciesMutation = useMutation({
    mutationFn: (data: { id: number; update: ProjectUpdate }) =>
      projectsApi.update(data.id, data.update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      refreshProjects();
    },
  });

  // Redirect if user doesn't have admin access (after all hooks)
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to manage settings.</p>
      </div>
    );
  }

  // Check for unsaved changes
  const hasThresholdChanges = threshold !== currentProject.detection_threshold;
  const currentSpeciesValues = (currentProject.included_species || []).sort().join(',');
  const selectedSpeciesValues = includedSpecies.map(s => s.value as string).sort().join(',');
  const hasSpeciesChanges = currentSpeciesValues !== selectedSpeciesValues;
  const hasUnsavedChanges = hasThresholdChanges || hasSpeciesChanges;

  // Unified save handler
  const handleSave = async () => {
    setSaveStatus('saving');
    setError(null);

    try {
      const promises: Promise<any>[] = [];

      if (hasThresholdChanges) {
        promises.push(updateThresholdMutation.mutateAsync(threshold));
      }

      if (hasSpeciesChanges) {
        promises.push(updateSpeciesMutation.mutateAsync({
          id: currentProject.id,
          update: {
            included_species: includedSpecies.map(s => s.value as string),
          },
        }));
      }

      await Promise.all(promises);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to save settings');
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const speciesOptions: Option[] = DEEPFAUNE_SPECIES.map(species => ({
    label: normalizeLabel(species),
    value: species
  }));

  const isSaving = saveStatus === 'saving';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Settings</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Configure project-wide settings and preferences</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {/* Detection Confidence Threshold */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Detection confidence threshold
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #0f6064 0%, #0f6064 ${threshold * 100}%, #e1eceb ${threshold * 100}%, #e1eceb 100%)`,
                }}
                disabled={isSaving}
              />
              <span className="text-sm font-medium w-12 text-right">
                {(threshold * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Minimum confidence for detections to appear in results
            </p>
          </div>

          {/* Divider */}
          <div className="border-t my-6" />

          {/* Species Filtering */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Species filtering
            </label>
            <MultiSelect
              options={speciesOptions}
              value={includedSpecies}
              onChange={setIncludedSpecies}
              placeholder="Select species..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Only selected species appear in new classifications. Leave empty for all.
            </p>
          </div>

          {/* Save Button */}
          {hasUnsavedChanges && (
            <div className="mt-6 pt-4 border-t">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                size="sm"
              >
                {isSaving ? (
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
            </div>
          )}

          {/* Success message */}
          {saveStatus === 'success' && !hasUnsavedChanges && (
            <div className="mt-6 pt-4 border-t">
              <p className="text-sm text-green-600">Settings saved</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
