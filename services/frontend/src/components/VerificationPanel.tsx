/**
 * VerificationPanel component for human verification of species observations
 * Unified editable list pre-populated from AI predictions
 *
 * UX optimizations:
 * - Click species name or +/- buttons to adjust counts
 * - Keyboard shortcut "0" for empty verification (no animals)
 * - Tab/Shift+Tab to cycle focus between observations
 * - Up/Down arrows to adjust count of focused observation
 */
import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Minus, X, Loader2, Check, Copy } from 'lucide-react';
import { Button } from './ui/Button';
import { Card, CardContent } from './ui/Card';
import { CreatableSpeciesSelect, Option } from './ui/CreatableSelect';
import { imagesApi } from '../api/images';
import { speciesApi } from '../api/species';
import { useProject } from '../contexts/ProjectContext';
import { normalizeLabel } from '../utils/labels';
import type { ImageDetail, HumanObservationInput } from '../api/types';

interface VerificationPanelProps {
  imageUuid: string;
  imageDetail: ImageDetail;
  onVerificationSaved?: () => void;
  highlightedSpecies?: string | null;
}

interface ObservationRow {
  id: string;
  species: Option | null;
  sex: string;
  life_stage: string;
  behavior: string;
  count: number;
  isAiSuggested: boolean;  // Track if this row is from AI and not yet modified
}

const SEX_OPTIONS = ['unknown', 'male', 'female'] as const;
const LIFE_STAGE_OPTIONS = ['unknown', 'adult', 'subadult', 'juvenile'] as const;
const BEHAVIOR_OPTIONS = [
  'unknown', 'traveling', 'foraging', 'resting', 'vigilance',
  'drinking', 'grooming', 'courtship', 'nursing', 'aggression', 'marking',
] as const;

// Expose methods for parent components (keyboard shortcuts, bbox linking, notes)
export interface VerificationPanelRef {
  save: (onComplete?: () => void) => void;
  saveNotes: () => void;
  noAnimals: (onComplete?: () => void) => void;
  highlightSpecies: (species: string) => void;
  getNotes: () => string;
  setNotes: (notes: string) => void;
  focusNext: () => void;
  focusPrevious: () => void;
  incrementFocused: () => void;
  decrementFocused: () => void;
  deleteFocused: () => void;
}

export const VerificationPanel = forwardRef<VerificationPanelRef, VerificationPanelProps>(({
  imageUuid,
  imageDetail,
  onVerificationSaved,
  highlightedSpecies,
}, ref) => {
  const queryClient = useQueryClient();
  const { selectedProject } = useProject();

  // Invalidate every cache that depends on this image's verification state.
  // Called from all four save/verify/unverify/notes mutations so the grid
  // chips, the species dropdown, and the dashboard all refresh together.
  const invalidateAfterVerification = () => {
    queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
    queryClient.invalidateQueries({ queryKey: ['images'] });
    queryClient.invalidateQueries({ queryKey: ['species'] });
    queryClient.invalidateQueries({ queryKey: ['statistics'] });
  };

  // Local state for form
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(!imageDetail.verification.is_verified);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  // Source 1: historical species observed in this project's database, so a
  // label like "bear" stays pickable even if it has been removed from the
  // project's allowed list since some images were recorded.
  const projectId = selectedProject?.id;
  const { data: observedSpecies, isLoading: observedLoading } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Source 2: global model catalog. Only fetched as a fallback for projects
  // whose included_species is null/empty (which means "all species allowed").
  const includedSpecies = selectedProject?.included_species ?? null;
  const needsGlobalCatalog = !includedSpecies || includedSpecies.length === 0;
  const { data: globalCatalog, isLoading: globalLoading } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
    enabled: needsGlobalCatalog,
  });

  const speciesLoading = observedLoading || globalLoading;

  // Aggregate AI predictions by species (including person/vehicle)
  const aiPredictions = React.useMemo(() => {
    const speciesMap: Record<string, { count: number; maxConfidence: number }> = {};

    imageDetail.detections.forEach(detection => {
      // Count person and vehicle detections directly
      if (detection.category === 'person' || detection.category === 'vehicle') {
        const key = detection.category;
        if (!speciesMap[key]) {
          speciesMap[key] = { count: 0, maxConfidence: 0 };
        }
        speciesMap[key].count += 1;
        speciesMap[key].maxConfidence = Math.max(
          speciesMap[key].maxConfidence,
          detection.confidence
        );
      }

      // Count animal species from classifications
      detection.classifications.forEach(cls => {
        if (!speciesMap[cls.species]) {
          speciesMap[cls.species] = { count: 0, maxConfidence: 0 };
        }
        speciesMap[cls.species].count += 1;
        speciesMap[cls.species].maxConfidence = Math.max(
          speciesMap[cls.species].maxConfidence,
          cls.confidence
        );
      });
    });

    return Object.entries(speciesMap).map(([species, data]) => ({
      species,
      count: data.count,
      confidence: data.maxConfidence,
    }));
  }, [imageDetail.detections]);

  // Initialize form from imageDetail or AI predictions
  useEffect(() => {
    if (imageDetail) {
      if (imageDetail.human_observations.length > 0) {
        // Use existing human observations (already verified)
        const existingObs = imageDetail.human_observations.map((obs) => ({
          id: `existing-${obs.id}`,
          species: { label: normalizeLabel(obs.species), value: obs.species },
          sex: obs.sex || 'unknown',
          life_stage: obs.life_stage || 'unknown',
          behavior: obs.behavior || 'unknown',
          count: obs.count,
          isAiSuggested: false,
        }));
        setObservations(existingObs);
      } else {
        // Pre-populate from AI predictions (AI doesn't predict sex/life_stage)
        const aiObs = aiPredictions.map((pred, idx) => ({
          id: `ai-${idx}`,
          species: { label: normalizeLabel(pred.species), value: pred.species },
          sex: 'unknown',
          life_stage: 'unknown',
          behavior: 'unknown',
          count: pred.count,
          isAiSuggested: true,
        }));
        setObservations(aiObs);
      }
      setNotes(imageDetail.verification.notes || '');
    }
  }, [imageDetail, aiPredictions]);

  // Reset editing state and focus when image changes
  useEffect(() => {
    setIsEditing(!imageDetail.verification.is_verified);
    setFocusedIndex(0);
  }, [imageDetail.uuid]);

  // Handle highlighting from bbox clicks
  useEffect(() => {
    if (highlightedSpecies) {
      const row = observations.find(obs => obs.species?.value === highlightedSpecies);
      if (row) {
        setHighlightedRowId(row.id);
        // Clear highlight after animation
        setTimeout(() => setHighlightedRowId(null), 1500);
      }
    }
  }, [highlightedSpecies, observations]);

  // Save mutation - always marks as verified
  const saveMutation = useMutation({
    mutationFn: () => {
      const validObservations: HumanObservationInput[] = observations
        .filter(obs => obs.species !== null && obs.count > 0)
        .map(obs => ({
          species: obs.species!.value,
          count: obs.count,
          sex: obs.sex,
          life_stage: obs.life_stage,
          behavior: obs.behavior,
        }));

      return imagesApi.saveVerification(imageUuid, {
        is_verified: true,
        notes: notes || null,
        observations: validObservations,
      });
    },
    onSuccess: () => {
      invalidateAfterVerification();
      setError(null);
      setIsEditing(false);
      onVerificationSaved?.();
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || err.message || 'Failed to save verification');
    },
  });

  // "No animals" mutation - one-click save as empty
  const noAnimalsMutation = useMutation({
    mutationFn: () => {
      return imagesApi.saveVerification(imageUuid, {
        is_verified: true,
        notes: notes || null,
        observations: [],
      });
    },
    onSuccess: () => {
      invalidateAfterVerification();
      setObservations([]);
      setError(null);
      setIsEditing(false);
      onVerificationSaved?.();
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || err.message || 'Failed to save');
    },
  });

  // "Unverify" mutation - called when clicking Edit on verified image
  const unverifyMutation = useMutation({
    mutationFn: () => {
      const currentObservations: HumanObservationInput[] = imageDetail.human_observations.map(obs => ({
        species: obs.species,
        count: obs.count,
      }));

      return imagesApi.saveVerification(imageUuid, {
        is_verified: false,
        notes: imageDetail.verification.notes || null,
        observations: currentObservations,
      });
    },
    onSuccess: () => {
      invalidateAfterVerification();
    },
  });

  // Save notes mutation - preserves current verification state
  const saveNotesMutation = useMutation({
    mutationFn: () => {
      const currentObservations: HumanObservationInput[] = imageDetail.human_observations.map(obs => ({
        species: obs.species,
        count: obs.count,
      }));

      return imagesApi.saveVerification(imageUuid, {
        is_verified: imageDetail.verification.is_verified,
        notes: notes || null,
        observations: currentObservations,
      });
    },
    onSuccess: () => {
      invalidateAfterVerification();
    },
  });

  // Expose methods for parent components
  useImperativeHandle(ref, () => ({
    save: (onComplete?: () => void) => {
      if (canSave && !saveMutation.isPending) {
        saveMutation.mutate(undefined, {
          onSuccess: () => {
            if (onComplete) onComplete();
          },
          onError: () => {
            // Still proceed to next on error to avoid getting stuck
            if (onComplete) onComplete();
          }
        });
      } else {
        // Nothing to save (or already saving), but still proceed with callback
        if (onComplete) onComplete();
      }
    },
    saveNotes: () => {
      if (!saveNotesMutation.isPending) {
        saveNotesMutation.mutate();
      }
    },
    noAnimals: (onComplete?: () => void) => {
      if (!noAnimalsMutation.isPending) {
        noAnimalsMutation.mutate(undefined, {
          onSuccess: () => {
            if (onComplete) onComplete();
          },
          onError: () => {
            // Still proceed to next on error to avoid getting stuck
            if (onComplete) onComplete();
          }
        });
      } else {
        // Already saving, still proceed with callback
        if (onComplete) onComplete();
      }
    },
    highlightSpecies: (species: string) => {
      const row = observations.find(obs => obs.species?.value === species);
      if (row) {
        setHighlightedRowId(row.id);
        setTimeout(() => setHighlightedRowId(null), 1500);
      }
    },
    getNotes: () => notes,
    setNotes: (newNotes: string) => setNotes(newNotes),
    focusNext: () => {
      if (observations.length > 0) {
        setFocusedIndex(prev => (prev + 1) % observations.length);
      }
    },
    focusPrevious: () => {
      if (observations.length > 0) {
        setFocusedIndex(prev => (prev - 1 + observations.length) % observations.length);
      }
    },
    incrementFocused: () => {
      if (observations.length > 0 && focusedIndex < observations.length) {
        incrementCount(observations[focusedIndex].id);
      }
    },
    decrementFocused: () => {
      if (observations.length > 0 && focusedIndex < observations.length) {
        decrementCount(observations[focusedIndex].id);
      }
    },
    deleteFocused: () => {
      if (observations.length > 0 && focusedIndex < observations.length) {
        const idToRemove = observations[focusedIndex].id;
        removeObservation(idToRemove);
        // Adjust focus index if needed
        if (focusedIndex >= observations.length - 1 && focusedIndex > 0) {
          setFocusedIndex(focusedIndex - 1);
        }
      }
    },
  }));

  // Add new observation row
  const addObservation = () => {
    setObservations(prev => [
      ...prev,
      { id: `new-${Date.now()}`, species: null, sex: 'unknown', life_stage: 'unknown', behavior: 'unknown', count: 1, isAiSuggested: false },
    ]);
  };

  // Remove observation row
  const removeObservation = (id: string) => {
    setObservations(prev => prev.filter(obs => obs.id !== id));
  };

  // Split an observation into two rows with the same species. The
  // original keeps most of the count; the copy gets 1. The user then
  // adjusts sex/life_stage/count on each row.
  const splitObservation = (id: string) => {
    setObservations(prev => {
      const idx = prev.findIndex(obs => obs.id === id);
      if (idx === -1) return prev;
      const original = prev[idx];
      const newCount = Math.max(1, original.count - 1);
      const copy: ObservationRow = {
        id: `split-${Date.now()}`,
        species: original.species ? { ...original.species } : null,
        sex: 'unknown',
        life_stage: 'unknown',
        behavior: 'unknown',
        count: 1,
        isAiSuggested: false,
      };
      const updated = [...prev];
      updated[idx] = { ...original, count: newCount, isAiSuggested: false };
      updated.splice(idx + 1, 0, copy);
      return updated;
    });
  };

  // Update observation species (marks as human-modified)
  const updateSpecies = (id: string, species: Option | null) => {
    setObservations(prev =>
      prev.map(obs => (obs.id === id ? { ...obs, species, isAiSuggested: false } : obs))
    );
  };

  // Increment count (marks as human-modified)
  const incrementCount = (id: string) => {
    setObservations(prev =>
      prev.map(obs => (obs.id === id ? { ...obs, count: obs.count + 1, isAiSuggested: false } : obs))
    );
  };

  // Decrement count (marks as human-modified, min 1)
  const decrementCount = (id: string) => {
    setObservations(prev =>
      prev.map(obs => (obs.id === id ? { ...obs, count: Math.max(1, obs.count - 1), isAiSuggested: false } : obs))
    );
  };

  // Direct count update (marks as human-modified)
  const updateCount = (id: string, count: number) => {
    setObservations(prev =>
      prev.map(obs => (obs.id === id ? { ...obs, count: Math.max(1, count), isAiSuggested: false } : obs))
    );
  };

  // Build species options for the dropdown as a union of three sources:
  // 1) the project's allowed list (or the global model catalog when the
  //    allowed list is null/empty, which semantically means "all allowed"),
  // 2) every species ever recorded in this project's DB, so old labels
  //    that have since been removed from the whitelist stay pickable, and
  // 3) any species the AI predicted on the current image, as a safety net.
  // Person and Vehicle are always included since they are valid annotation
  // targets even though they aren't species.
  const allSpeciesOptions = React.useMemo(() => {
    const byValue = new Map<string, Option>();

    const add = (value: string, label?: string) => {
      if (!byValue.has(value)) {
        byValue.set(value, { value, label: label ?? normalizeLabel(value) });
      }
    };

    if (includedSpecies && includedSpecies.length > 0) {
      includedSpecies.forEach(s => add(s));
    } else if (globalCatalog) {
      globalCatalog.species.forEach(s => add(s));
    }

    observedSpecies?.forEach(s => add(s.value, s.label));

    aiPredictions.forEach(pred => add(pred.species));

    add('person', 'Person');
    add('vehicle', 'Vehicle');

    return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [includedSpecies, globalCatalog, observedSpecies, aiPredictions]);

  // Check if save button should be enabled
  const canSave = React.useMemo(() => {
    // Always allow saving if not yet verified
    if (!imageDetail.verification.is_verified) {
      return true;
    }

    // If already verified, only enable if there are changes
    const currentObs = observations
      .filter(obs => obs.species !== null)
      .map(obs => `${obs.species!.value}:${obs.count}:${obs.sex}:${obs.life_stage}:${obs.behavior}`)
      .sort()
      .join(',');

    const savedObs = imageDetail.human_observations
      .map(obs => `${obs.species}:${obs.count}:${obs.sex || 'unknown'}:${obs.life_stage || 'unknown'}:${obs.behavior || 'unknown'}`)
      .sort()
      .join(',');

    return (
      currentObs !== savedObs ||
      notes !== (imageDetail.verification.notes || '')
    );
  }, [observations, notes, imageDetail]);

  const isSaving = saveMutation.isPending || noAnimalsMutation.isPending;

  // Read-only view for verified images
  if (imageDetail.verification.is_verified && !isEditing) {
    return (
      <div className="relative">
        {/* Verified badge */}
        <div
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center z-10"
          style={{ backgroundColor: '#0f6064' }}
          title="Verified"
        >
          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        </div>

        <Card>
          <CardContent className="pt-4 pb-3">
            {/* Species list - read only */}
            <div className="space-y-2">
              {imageDetail.human_observations.length === 0 ? (
                <div className="flex justify-center items-center py-1.5 px-2">
                  <span className="text-sm text-muted-foreground">Empty</span>
                </div>
              ) : (
                imageDetail.human_observations.map((obs) => (
                  <div
                    key={obs.id}
                    className="py-1.5 px-2 rounded"
                    style={{ backgroundColor: 'rgba(15, 96, 100, 0.1)' }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-sm">{normalizeLabel(obs.species)}</span>
                      <span className="text-sm text-muted-foreground">× {obs.count}</span>
                    </div>
                    {(obs.sex !== 'unknown' || obs.life_stage !== 'unknown' || obs.behavior !== 'unknown') && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {[
                          obs.sex !== 'unknown' ? obs.sex.charAt(0).toUpperCase() + obs.sex.slice(1) : null,
                          obs.life_stage !== 'unknown' ? obs.life_stage.charAt(0).toUpperCase() + obs.life_stage.slice(1) : null,
                          obs.behavior !== 'unknown' ? obs.behavior.charAt(0).toUpperCase() + obs.behavior.slice(1) : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Verified status */}
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Verified by {imageDetail.verification.verified_by_email}
            </p>

            {/* Edit button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                unverifyMutation.mutate();
                setIsEditing(true);
              }}
              disabled={unverifyMutation.isPending}
              className="w-full mt-3"
            >
              {unverifyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                'Edit'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Editable view for unverified images or when editing
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="space-y-2">
          {observations.length === 0 && (
            <div className="flex items-center justify-center p-2 rounded-md border border-input bg-background">
              <span className="text-sm text-muted-foreground h-9 flex items-center">No detections</span>
            </div>
          )}
          {observations.map((obs, index) => (
            <div
              key={obs.id}
              className={`
                p-2 rounded-md space-y-2 transition-all duration-300
                border border-input bg-background
                ${index === focusedIndex || highlightedRowId === obs.id ? 'ring-2 ring-primary ring-offset-1' : ''}
              `}
            >
              {/* Row 1: action buttons right-aligned */}
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => splitObservation(obs.id)}
                  className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Split into two rows"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeObservation(obs.id)}
                  className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Row 2: species + count */}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <CreatableSpeciesSelect
                    options={allSpeciesOptions}
                    value={obs.species}
                    onChange={(selected) => updateSpecies(obs.id, selected)}
                    placeholder="Select or type..."
                    isLoading={speciesLoading}
                  />
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => decrementCount(obs.id)}
                    className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Decrease count"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={obs.count}
                    onChange={(e) => updateCount(obs.id, parseInt(e.target.value) || 1)}
                    className="w-8 h-7 px-0.5 text-center border-0 bg-transparent text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary rounded [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => incrementCount(obs.id)}
                    className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Increase count"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Row 3: sex, age, behaviour */}
              <div className="flex items-center gap-1 overflow-hidden">
                <select
                  value={obs.sex}
                  onChange={(e) => setObservations(prev =>
                    prev.map(o => o.id === obs.id ? { ...o, sex: e.target.value, isAiSuggested: false } : o)
                  )}
                  className="h-7 px-1.5 text-xs border border-input rounded bg-background text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-ring min-w-0 shrink"
                  title="Sex"
                >
                  {SEX_OPTIONS.map(v => (
                    <option key={v} value={v}>
                      {v === 'unknown' ? 'Sex: unknown' : v.charAt(0).toUpperCase() + v.slice(1)}
                    </option>
                  ))}
                </select>
                <select
                  value={obs.life_stage}
                  onChange={(e) => setObservations(prev =>
                    prev.map(o => o.id === obs.id ? { ...o, life_stage: e.target.value, isAiSuggested: false } : o)
                  )}
                  className="h-7 px-1.5 text-xs border border-input rounded bg-background text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-ring min-w-0 shrink"
                  title="Life stage"
                >
                  {LIFE_STAGE_OPTIONS.map(v => (
                    <option key={v} value={v}>
                      {v === 'unknown' ? 'Age: unknown' : v.charAt(0).toUpperCase() + v.slice(1)}
                    </option>
                  ))}
                </select>
                <select
                  value={obs.behavior}
                  onChange={(e) => setObservations(prev =>
                    prev.map(o => o.id === obs.id ? { ...o, behavior: e.target.value, isAiSuggested: false } : o)
                  )}
                  className="h-7 px-1.5 text-xs border border-input rounded bg-background text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-ring min-w-0 shrink"
                  title="Behaviour"
                >
                  {BEHAVIOR_OPTIONS.map(v => (
                    <option key={v} value={v}>
                      {v === 'unknown' ? 'Behaviour: unknown' : v.charAt(0).toUpperCase() + v.slice(1)}
                  </option>
                ))}
                </select>
              </div>
            </div>
          ))}

          <Button
            variant="ghost"
            size="sm"
            onClick={addObservation}
            className="w-full mt-2"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add observation
          </Button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-3 p-2 bg-destructive/10 text-destructive text-sm rounded-md">
            {error}
          </div>
        )}

        {/* Save button */}
        <Button
          className="w-full mt-4"
          onClick={() => saveMutation.mutate()}
          disabled={isSaving || !canSave}
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Verify
            </>
          )}
        </Button>

        {/* Status message */}
        <p className="text-sm text-muted-foreground mt-3 text-center">
          {imageDetail.verification.is_verified
            ? `Verified by ${imageDetail.verification.verified_by_email}`
            : 'Not verified yet'}
        </p>
      </CardContent>
    </Card>
  );
});

VerificationPanel.displayName = 'VerificationPanel';
