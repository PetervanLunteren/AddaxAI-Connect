/**
 * Which species live here, ranked by independent events.
 *
 * This started out with a cropped portrait per row. It did not work. Most
 * camera trap photos of the common species are night infrared shots, so at
 * 44 pixels they were grey rectangles, and making them bigger only produces
 * bigger grey rectangles. Photographs earn their place at the size of the
 * hero tile or the Explore wall, not at thumbnail size in a list.
 *
 * The old bar chart is not coming back either. It coloured every bar from the
 * light-to-dark gradient even though the species name was already on the axis,
 * which implies an order that does not exist. One colour, one bar, and the
 * name does the identifying.
 *
 * Person, vehicle and empty are left out. They are detector categories, not
 * species, and the other pages already exclude them.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel, isWildlifeLabel } from '../../utils/labels';

/** Rows shown before the list is cut. */
const MAX_ROWS = 8;

interface SpeciesListProps {
  projectId?: number;
  siteIds?: string;
}

export const SpeciesList: React.FC<SpeciesListProps> = ({ projectId, siteIds }) => {
  const { data: species, isLoading } = useQuery({
    queryKey: ['statistics', 'species', projectId, siteIds],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId, siteIds),
    enabled: projectId !== undefined,
  });

  const { data: verification } = useQuery({
    queryKey: ['statistics', 'verification-progress-all', projectId, undefined, undefined, siteIds],
    queryFn: () => statisticsApi.getVerificationProgressAll(projectId!, { site_ids: siteIds }),
    enabled: projectId !== undefined,
  });

  const wildlife = (species ?? []).filter((s) => isWildlifeLabel(s.species));
  const shown = wildlife.slice(0, MAX_ROWS);
  const top = shown[0]?.count ?? 1;
  const verifiedByLabel = new Map(
    (verification?.rows ?? []).map((r) => [r.label, r.percentage]),
  );
  const base = projectId !== undefined ? `/projects/${projectId}` : '';

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Species detected</CardTitle>
        <p className="text-sm text-muted-foreground">
          {wildlife.length > MAX_ROWS
            ? `Top ${MAX_ROWS} of ${wildlife.length}, by independent events`
            : 'By independent events'}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No animals detected yet in this selection
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {shown.map((s) => {
              const verified = verifiedByLabel.get(s.species);
              return (
                <Link
                  key={s.species}
                  to={`${base}/images?species=${encodeURIComponent(s.species)}`}
                  className="group block rounded px-1 py-0.5 -mx-1 hover:bg-accent/50"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {normalizeLabel(s.species)}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {s.count.toLocaleString()}
                      {verified !== undefined && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {verified}% verified
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(s.count / top) * 100}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
