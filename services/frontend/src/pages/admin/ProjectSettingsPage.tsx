/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Includes detection confidence threshold and species filtering.
 */
import React, { useState, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, AlertCircle, Check, X } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/Dialog';
import { MultiSelect, Option } from '../../components/ui/MultiSelect';
import { useProject } from '../../contexts/ProjectContext';
import { adminApi } from '../../api/admin';
import { projectsApi } from '../../api/projects';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { ProjectUpdate, IndependenceSummaryResponse, DetectionCountResponse } from '../../api/types';

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

function formatInterval(minutes: number): string {
  const opt = INDEPENDENCE_INTERVAL_OPTIONS.find(o => o.value === minutes);
  if (opt) return opt.label;
  return `${minutes} minutes`;
}

// Data collected after save to populate the modal
interface ModalData {
  changes: { label: string; from: string; to: string }[];
  thresholdImpact: { oldResult: DetectionCountResponse; newResult: DetectionCountResponse } | null;
  independenceImpact: IndependenceSummaryResponse | null;
  speciesChanges: { added: string[]; removed: string[] } | null;
  blurChanged: boolean;
}

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject: currentProject, canAdminCurrentProject, refreshProjects } = useProject();
  const queryClient = useQueryClient();

  // Form state
  const [threshold, setThreshold] = useState<number>(currentProject?.detection_threshold ?? 0.2);
  const [includedSpecies, setIncludedSpecies] = useState<Option[]>([]);
  const [blurPeopleVehicles, setBlurPeopleVehicles] = useState<boolean>(currentProject?.blur_people_vehicles ?? true);
  const [independenceInterval, setIndependenceInterval] = useState<number>(currentProject?.independence_interval_minutes ?? 0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Toast + modal state
  const [showToast, setShowToast] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);

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

    // Snapshot old values before saving
    const oldThreshold = currentProject.detection_threshold;
    const oldInterval = currentProject.independence_interval_minutes ?? 0;
    const oldSpecies = currentProject.included_species || [];
    const oldBlur = currentProject.blur_people_vehicles ?? true;

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
      setSaveStatus('success');

      // Build modal data
      const changes: ModalData['changes'] = [];
      let thresholdImpact: ModalData['thresholdImpact'] = null;
      let independenceImpact: ModalData['independenceImpact'] = null;
      let speciesChanges: ModalData['speciesChanges'] = null;
      const blurChanged = hasBlurChanges;

      if (hasThresholdChanges) {
        changes.push({
          label: 'Detection threshold',
          from: `${(oldThreshold * 100).toFixed(0)}%`,
          to: `${(threshold * 100).toFixed(0)}%`,
        });
      }

      if (hasIntervalChanges) {
        changes.push({
          label: 'Independence interval',
          from: formatInterval(oldInterval),
          to: formatInterval(independenceInterval),
        });
      }

      if (hasSpeciesChanges) {
        const newSpecies = includedSpecies.map(s => s.value as string);
        const oldSet = new Set(oldSpecies);
        const newSet = new Set(newSpecies);
        const added = newSpecies.filter(s => !oldSet.has(s));
        const removed = oldSpecies.filter(s => !newSet.has(s));

        const fromLabel = oldSpecies.length === 0 ? 'All species' : `${oldSpecies.length} selected`;
        const toLabel = newSpecies.length === 0 ? 'All species' : `${newSpecies.length} selected`;
        changes.push({ label: 'Species filter', from: fromLabel, to: toLabel });
        speciesChanges = { added, removed };
      }

      if (blurChanged) {
        changes.push({
          label: 'Blur people & vehicles',
          from: oldBlur ? 'On' : 'Off',
          to: blurPeopleVehicles ? 'On' : 'Off',
        });
      }

      // Fetch impact data in parallel
      const impactPromises: Promise<void>[] = [];

      if (hasThresholdChanges) {
        impactPromises.push(
          Promise.all([
            statisticsApi.getDetectionCount(currentProject.id, oldThreshold),
            statisticsApi.getDetectionCount(currentProject.id, threshold),
          ]).then(([oldResult, newResult]) => {
            thresholdImpact = { oldResult, newResult };
          }).catch(() => {})
        );
      }

      if (hasIntervalChanges && independenceInterval > 0) {
        impactPromises.push(
          statisticsApi.getIndependenceSummary(currentProject.id)
            .then((summary) => { independenceImpact = summary; })
            .catch(() => {})
        );
      }

      await Promise.all(impactPromises);

      setModalData({ changes, thresholdImpact, independenceImpact, speciesChanges, blurChanged });
      setShowToast(true);
      setTimeout(() => {
        setSaveStatus('idle');
        setShowToast(false);
      }, 5000);
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

        </CardContent>
      </Card>

      {/* Toast notification */}
      {showToast && (
        <div
          className="fixed bottom-6 right-6 z-50 bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-3 flex items-center gap-3"
          style={{ animation: 'toast-slide-up 0.2s ease-out' }}
        >
          <Check className="h-4 w-4 text-[#0f6064] flex-shrink-0" />
          <span className="text-sm">
            Settings saved!
            {modalData && modalData.changes.length > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => { setShowChangesModal(true); setShowToast(false); }}
                  className="text-[#0f6064] hover:underline font-medium"
                >
                  See changes
                </button>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setShowToast(false)}
            className="text-gray-400 hover:text-gray-600 ml-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Settings changes modal */}
      <Dialog open={showChangesModal} onOpenChange={setShowChangesModal}>
        <DialogContent onClose={() => setShowChangesModal(false)}>
          <DialogHeader>
            <DialogTitle>Settings updated</DialogTitle>
          </DialogHeader>

          {modalData && (
            <div className="space-y-3">

              {/* Threshold card */}
              {modalData.changes.find(c => c.label === 'Detection threshold') && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm font-medium">Detection threshold</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Changed from <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.changes.find(c => c.label === 'Detection threshold')!.from}</code> to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.changes.find(c => c.label === 'Detection threshold')!.to}</code>
                    </p>
                    {modalData.thresholdImpact && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Impact on results</p>
                        <p className="text-sm text-muted-foreground mb-2">
                          {modalData.thresholdImpact.oldResult.total.toLocaleString()} &rarr; {modalData.thresholdImpact.newResult.total.toLocaleString()} detections
                          {modalData.thresholdImpact.oldResult.total > 0 && (() => {
                            const pct = Math.round(
                              ((modalData.thresholdImpact!.newResult.total - modalData.thresholdImpact!.oldResult.total)
                              / modalData.thresholdImpact!.oldResult.total) * 100
                            );
                            return (
                              <span className="text-xs ml-2 text-[#0f6064]">
                                {pct >= 0 ? '+' : ''}{pct}%
                              </span>
                            );
                          })()}
                        </p>
                        {(() => {
                          const oldMap = new Map(modalData.thresholdImpact!.oldResult.species.map(s => [s.species, s.count]));
                          const newMap = new Map(modalData.thresholdImpact!.newResult.species.map(s => [s.species, s.count]));
                          const allSpecies = [...new Set([...oldMap.keys(), ...newMap.keys()])];
                          allSpecies.sort((a, b) => (newMap.get(b) ?? 0) - (newMap.get(a) ?? 0));
                          return (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {allSpecies.map((species) => {
                                const oldCount = oldMap.get(species) ?? 0;
                                const newCount = newMap.get(species) ?? 0;
                                const diff = oldCount > 0
                                  ? Math.round(((newCount - oldCount) / oldCount) * 100)
                                  : 0;
                                return (
                                  <div key={species} className="flex justify-between text-xs text-muted-foreground">
                                    <span>{normalizeLabel(species)}</span>
                                    <span className="tabular-nums">
                                      {oldCount.toLocaleString()} &rarr; {newCount.toLocaleString()}
                                      <span className="ml-2 text-[#0f6064]">
                                        {diff >= 0 ? '+' : ''}{diff}%
                                      </span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Independence interval card */}
              {modalData.changes.find(c => c.label === 'Independence interval') && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm font-medium">Independence interval</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Changed from <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.changes.find(c => c.label === 'Independence interval')!.from}</code> to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.changes.find(c => c.label === 'Independence interval')!.to}</code>
                    </p>
                    {modalData.independenceImpact && modalData.independenceImpact.raw_total > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Impact on results</p>
                        <p className="text-sm text-muted-foreground mb-2">
                          {modalData.independenceImpact.raw_total.toLocaleString()} &rarr; {modalData.independenceImpact.independent_total.toLocaleString()} independent events
                          {(() => {
                            const pct = Math.round(
                              ((modalData.independenceImpact!.independent_total - modalData.independenceImpact!.raw_total)
                              / modalData.independenceImpact!.raw_total) * 100
                            );
                            return (
                              <span className="text-xs ml-2 text-[#0f6064]">
                                {pct >= 0 ? '+' : ''}{pct}%
                              </span>
                            );
                          })()}
                        </p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {modalData.independenceImpact.species.map((s) => {
                            const pct = s.raw_count > 0
                              ? Math.round(((s.independent_count - s.raw_count) / s.raw_count) * 100)
                              : 0;
                            return (
                              <div key={s.species} className="flex justify-between text-xs text-muted-foreground">
                                <span>{normalizeLabel(s.species)}</span>
                                <span className="tabular-nums">
                                  {s.raw_count.toLocaleString()} &rarr; {s.independent_count.toLocaleString()}
                                  <span className="ml-2 text-[#0f6064]">
                                    {pct >= 0 ? '+' : ''}{pct}%
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Species filter card */}
              {modalData.changes.find(c => c.label === 'Species filter') && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm font-medium">Species filter</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Changed from <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.changes.find(c => c.label === 'Species filter')!.from}</code> to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.changes.find(c => c.label === 'Species filter')!.to}</code>
                    </p>
                    {modalData.speciesChanges && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Impact on results</p>
                        {modalData.speciesChanges.added.length > 0 && (
                          <p className="text-sm text-muted-foreground">
                            Added: {modalData.speciesChanges.added.map(normalizeLabel).join(', ')}
                          </p>
                        )}
                        {modalData.speciesChanges.removed.length > 0 && (
                          <p className="text-sm text-muted-foreground">
                            Removed: {modalData.speciesChanges.removed.map(normalizeLabel).join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          Changes apply to future classifications only.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Blur card */}
              {modalData.blurChanged && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm font-medium">Blur people & vehicles</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Changed from <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{blurPeopleVehicles ? 'Off' : 'On'}</code> to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{blurPeopleVehicles ? 'On' : 'Off'}</code>
                    </p>
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      This is a visual change only.
                    </p>
                  </CardContent>
                </Card>
              )}

            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
