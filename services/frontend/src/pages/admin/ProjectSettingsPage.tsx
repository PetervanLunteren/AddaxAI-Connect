/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Includes detection confidence threshold and species filtering.
 */
import React, { useState, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MultiSelect, Option } from '../../components/ui/MultiSelect';
import { useProject } from '../../contexts/ProjectContext';
import { adminApi } from '../../api/admin';
import { projectsApi } from '../../api/projects';
import { statisticsApi } from '../../api/statistics';
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

const INDEPENDENCE_INTERVAL_OPTIONS = [
  { value: 0, label: 'Disabled' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes (recommended)' },
  { value: 60, label: '60 minutes' },
];

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject: currentProject, canAdminCurrentProject, refreshProjects } = useProject();
  const queryClient = useQueryClient();

  // State
  const [threshold, setThreshold] = useState<number>(currentProject?.detection_threshold ?? 0.2);
  const [includedSpecies, setIncludedSpecies] = useState<Option[]>([]);
  const [blurPeopleVehicles, setBlurPeopleVehicles] = useState<boolean>(currentProject?.blur_people_vehicles ?? true);
  const [independenceInterval, setIndependenceInterval] = useState<number>(currentProject?.independence_interval_minutes ?? 0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showSpeciesBreakdown, setShowSpeciesBreakdown] = useState(false);

  // Load values when project changes
  useEffect(() => {
    if (currentProject) {
      setThreshold(currentProject.detection_threshold ?? 0.2);
      setBlurPeopleVehicles(currentProject.blur_people_vehicles ?? true);
      setIndependenceInterval(currentProject.independence_interval_minutes ?? 0);
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
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
      refreshProjects();
    },
  });

  // Independence interval impact summary (only fetched when saved interval > 0)
  const { data: independenceSummary } = useQuery({
    queryKey: ['independence-summary', currentProject?.id],
    queryFn: () => statisticsApi.getIndependenceSummary(currentProject!.id),
    enabled: !!currentProject && (currentProject.independence_interval_minutes ?? 0) > 0,
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
  const hasBlurChanges = blurPeopleVehicles !== (currentProject.blur_people_vehicles ?? true);
  const hasIntervalChanges = independenceInterval !== (currentProject.independence_interval_minutes ?? 0);
  const hasUnsavedChanges = hasThresholdChanges || hasSpeciesChanges || hasBlurChanges || hasIntervalChanges;

  // Unified save handler
  const handleSave = async () => {
    setSaveStatus('saving');
    setError(null);

    try {
      const promises: Promise<any>[] = [];

      if (hasThresholdChanges) {
        promises.push(updateThresholdMutation.mutateAsync(threshold));
      }

      if (hasSpeciesChanges || hasBlurChanges || hasIntervalChanges) {
        const update: ProjectUpdate = {};
        if (hasSpeciesChanges) {
          update.included_species = includedSpecies.map(s => s.value as string);
        }
        if (hasBlurChanges) {
          update.blur_people_vehicles = blurPeopleVehicles;
        }
        if (hasIntervalChanges) {
          update.independence_interval_minutes = independenceInterval;
        }
        promises.push(updateSpeciesMutation.mutateAsync({
          id: currentProject.id,
          update,
        }));
      }

      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ['independence-summary'] });
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

          {/* Divider */}
          <div className="border-t my-6" />

          {/* Privacy blur */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium block">
                Blur people and vehicles
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically blur detected people and vehicles in all images for privacy
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={blurPeopleVehicles}
              onClick={() => setBlurPeopleVehicles(!blurPeopleVehicles)}
              disabled={isSaving}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                blurPeopleVehicles ? 'bg-[#0f6064]' : 'bg-gray-300'
              } ${isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  blurPeopleVehicles ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Divider */}
          <div className="border-t my-6" />

          {/* Independence Interval */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Independence interval
            </label>
            <select
              value={independenceInterval}
              onChange={(e) => setIndependenceInterval(parseInt(e.target.value, 10))}
              disabled={isSaving}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f6064] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {INDEPENDENCE_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Detections of the same species at the same camera within this interval are counted as one event. Applies to all statistics and exports retroactively.
            </p>
            {independenceSummary && independenceSummary.raw_total > 0 && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
                <div className="flex items-center justify-between">
                  <span>
                    {independenceSummary.raw_total.toLocaleString()} detections → {independenceSummary.independent_total.toLocaleString()} independent events
                  </span>
                  {independenceSummary.species.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setShowSpeciesBreakdown(!showSpeciesBreakdown)}
                      className="ml-2 text-blue-600 hover:text-blue-800"
                    >
                      {showSpeciesBreakdown ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
                {showSpeciesBreakdown && (
                  <div className="mt-2 pt-2 border-t border-blue-200 space-y-1">
                    {independenceSummary.species.map((s) => (
                      <div key={s.species} className="flex justify-between">
                        <span>{normalizeLabel(s.species)}</span>
                        <span className="tabular-nums">{s.raw_count.toLocaleString()} → {s.independent_count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
