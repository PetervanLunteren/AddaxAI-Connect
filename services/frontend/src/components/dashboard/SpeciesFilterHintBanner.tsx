/**
 * Dashboard hint that nudges a project admin to narrow the species list.
 *
 * On a DeepFaune server, classification runs against every species the model
 * knows. Limiting a project to the species that occur in its area re-normalizes
 * the predictions and usually improves accuracy. SpeciesNet ignores the project
 * species list (taxonomy mapping and country code handle filtering), so the
 * hint never shows there.
 *
 * The banner self-resolves once the admin narrows the list, because it only
 * shows while included_species is still empty (all species). "Don't show again"
 * is a learned preference, so it persists in localStorage rather than per
 * session. Viewers never see it, they cannot change the setting.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Callout } from '../ui/Callout';
import { Button } from '../ui/Button';

import { speciesApi } from '../../api/species';
import { useProject } from '../../contexts/ProjectContext';

const DISMISS_KEY = 'addaxai:dashboard:species-filter-hint-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    /* ignore */
  }
}

export function SpeciesFilterHintBanner() {
  const navigate = useNavigate();
  const { selectedProject, canAdminCurrentProject } = useProject();
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  const { data: availableSpeciesData } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
  });

  // Only admins can change the species list, so only they get the nudge.
  if (!canAdminCurrentProject || !selectedProject || dismissed) return null;

  // SpeciesNet ignores included_species, so narrowing it does nothing there.
  if (!availableSpeciesData || availableSpeciesData.model === 'speciesnet') return null;

  // Already narrowed means the hint is no longer actionable.
  const included = selectedProject.included_species;
  if (included && included.length > 0) return null;

  const handleDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <Callout
      variant="info"
      action={
        <>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => navigate(`/projects/${selectedProject.id}/settings`)}
            className="whitespace-nowrap"
          >
            Open settings
          </Button>
          {/* Dismiss writes localStorage, so the hint stays gone */}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="p-0.5 rounded hover:bg-blue-100"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      Right now every species the model knows can be classified in this project.
      If you limit it to the species that live in your area, classification often
      gets more accurate. You can change this any time in the project settings.
    </Callout>
  );
}
