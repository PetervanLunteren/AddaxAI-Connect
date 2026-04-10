/**
 * Per-species classification threshold overrides modal.
 *
 * Lists every relevant species (project allowed list, or global model
 * catalog if the allowed list is empty, plus historically observed species),
 * with a per-row checkbox + slider. Unchecked rows inherit the project
 * default; checked rows have their own threshold value stored in the
 * `overrides` map. The modal mutates state via `onChange` and never saves
 * on its own — the parent settings page's Save button handles that.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { imagesApi } from '../api/images';
import { speciesApi } from '../api/species';
import { useProject } from '../contexts/ProjectContext';
import { normalizeLabel } from '../utils/labels';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultThreshold: number;
  overrides: Record<string, number>;
  onChange: (overrides: Record<string, number>) => void;
}

export function ClassificationThresholdsModal({
  open,
  onClose,
  defaultThreshold,
  overrides,
  onChange,
}: Props) {
  const { selectedProject } = useProject();

  // Same source set as VerificationPanel's allSpeciesOptions, minus
  // person/vehicle (detection categories, not classification species)
  // and minus AI-on-current-image (no current image on the settings page).
  const projectId = selectedProject?.id;
  const includedSpecies = selectedProject?.included_species ?? null;
  const needsGlobalCatalog = !includedSpecies || includedSpecies.length === 0;

  const { data: observedSpecies } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: open && projectId !== undefined,
  });
  const { data: globalCatalog } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
    enabled: open && needsGlobalCatalog,
  });

  const speciesList = React.useMemo(() => {
    const byValue = new Map<string, { value: string; label: string }>();
    const add = (value: string) => {
      if (value === 'person' || value === 'vehicle') return;
      if (!byValue.has(value)) {
        byValue.set(value, { value, label: normalizeLabel(value) });
      }
    };
    if (includedSpecies && includedSpecies.length > 0) {
      includedSpecies.forEach(s => add(s));
    } else if (globalCatalog) {
      globalCatalog.species.forEach(s => add(s));
    }
    observedSpecies?.forEach(s => add(s.value));
    return Array.from(byValue.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [includedSpecies, globalCatalog, observedSpecies]);

  const toggleOverride = (species: string, checked: boolean) => {
    const next = { ...overrides };
    if (checked) {
      next[species] = defaultThreshold;
    } else {
      delete next[species];
    }
    onChange(next);
  };

  const setOverrideValue = (species: string, value: number) => {
    onChange({ ...overrides, [species]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Per-species classification thresholds</DialogTitle>
          <DialogDescription>
            Override the default threshold ({(defaultThreshold * 100).toFixed(0)}%)
            for individual species. Unchecked species use the default.
          </DialogDescription>
        </DialogHeader>

        {speciesList.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No species available yet. Add observations or set the project's
            species filter.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-1">
            {speciesList.map(({ value, label }) => {
              const isOverridden = value in overrides;
              const effective = overrides[value] ?? defaultThreshold;
              return (
                <div
                  key={value}
                  className="flex items-center gap-3 p-2 rounded hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={isOverridden}
                    onChange={(e) => toggleOverride(value, e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-[#0f6064]"
                  />
                  <span className="flex-1 text-sm">{label}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={effective}
                    onChange={(e) =>
                      setOverrideValue(value, parseFloat(e.target.value))
                    }
                    disabled={!isOverridden}
                    className="w-40 h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: `linear-gradient(to right, #0f6064 0%, #0f6064 ${effective * 100}%, #e1eceb ${effective * 100}%, #e1eceb 100%)`,
                    }}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {(effective * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
