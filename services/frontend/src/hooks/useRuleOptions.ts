/**
 * The option lists the rule dialogs need: the project's sites, the labels
 * the model can produce (plus person and vehicle), and the default
 * cooldown for a new detection rule. Shared by the notifications page and
 * the EarthRanger integration page so the two never drift.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Option } from '../components/ui/MultiSelect';
import { sitesApi } from '../api/sites';
import { speciesApi } from '../api/species';
import { normalizeLabel } from '../utils/labels';

interface ProjectLike {
  included_species?: string[] | null;
  independence_interval_minutes: number;
}

export function useRuleOptions(projectId: number, project: ProjectLike | null | undefined) {
  const { data: projectSites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
    enabled: projectId > 0,
  });
  const siteOptions: Option[] = useMemo(() => {
    const list = projectSites ?? [];
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((site) => ({ label: site.name, value: site.id }));
  }, [projectSites]);

  // Model-dependent label list. For DeepFaune the project's included
  // species narrow it when set; for SpeciesNet the taxonomy mapping is the
  // list. Person and vehicle are detection-level labels and always there.
  const { data: availableSpeciesData } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
  });
  const isSpeciesNet = availableSpeciesData?.model === 'speciesnet';
  const availableSpecies = useMemo(() => {
    const modelSpecies = availableSpeciesData?.species ?? [];
    const baseSpecies = (!isSpeciesNet && project?.included_species) || modelSpecies;
    return [...new Set([...baseSpecies, 'person', 'vehicle'])];
  }, [availableSpeciesData?.species, isSpeciesNet, project?.included_species]);
  const speciesOptions: Option[] = useMemo(
    () =>
      availableSpecies
        .slice()
        .sort()
        .map((species) => ({ label: normalizeLabel(species), value: species })),
    [availableSpecies],
  );

  // The independence interval says how far apart two sightings must be to
  // count as separate events, so it is the natural burst control for a new
  // rule; 30 minutes when disabled.
  const defaultCooldownMinutes =
    project && project.independence_interval_minutes > 0
      ? project.independence_interval_minutes
      : 30;

  return { siteOptions, speciesOptions, defaultCooldownMinutes };
}
