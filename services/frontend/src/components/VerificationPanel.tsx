/**
 * VerificationPanel component for human verification of species observations
 * Unified editable list pre-populated from AI predictions
 *
 * UX optimizations:
 * - "No animals" one-click save for empty images
 * - Click species name or +/- buttons to adjust counts
 * - Visual distinction between AI suggestions and human-confirmed rows
 */
import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Minus, X, Loader2, Check, Ban } from 'lucide-react';
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
  save: () => void;
  highlightSpecies: (species: string) => void;
  getNotes: () => string;
  setNotes: (notes: string) => void;
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

  // Reset editing state when image changes
  useEffect(() => {
    setIsEditing(!imageDetail.verification.is_verified);
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
      onVerificationSaved?.();
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || err.message || 'Failed to save');
    },
  });

  // Expose methods for parent components
  useImperativeHandle(ref, () => ({
    save: () => {
      if (canSave && !saveMutation.isPending) {
        saveMutation.mutate();
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
      <Card>
        <CardContent className="pt-4 pb-3">
          {/* Species list - read only */}
          <div className="space-y-2">
            {imageDetail.human_observations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">No animals</p>
            ) : (
              imageDetail.human_observations.map((obs) => (
                <div key={obs.id} className="flex justify-between items-center py-1.5 px-2 rounded bg-muted/30">
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
            onClick={() => setIsEditing(true)}
            className="w-full mt-3"
          >
            Edit
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Editable view for unverified images or when editing
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        {/* "No animals" button - one-click save for empty images */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => noAnimalsMutation.mutate()}
          disabled={isSaving}
          className="w-full mb-3 text-muted-foreground"
        >
          {noAnimalsMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Ban className="h-4 w-4 mr-2" />
          )}
          No animals
        </Button>

        <div className="space-y-2">
          {observations.map(obs => (
            <div
              key={obs.id}
              className={`
                flex items-center gap-2 p-2 rounded-md transition-all duration-300
                border border-input bg-background
                ${highlightedRowId === obs.id ? 'ring-2 ring-primary ring-offset-1' : ''}
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
                  className="w-10 h-8 px-1 text-center border-0 bg-transparent text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary rounded"
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
            variant="outline"
            size="sm"
            onClick={addObservation}
            className="w-full mt-2"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add species
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
              Saving...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Save observations
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
