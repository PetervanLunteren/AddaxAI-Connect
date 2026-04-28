/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Includes detection confidence threshold and species filtering.
 */
import React, { useState, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, AlertCircle, Check, X, ChevronDown, ChevronUp, RotateCcw, Undo2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/Dialog';
import { MultiSelect, Option } from '../../components/ui/MultiSelect';
import { CameraGroupsModal } from '../../components/CameraGroupsModal';
import { ClassificationThresholdsModal } from '../../components/ClassificationThresholdsModal';
import { useProject } from '../../contexts/ProjectContext';
import { adminApi } from '../../api/admin';
import { projectsApi } from '../../api/projects';
import { statisticsApi } from '../../api/statistics';
import { cameraGroupsApi } from '../../api/cameraGroups';
import { camerasApi } from '../../api/cameras';
import { normalizeLabel } from '../../utils/labels';
import { speciesApi } from '../../api/species';
import type { ProjectUpdate, IndependenceSummaryResponse, DetectionCountResponse, CameraGroup } from '../../api/types';

const INDEPENDENCE_INTERVAL_OPTIONS = [
  { value: 0, label: 'Disabled' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
];

// Data collected after save to populate the modal
interface ModalData {
  observations: { before: DetectionCountResponse; after: DetectionCountResponse };
  events: { before: IndependenceSummaryResponse; after: IndependenceSummaryResponse };
}

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject: currentProject, canAdminCurrentProject, refreshProjects } = useProject();
  const queryClient = useQueryClient();

  // Form state
  const [threshold, setThreshold] = useState<number>(currentProject?.detection_threshold ?? 0.2);
  const [includedSpecies, setIncludedSpecies] = useState<Option[]>([]);
  const [blurPeopleVehicles, setBlurPeopleVehicles] = useState<boolean>(currentProject?.blur_people_vehicles ?? true);
  const [independenceInterval, setIndependenceInterval] = useState<number>(currentProject?.independence_interval_minutes ?? 30);
  const [classificationDefault, setClassificationDefault] = useState<number>(
    currentProject?.classification_thresholds?.default ?? 0.0,
  );
  const [classificationOverrides, setClassificationOverrides] = useState<Record<string, number>>(
    currentProject?.classification_thresholds?.overrides ?? {},
  );
  const [showClassificationOverridesModal, setShowClassificationOverridesModal] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Camera groups state
  const [showCameraGroups, setShowCameraGroups] = useState(false);
  const [pendingGroups, setPendingGroups] = useState<CameraGroup[]>([]);

  // Toast + modal state
  const [showToast, setShowToast] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [showThresholdBreakdown, setShowThresholdBreakdown] = useState(false);
  const [showIndependenceBreakdown, setShowIndependenceBreakdown] = useState(false);
  const [showEventBreakdown, setShowEventBreakdown] = useState(false);

  // Load values when project changes
  useEffect(() => {
    if (currentProject) {
      setThreshold(currentProject.detection_threshold ?? 0.2);
      setBlurPeopleVehicles(currentProject.blur_people_vehicles ?? true);
      setIndependenceInterval(currentProject.independence_interval_minutes ?? 30);
      setClassificationDefault(currentProject.classification_thresholds?.default ?? 0.0);
      setClassificationOverrides(currentProject.classification_thresholds?.overrides ?? {});
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

  // Classification thresholds mutation
  const updateClassificationThresholdsMutation = useMutation({
    mutationFn: async (data: { default: number; overrides: Record<string, number> }) => {
      if (!currentProject) throw new Error('No project selected');
      return await adminApi.updateClassificationThresholds(currentProject.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
      refreshProjects();
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

  // Camera groups query
  const { data: cameraGroups = [] } = useQuery({
    queryKey: ['camera-groups', currentProject?.id],
    queryFn: () => cameraGroupsApi.list(currentProject!.id),
    enabled: !!currentProject,
  });

  // Cameras query (for the groups modal)
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras', currentProject?.id],
    queryFn: () => camerasApi.getAll(currentProject!.id),
    enabled: !!currentProject,
  });

  // Available species query (model-dependent)
  const { data: availableSpeciesData } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
  });
  const isSpeciesNet = availableSpeciesData?.model === 'speciesnet';

  // Sync fetched groups into pending state
  useEffect(() => {
    setPendingGroups(cameraGroups);
  }, [cameraGroups]);

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
  const hasIntervalChanges = independenceInterval !== (currentProject.independence_interval_minutes ?? 30);

  const hasClassificationThresholdChanges = (() => {
    const stored = currentProject.classification_thresholds ?? { default: 0.0, overrides: {} };
    if (classificationDefault !== (stored.default ?? 0.0)) return true;
    const storedOverrides = stored.overrides ?? {};
    const storedKeys = Object.keys(storedOverrides);
    const currentKeys = Object.keys(classificationOverrides);
    if (storedKeys.length !== currentKeys.length) return true;
    for (const [species, value] of Object.entries(classificationOverrides)) {
      if (storedOverrides[species] !== value) return true;
    }
    return false;
  })();

  // Compare pending groups against saved groups
  const hasGroupChanges = (() => {
    if (pendingGroups.length !== cameraGroups.length) return true;
    const savedMap = new Map(cameraGroups.map(g => [g.id, g]));
    return pendingGroups.some(pg => {
      if (pg.id < 0) return true; // new group (temp ID)
      const saved = savedMap.get(pg.id);
      if (!saved) return true; // deleted and re-added? shouldn't happen
      if (pg.name !== saved.name) return true;
      const oldIds = [...saved.camera_ids].sort().join(',');
      const newIds = [...pg.camera_ids].sort().join(',');
      return oldIds !== newIds;
    }) || cameraGroups.some(sg => !pendingGroups.find(pg => pg.id === sg.id)); // deleted group
  })();

  const hasUnsavedChanges =
    hasThresholdChanges ||
    hasSpeciesChanges ||
    hasBlurChanges ||
    hasIntervalChanges ||
    hasGroupChanges ||
    hasClassificationThresholdChanges;

  // Unified save handler
  const handleSave = async () => {
    setSaveStatus('saving');
    setError(null);

    // Snapshot old values before saving
    const oldThreshold = currentProject.detection_threshold;
    const oldInterval = currentProject.independence_interval_minutes ?? 30;

    try {
      // 1. Fetch "before" stats (old settings still in DB)
      const [beforeObservations, beforeEventsRaw] = await Promise.all([
        statisticsApi.getDetectionCount(currentProject.id, oldThreshold),
        oldInterval > 0
          ? statisticsApi.getIndependenceSummary(currentProject.id, oldInterval)
          : null,
      ]);

      // 2. Save all changes
      const promises: Promise<any>[] = [];

      if (hasThresholdChanges) {
        promises.push(updateThresholdMutation.mutateAsync(threshold));
      }

      if (hasClassificationThresholdChanges) {
        promises.push(
          updateClassificationThresholdsMutation.mutateAsync({
            default: classificationDefault,
            overrides: classificationOverrides,
          }),
        );
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

      // Save camera group changes
      if (hasGroupChanges) {
        const savedMap = new Map(cameraGroups.map(g => [g.id, g]));

        // Delete removed groups
        for (const saved of cameraGroups) {
          if (!pendingGroups.find(pg => pg.id === saved.id)) {
            await cameraGroupsApi.delete(currentProject.id, saved.id);
          }
        }

        // Create new groups (negative temp IDs) and update existing
        for (const pg of pendingGroups) {
          if (pg.id < 0) {
            // New group
            const created = await cameraGroupsApi.create(currentProject.id, pg.name, pg.camera_ids.length > 0 ? pg.camera_ids : undefined);
            if (pg.camera_ids.length > 0) {
              await cameraGroupsApi.setCameras(currentProject.id, created.id, pg.camera_ids);
            }
          } else {
            const saved = savedMap.get(pg.id);
            if (!saved) continue;
            if (pg.name !== saved.name) {
              await cameraGroupsApi.rename(currentProject.id, pg.id, pg.name);
            }
            const oldIds = [...saved.camera_ids].sort().join(',');
            const newIds = [...pg.camera_ids].sort().join(',');
            if (oldIds !== newIds) {
              await cameraGroupsApi.setCameras(currentProject.id, pg.id, pg.camera_ids);
            }
          }
        }

        queryClient.invalidateQueries({ queryKey: ['camera-groups', currentProject.id] });
      }
      setSaveStatus('success');

      // 3. Fetch "after" stats (new settings now in DB)
      const [afterObservations, afterEventsRaw] = await Promise.all([
        statisticsApi.getDetectionCount(currentProject.id, threshold),
        independenceInterval > 0
          ? statisticsApi.getIndependenceSummary(currentProject.id, independenceInterval)
          : null,
      ]);

      // 4. Build fallback for interval=0 (no grouping = every detection is independent)
      const eventsFallback = (obs: DetectionCountResponse): IndependenceSummaryResponse => ({
        raw_total: obs.total,
        independent_total: obs.total,
        independent_event_total: obs.total,
        species: obs.species.map(s => ({ species: s.species, raw_count: s.count, independent_count: s.count, independent_event_count: s.count })),
      });

      setModalData({
        observations: { before: beforeObservations, after: afterObservations },
        events: {
          before: beforeEventsRaw ?? eventsFallback(beforeObservations),
          after: afterEventsRaw ?? eventsFallback(afterObservations),
        },
      });

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

  // Reset form to currently saved values
  const handleResetUnsaved = () => {
    setThreshold(currentProject.detection_threshold ?? 0.2);
    setBlurPeopleVehicles(currentProject.blur_people_vehicles ?? true);
    setIndependenceInterval(currentProject.independence_interval_minutes ?? 30);
    setClassificationDefault(currentProject.classification_thresholds?.default ?? 0.0);
    setClassificationOverrides(currentProject.classification_thresholds?.overrides ?? {});
    const included = currentProject.included_species || [];
    setIncludedSpecies(
      included.map(species => ({ label: normalizeLabel(species), value: species }))
    );
    setPendingGroups(cameraGroups);
  };

  // Restore defaults (fill form only, user must save)
  const handleRestoreDefaults = () => {
    setThreshold(0.5);
    setBlurPeopleVehicles(true);
    setIndependenceInterval(30);
    setClassificationDefault(0.0);
    setClassificationOverrides({});
  };

  const speciesOptions: Option[] = (availableSpeciesData?.species ?? []).map(species => ({
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            <div className="w-full sm:w-1/2 sm:shrink-0">
              <label className="text-sm font-medium block">
                Detection confidence threshold
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Hide detections below this confidence score. Only affects unverified images.
              </p>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
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
          </div>

          <div className="border-t my-6" />

          {/* Classification Confidence Threshold */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            <div className="w-full sm:w-1/2 sm:shrink-0">
              <label className="text-sm font-medium block">
                Classification confidence threshold
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Hide species predictions below this confidence. Use the per-species overrides to filter noisy species.
              </p>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-[2] flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={classificationDefault}
                  onChange={(e) => setClassificationDefault(parseFloat(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #0f6064 0%, #0f6064 ${classificationDefault * 100}%, #e1eceb ${classificationDefault * 100}%, #e1eceb 100%)`,
                  }}
                  disabled={isSaving}
                />
                <span className="text-sm font-medium w-12 text-right">
                  {(classificationDefault * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex-1 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowClassificationOverridesModal(true)}
                  disabled={isSaving}
                  className="w-full whitespace-nowrap"
                >
                  Set overrides
                </Button>
              </div>
            </div>
          </div>

          {/* Species Filtering (DeepFaune only, SpeciesNet uses taxonomy mapping) */}
          {!isSpeciesNet && (
            <>
              <div className="border-t my-6" />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">
                    Species filtering
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Only selected species will be classified when new images are uploaded. Already classified images are not affected. Leave empty to include all species.
                  </p>
                </div>
                <div className="flex-1">
                  <MultiSelect
                    options={speciesOptions}
                    value={includedSpecies}
                    onChange={setIncludedSpecies}
                    placeholder="Select species..."
                  />
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="border-t my-6" />

          {/* Privacy blur */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            <div className="w-full sm:w-1/2 sm:shrink-0">
              <label className="text-sm font-medium block">
                Blur people and vehicles
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically blur detected people and vehicles in all images for privacy. This is a visual change only and does not affect statistics or exports.
              </p>
            </div>
            <div className="flex-1">
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
          </div>

          {/* Divider */}
          <div className="border-t my-6" />

          {/* Independence Interval */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
            <div className="w-full sm:w-1/2 sm:shrink-0">
              <label className="text-sm font-medium block">
                Independence interval
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Consecutive detections of the same species at the same camera within this window are merged into one independent event. The count for each event is based on MaxN, the peak number of individuals visible in a single image within that event. This prevents double-counting across frames. Affects all statistics retroactively.
              </p>
            </div>
            <div className="flex-1 relative">
              <select
                value={independenceInterval}
                onChange={(e) => setIndependenceInterval(parseInt(e.target.value, 10))}
                disabled={isSaving}
                className="w-full h-10 rounded-md border border-input bg-background px-3 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {INDEPENDENCE_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Camera groups (only when independence interval is enabled) */}
          {independenceInterval > 0 && (
            <>
              <div className="border-t my-6" />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">
                    Camera groups
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Cameras in a group are treated as one location for the independence interval, preventing double counts from overlapping views or both ends of a wildlife crossing.
                  </p>
                </div>
                <div className="flex-1 flex items-center gap-3">
                  <div className="flex-[2]">
                    <span className="text-sm text-muted-foreground">
                      {pendingGroups.length > 0
                        ? `${pendingGroups.length} group${pendingGroups.length !== 1 ? 's' : ''}, ${pendingGroups.reduce((sum, g) => sum + g.camera_ids.length, 0)} cameras grouped`
                        : 'No groups configured'}
                    </span>
                  </div>
                  <div className="flex-1 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCameraGroups(true)}
                      disabled={isSaving}
                      className="w-full whitespace-nowrap"
                    >
                      Manage groups
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="mt-6 pt-4 border-t flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestoreDefaults}
                disabled={isSaving}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Restore defaults
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetUnsaved}
                disabled={isSaving || !hasUnsavedChanges}
              >
                <Undo2 className="h-4 w-4 mr-2" />
                Reset changes
              </Button>
            </div>
            <Button
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
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
            {modalData && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => { setShowChangesModal(true); setShowToast(false); setShowThresholdBreakdown(false); setShowIndependenceBreakdown(false); }}
                  className="text-[#0f6064] hover:underline font-medium"
                >
                  See effect
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

      {/* Camera groups modal */}
      <CameraGroupsModal
        groups={pendingGroups}
        cameras={cameras}
        open={showCameraGroups}
        onOpenChange={setShowCameraGroups}
        onGroupsChange={setPendingGroups}
      />

      {/* Per-species classification thresholds modal */}
      <ClassificationThresholdsModal
        open={showClassificationOverridesModal}
        onClose={() => setShowClassificationOverridesModal(false)}
        defaultThreshold={classificationDefault}
        overrides={classificationOverrides}
        onChange={setClassificationOverrides}
      />

      {/* Effect on statistics modal */}
      <Dialog open={showChangesModal} onOpenChange={setShowChangesModal}>
        <DialogContent onClose={() => setShowChangesModal(false)}>
          <DialogHeader>
            <DialogTitle>Effect on statistics</DialogTitle>
          </DialogHeader>

          {modalData && (
            <div className="space-y-3">

              {/* Detections card */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-sm font-medium">Detections</p>
                  <p className="text-xs text-muted-foreground">All detections above confidence threshold</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.observations.before.total.toLocaleString()}</code>
                    {' '}&rarr;{' '}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.observations.after.total.toLocaleString()}</code>
                  </p>
                  {(() => {
                    const oldMap = new Map(modalData.observations.before.species.map(s => [s.species, s.count]));
                    const newMap = new Map(modalData.observations.after.species.map(s => [s.species, s.count]));
                    const allSpecies = [...new Set([...oldMap.keys(), ...newMap.keys()])];
                    const changed = allSpecies.filter(s => (oldMap.get(s) ?? 0) !== (newMap.get(s) ?? 0));
                    changed.sort((a, b) => (newMap.get(b) ?? 0) - (newMap.get(a) ?? 0));
                    const unchangedCount = allSpecies.length - changed.length;
                    if (changed.length === 0) return null;
                    return (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowThresholdBreakdown(!showThresholdBreakdown)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                        >
                          {showThresholdBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {showThresholdBreakdown ? 'Hide' : 'Show'} breakdown ({changed.length} species changed)
                        </button>
                        {showThresholdBreakdown && (
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {changed.map((species) => {
                              const oldCount = oldMap.get(species) ?? 0;
                              const newCount = newMap.get(species) ?? 0;
                              return (
                                <div key={species} className="flex justify-between items-center text-xs text-muted-foreground">
                                  <span>{normalizeLabel(species)}</span>
                                  <span className="tabular-nums">
                                    <code className="bg-muted px-1 py-0.5 rounded">{oldCount.toLocaleString()}</code> &rarr; <code className="bg-muted px-1 py-0.5 rounded">{newCount.toLocaleString()}</code>
                                  </span>
                                </div>
                              );
                            })}
                            {unchangedCount > 0 && (
                              <p className="text-xs text-muted-foreground italic pt-1">
                                {unchangedCount} other species unchanged
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Independent observations card */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-sm font-medium">Independent observations</p>
                  <p className="text-xs text-muted-foreground">Maximum individuals per event, summed across events</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.events.before.independent_total.toLocaleString()}</code>
                    {' '}&rarr;{' '}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.events.after.independent_total.toLocaleString()}</code>
                  </p>
                  {(() => {
                    const oldMap = new Map(modalData.events.before.species.map(s => [s.species, s.independent_count]));
                    const newMap = new Map(modalData.events.after.species.map(s => [s.species, s.independent_count]));
                    const allSpecies = [...new Set([...oldMap.keys(), ...newMap.keys()])];
                    const changed = allSpecies.filter(s => (oldMap.get(s) ?? 0) !== (newMap.get(s) ?? 0));
                    changed.sort((a, b) => (newMap.get(b) ?? 0) - (newMap.get(a) ?? 0));
                    const unchangedCount = allSpecies.length - changed.length;
                    if (changed.length === 0) return null;
                    return (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowIndependenceBreakdown(!showIndependenceBreakdown)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                        >
                          {showIndependenceBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {showIndependenceBreakdown ? 'Hide' : 'Show'} breakdown ({changed.length} species changed)
                        </button>
                        {showIndependenceBreakdown && (
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {changed.map((species) => {
                              const oldCount = oldMap.get(species) ?? 0;
                              const newCount = newMap.get(species) ?? 0;
                              return (
                                <div key={species} className="flex justify-between items-center text-xs text-muted-foreground">
                                  <span>{normalizeLabel(species)}</span>
                                  <span className="tabular-nums">
                                    <code className="bg-muted px-1 py-0.5 rounded">{oldCount.toLocaleString()}</code> &rarr; <code className="bg-muted px-1 py-0.5 rounded">{newCount.toLocaleString()}</code>
                                  </span>
                                </div>
                              );
                            })}
                            {unchangedCount > 0 && (
                              <p className="text-xs text-muted-foreground italic pt-1">
                                {unchangedCount} other species unchanged
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Independent events card */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-sm font-medium">Independent events</p>
                  <p className="text-xs text-muted-foreground">Distinct events after independence grouping</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.events.before.independent_event_total.toLocaleString()}</code>
                    {' '}&rarr;{' '}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{modalData.events.after.independent_event_total.toLocaleString()}</code>
                  </p>
                  {(() => {
                    const oldMap = new Map(modalData.events.before.species.map(s => [s.species, s.independent_event_count]));
                    const newMap = new Map(modalData.events.after.species.map(s => [s.species, s.independent_event_count]));
                    const allSpecies = [...new Set([...oldMap.keys(), ...newMap.keys()])];
                    const changed = allSpecies.filter(s => (oldMap.get(s) ?? 0) !== (newMap.get(s) ?? 0));
                    changed.sort((a, b) => (newMap.get(b) ?? 0) - (newMap.get(a) ?? 0));
                    const unchangedCount = allSpecies.length - changed.length;
                    if (changed.length === 0) return null;
                    return (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowEventBreakdown(!showEventBreakdown)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                        >
                          {showEventBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {showEventBreakdown ? 'Hide' : 'Show'} breakdown ({changed.length} species changed)
                        </button>
                        {showEventBreakdown && (
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {changed.map((species) => {
                              const oldCount = oldMap.get(species) ?? 0;
                              const newCount = newMap.get(species) ?? 0;
                              return (
                                <div key={species} className="flex justify-between items-center text-xs text-muted-foreground">
                                  <span>{normalizeLabel(species)}</span>
                                  <span className="tabular-nums">
                                    <code className="bg-muted px-1 py-0.5 rounded">{oldCount.toLocaleString()}</code> &rarr; <code className="bg-muted px-1 py-0.5 rounded">{newCount.toLocaleString()}</code>
                                  </span>
                                </div>
                              );
                            })}
                            {unchangedCount > 0 && (
                              <p className="text-xs text-muted-foreground italic pt-1">
                                {unchangedCount} other species unchanged
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
