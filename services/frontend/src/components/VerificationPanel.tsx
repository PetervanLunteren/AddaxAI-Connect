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
import { Plus, Minus, X, Loader2, Check } from 'lucide-react';
import { Button } from './ui/Button';
import { Card, CardContent } from './ui/Card';
import { CreatableSpeciesSelect, Option } from './ui/CreatableSelect';
import { imagesApi } from '../api/images';
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
  count: number;
  isAiSuggested: boolean;  // Track if this row is from AI and not yet modified
}

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
}

export const VerificationPanel = forwardRef<VerificationPanelRef, VerificationPanelProps>(({
  imageUuid,
  imageDetail,
  onVerificationSaved,
  highlightedSpecies,
}, ref) => {
  const queryClient = useQueryClient();

  // Local state for form
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(!imageDetail.verification.is_verified);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  // Fetch species list for dropdown
  const { data: speciesOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species'],
    queryFn: () => imagesApi.getSpecies(),
  });

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
          count: obs.count,
          isAiSuggested: false,  // Human-verified data
        }));
        setObservations(existingObs);
      } else {
        // Pre-populate from AI predictions
        const aiObs = aiPredictions.map((pred, idx) => ({
          id: `ai-${idx}`,
          species: { label: normalizeLabel(pred.species), value: pred.species },
          count: pred.count,
          isAiSuggested: true,  // AI suggestion, not yet confirmed
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
        }));

      return imagesApi.saveVerification(imageUuid, {
        is_verified: true,
        notes: notes || null,
        observations: validObservations,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
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
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
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
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
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
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
    },
  });

  // Expose methods for parent components
  useImperativeHandle(ref, () => ({
    save: (onComplete?: () => void) => {
      console.log('[VerificationPanel.save] called, canSave:', canSave, 'isPending:', saveMutation.isPending);
      if (canSave && !saveMutation.isPending) {
        console.log('[VerificationPanel.save] calling mutate');
        saveMutation.mutate(undefined, { onSuccess: () => {
          console.log('[VerificationPanel.save] mutation onSuccess, calling onComplete:', !!onComplete);
          if (onComplete) onComplete();
        }});
      } else {
        // Nothing to save (or already saving), but still proceed with callback
        console.log('[VerificationPanel.save] skipped mutation, calling onComplete directly');
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
        noAnimalsMutation.mutate(undefined, { onSuccess: onComplete });
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
  }));

  // Add new observation row
  const addObservation = () => {
    setObservations(prev => [
      ...prev,
      { id: `new-${Date.now()}`, species: null, count: 1, isAiSuggested: false },
    ]);
  };

  // Remove observation row
  const removeObservation = (id: string) => {
    setObservations(prev => prev.filter(obs => obs.id !== id));
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

  // Build species options for dropdown
  const allSpeciesOptions = React.useMemo(() => {
    const options = speciesOptions?.map(s => ({
      label: s.label,
      value: s.value,
    })) || [];

    // Add Person and Vehicle as standard options
    if (!options.find(o => o.value === 'person')) {
      options.push({ label: 'Person', value: 'person' });
    }
    if (!options.find(o => o.value === 'vehicle')) {
      options.push({ label: 'Vehicle', value: 'vehicle' });
    }

    // Add any detected species not in the list
    aiPredictions.forEach(pred => {
      if (!options.find(o => o.value === pred.species)) {
        options.push({
          label: normalizeLabel(pred.species),
          value: pred.species,
        });
      }
    });

    return options;
  }, [speciesOptions, aiPredictions]);

  // Check if save button should be enabled
  const canSave = React.useMemo(() => {
    // Always allow saving if not yet verified
    if (!imageDetail.verification.is_verified) {
      return true;
    }

    // If already verified, only enable if there are changes
    const currentObs = observations
      .filter(obs => obs.species !== null)
      .map(obs => `${obs.species!.value}:${obs.count}`)
      .sort()
      .join(',');

    const savedObs = imageDetail.human_observations
      .map(obs => `${obs.species}:${obs.count}`)
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
                    className="flex justify-between items-center py-1.5 px-2 rounded"
                    style={{ backgroundColor: 'rgba(15, 96, 100, 0.1)' }}
                  >
                    <span className="text-sm">{normalizeLabel(obs.species)}</span>
                    <span className="text-sm text-muted-foreground">× {obs.count}</span>
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
                flex items-center gap-2 p-2 rounded-md transition-all duration-300
                border border-input bg-background
                ${index === focusedIndex || highlightedRowId === obs.id ? 'ring-2 ring-primary ring-offset-1' : ''}
              `}
            >
              {/* Species select */}
              <div className="flex-1 min-w-0">
                <CreatableSpeciesSelect
                  options={allSpeciesOptions}
                  value={obs.species}
                  onChange={(selected) => updateSpecies(obs.id, selected)}
                  placeholder="Select species..."
                  isLoading={speciesLoading}
                />
              </div>

              {/* Count controls: - [count] + */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => decrementCount(obs.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Decrease count"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min="1"
                  value={obs.count}
                  onChange={(e) => updateCount(obs.id, parseInt(e.target.value) || 1)}
                  className="w-10 h-8 px-1 text-center border-0 bg-transparent text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary rounded [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => incrementCount(obs.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Increase count"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => removeObservation(obs.id)}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                title="Remove species"
              >
                <X className="h-4 w-4" />
              </button>
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
