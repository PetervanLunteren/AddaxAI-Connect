/**
 * VerificationPanel component for human verification of species observations
 * Unified editable list pre-populated from AI predictions
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2, Check } from 'lucide-react';
import { Button } from './ui/Button';
import { Card, CardContent } from './ui/Card';
import { Checkbox } from './ui/Checkbox';
import { CreatableSpeciesSelect, Option } from './ui/CreatableSelect';
import { imagesApi } from '../api/images';
import { normalizeLabel } from '../utils/labels';
import type { ImageDetail, HumanObservationInput } from '../api/types';

interface VerificationPanelProps {
  imageUuid: string;
  imageDetail: ImageDetail;
  onVerificationSaved?: () => void;
}

interface ObservationRow {
  id: string; // Temporary ID for React key
  species: Option | null;
  count: number;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  imageUuid,
  imageDetail,
  onVerificationSaved,
}) => {
  const queryClient = useQueryClient();

  // Local state for form
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [notes, setNotes] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch species list for dropdown
  const { data: speciesOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species'],
    queryFn: () => imagesApi.getSpecies(),
  });

  // Aggregate AI predictions by species
  const aiPredictions = React.useMemo(() => {
    const speciesMap: Record<string, { count: number; maxConfidence: number }> = {};

    imageDetail.detections.forEach(detection => {
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
        // Use existing human observations
        const existingObs = imageDetail.human_observations.map((obs) => ({
          id: `existing-${obs.id}`,
          species: { label: normalizeLabel(obs.species), value: obs.species },
          count: obs.count,
        }));
        setObservations(existingObs);
      } else {
        // Pre-populate from AI predictions
        const aiObs = aiPredictions.map((pred, idx) => ({
          id: `ai-${idx}`,
          species: { label: normalizeLabel(pred.species), value: pred.species },
          count: pred.count,
        }));
        setObservations(aiObs);
      }
      setNotes(imageDetail.verification.notes || '');
      setIsVerified(imageDetail.verification.is_verified);
    }
  }, [imageDetail, aiPredictions]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => {
      const validObservations: HumanObservationInput[] = observations
        .filter(obs => obs.species !== null && obs.count > 0)
        .map(obs => ({
          species: obs.species!.value,
          count: obs.count,
        }));

      return imagesApi.saveVerification(imageUuid, {
        is_verified: isVerified,
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

  // Add new observation row
  const addObservation = () => {
    setObservations(prev => [
      ...prev,
      { id: `new-${Date.now()}`, species: null, count: 1 },
    ]);
  };

  // Remove observation row
  const removeObservation = (id: string) => {
    setObservations(prev => prev.filter(obs => obs.id !== id));
  };

  // Update observation species
  const updateSpecies = (id: string, species: Option | null) => {
    setObservations(prev =>
      prev.map(obs => (obs.id === id ? { ...obs, species } : obs))
    );
  };

  // Update observation count
  const updateCount = (id: string, count: number) => {
    setObservations(prev =>
      prev.map(obs => (obs.id === id ? { ...obs, count: Math.max(1, count) } : obs))
    );
  };

  // Build species options for dropdown (project species + detected species)
  const allSpeciesOptions = React.useMemo(() => {
    const options = speciesOptions?.map(s => ({
      label: s.label,
      value: s.value,
    })) || [];

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

  // Check if form has changes (compare against saved observations OR AI predictions)
  const hasChanges = React.useMemo(() => {
    const currentObs = observations
      .filter(obs => obs.species !== null)
      .map(obs => `${obs.species!.value}:${obs.count}`)
      .sort()
      .join(',');

    // Compare against saved human observations if they exist, otherwise compare against AI predictions
    const baselineObs = imageDetail.human_observations.length > 0
      ? imageDetail.human_observations
          .map(obs => `${obs.species}:${obs.count}`)
          .sort()
          .join(',')
      : aiPredictions
          .map(pred => `${pred.species}:${pred.count}`)
          .sort()
          .join(',');

    return (
      currentObs !== baselineObs ||
      notes !== (imageDetail.verification.notes || '') ||
      isVerified !== imageDetail.verification.is_verified
    );
  }, [observations, notes, isVerified, imageDetail, aiPredictions]);

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <span className="font-medium">Species observations</span>
        </div>

        <div className="space-y-2">
          {observations.map(obs => (
            <div key={obs.id} className="flex items-center gap-2">
              <div className="flex-1">
                <CreatableSpeciesSelect
                  options={allSpeciesOptions}
                  value={obs.species}
                  onChange={(selected) => updateSpecies(obs.id, selected)}
                  placeholder="Select species..."
                  isLoading={speciesLoading}
                />
              </div>
              <input
                type="number"
                min="1"
                value={obs.count}
                onChange={(e) => updateCount(obs.id, parseInt(e.target.value) || 1)}
                className="w-16 h-9 px-2 text-center border border-input rounded-md bg-background text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeObservation(obs.id)}
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
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

        {/* Notes */}
        <div className="mt-4">
          <label className="block text-sm text-muted-foreground mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            className="w-full h-16 px-3 py-2 text-sm border border-input rounded-md bg-background resize-none"
          />
        </div>

        {/* Verification checkbox */}
        <div className="mt-4 pt-3 border-t border-border">
          <Checkbox
            id="mark-verified"
            checked={isVerified}
            onChange={setIsVerified}
            label="Mark as verified"
          />
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
          disabled={saveMutation.isPending || !hasChanges}
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

        {/* Last verified info */}
        {imageDetail.verification.is_verified && imageDetail.verification.verified_by_email && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Verified by {imageDetail.verification.verified_by_email}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
