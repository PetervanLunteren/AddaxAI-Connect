/**
 * Species Management page for configuring species filtering
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { useProject } from '../contexts/ProjectContext';
import { projectsApi } from '../api/projects';
import type { ProjectUpdate } from '../api/types';

// DeepFaune v1.4 species list (38 European wildlife species)
const DEEPFAUNE_SPECIES = [
  'badger', 'bear', 'beaver', 'bird', 'bison', 'cat', 'chamois', 'cow',
  'dog', 'equid', 'fallow_deer', 'fox', 'genet', 'goat', 'golden_jackal',
  'hedgehog', 'ibex', 'lagomorph', 'lynx', 'marmot', 'micromammal', 'moose',
  'mouflon', 'muskrat', 'mustelid', 'nutria', 'otter', 'porcupine', 'raccoon',
  'raccoon_dog', 'red_deer', 'reindeer', 'roe_deer', 'sheep', 'squirrel',
  'wild_boar', 'wolf', 'wolverine'
].sort(); // Alphabetically sorted for UI

export const SpeciesManagementPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedProject, loading: projectsLoading, refreshProjects } = useProject();
  const [includedSpecies, setIncludedSpecies] = useState<Option[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // Load included species when project changes
  useEffect(() => {
    if (selectedProject) {
      const included = selectedProject.included_species || [];
      setIncludedSpecies(
        included.map(species => ({
          label: species.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: species
        }))
      );
    }
  }, [selectedProject]);

  // Update project mutation
  const updateMutation = useMutation({
    mutationFn: (data: { id: number; update: ProjectUpdate }) =>
      projectsApi.update(data.id, data.update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      refreshProjects();
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
    onError: () => {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
  });

  const handleSave = () => {
    if (!selectedProject) return;

    setSaveStatus('saving');
    updateMutation.mutate({
      id: selectedProject.id,
      update: {
        included_species: includedSpecies.map(s => s.value as string),
      },
    });
  };

  // Convert species names to user-friendly format
  const speciesOptions: Option[] = DEEPFAUNE_SPECIES.map(species => ({
    label: species.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value: species
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Species Management</h1>

      <Card>
        <CardHeader>
          <CardTitle>Species Filtering</CardTitle>
          <CardDescription>
            Select which species are present in your study area to improve classification accuracy.
            Note: Species filtering applies to newly uploaded images only. Existing classifications are not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedProject ? (
            <div className="text-sm text-muted-foreground py-4">
              No project found. Please contact your administrator to set up a project.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Species Selection */}
              <div>
                <label className="text-sm font-medium block mb-2">
                  Species Present in Study Area
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
                    : `${includedSpecies.length} ${includedSpecies.length === 1 ? 'species' : 'species'} allowed`}
                </p>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving'}
                  className="min-w-[120px]"
                >
                  {saveStatus === 'saving' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : saveStatus === 'success' ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Saved
                    </>
                  ) : saveStatus === 'error' ? (
                    <>
                      <AlertCircle className="mr-2 h-4 w-4" />
                      Error
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>

                {saveStatus === 'success' && (
                  <p className="text-sm text-green-600">
                    Settings saved successfully
                  </p>
                )}
                {saveStatus === 'error' && (
                  <p className="text-sm text-red-600">
                    Failed to save settings
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
