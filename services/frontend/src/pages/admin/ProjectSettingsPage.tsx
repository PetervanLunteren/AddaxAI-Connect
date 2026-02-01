/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Includes detection confidence threshold and species filtering.
 */
import React, { useState, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
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

  // Detection threshold state
  const [threshold, setThreshold] = useState<number>(currentProject?.detection_threshold!);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Species filtering state
  const [includedSpecies, setIncludedSpecies] = useState<Option[]>([]);
  const [speciesSaveStatus, setSpeciesSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // Update local threshold when project loads
  useEffect(() => {
    if (currentProject) {
      if (currentProject.detection_threshold === undefined) {
        throw new Error('Project detection_threshold is undefined - database schema violation');
      }
      setThreshold(currentProject.detection_threshold);
    }
  }, [currentProject]);

  // Load included species when project changes
  useEffect(() => {
    if (currentProject) {
      const included = currentProject.included_species || [];
      setIncludedSpecies(
        included.map(species => ({
          label: normalizeLabel(species),
          value: species
        }))
      );
    }
  }, [currentProject]);

  // Redirect if user doesn't have admin access
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

  // Detection threshold mutation
  const updateThresholdMutation = useMutation({
    mutationFn: async (threshold: number) => {
      return await adminApi.updateDetectionThreshold(currentProject.id, threshold);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
      setSuccessMessage(`Updated detection threshold to ${(data.detection_threshold * 100).toFixed(0)}%`);
      setError(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to update threshold');
      setTimeout(() => setError(null), 5000);
    },
  });

  // Species filtering mutation
  const updateSpeciesMutation = useMutation({
    mutationFn: (data: { id: number; update: ProjectUpdate }) =>
      projectsApi.update(data.id, data.update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      refreshProjects();
      setSpeciesSaveStatus('success');
      setTimeout(() => setSpeciesSaveStatus('idle'), 3000);
    },
    onError: () => {
      setSpeciesSaveStatus('error');
      setTimeout(() => setSpeciesSaveStatus('idle'), 3000);
    },
  });

  const handleThresholdSave = () => {
    if (threshold !== currentProject.detection_threshold) {
      updateThresholdMutation.mutate(threshold);
    }
  };

  const handleThresholdCancel = () => {
    setThreshold(currentProject.detection_threshold);
  };

  const handleSpeciesSave = () => {
    setSpeciesSaveStatus('saving');
    updateSpeciesMutation.mutate({
      id: currentProject.id,
      update: {
        included_species: includedSpecies.map(s => s.value as string),
      },
    });
  };

  const hasThresholdChanges = threshold !== currentProject.detection_threshold;

  const speciesOptions: Option[] = DEEPFAUNE_SPECIES.map(species => ({
    label: normalizeLabel(species),
    value: species
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Settings</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Configure detection thresholds and species filtering</p>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-md">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Detection Confidence Threshold */}
        <Card>
          <CardHeader>
            <CardTitle>Detection confidence threshold</CardTitle>
            <CardDescription>
              Control which detections are visible based on their confidence score
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
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
                    disabled={updateThresholdMutation.isPending}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {(threshold * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Only show detections with confidence above this value. Affects statistics, charts, and image display.
                  Works on all historic data immediately.
                </p>
              </div>

              {/* Action Buttons */}
              {hasThresholdChanges && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    onClick={handleThresholdSave}
                    disabled={updateThresholdMutation.isPending}
                    size="sm"
                  >
                    {updateThresholdMutation.isPending ? (
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
                  <Button
                    variant="outline"
                    onClick={handleThresholdCancel}
                    disabled={updateThresholdMutation.isPending}
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Species Filtering */}
        <Card>
          <CardHeader>
            <CardTitle>Species filtering</CardTitle>
            <CardDescription>
              Select which species are present in your study area to improve classification accuracy.
              Note: Species filtering applies to newly uploaded images only. Existing classifications are not affected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">
                  Species present in study area
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  Select which species occur in your study area. Only these species will appear in classification results. Leave empty to allow all species.
                </p>
                <MultiSelect
                  options={speciesOptions}
                  value={includedSpecies}
                  onChange={setIncludedSpecies}
                  placeholder="Select species present in your area..."
                />
                <p className="text-xs text-muted-foreground mt-2">
                  {includedSpecies.length === 0
                    ? 'No filter applied - all 38 species will be considered'
                    : `${includedSpecies.length} species allowed`}
                </p>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-2 border-t">
                <Button
                  onClick={handleSpeciesSave}
                  disabled={speciesSaveStatus === 'saving'}
                  size="sm"
                >
                  {speciesSaveStatus === 'saving' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : speciesSaveStatus === 'success' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Saved
                    </>
                  ) : speciesSaveStatus === 'error' ? (
                    <>
                      <AlertCircle className="h-4 w-4 mr-2" />
                      Error
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save changes
                    </>
                  )}
                </Button>

                {speciesSaveStatus === 'success' && (
                  <p className="text-sm text-green-600">
                    Settings saved successfully
                  </p>
                )}
                {speciesSaveStatus === 'error' && (
                  <p className="text-sm text-red-600">
                    Failed to save settings
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
