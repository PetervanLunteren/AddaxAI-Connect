/**
 * Which species live here, each with its own portrait.
 *
 * This replaces the species bar chart. The bar chart coloured every bar from
 * the light-to-dark gradient even though the name was already on the axis, so
 * the colour carried no information while implying an order that does not
 * exist. A row carries the same ranking, the same count, plus the picture and
 * how far that species has been verified, and it keeps working at forty
 * species where a bar chart stops being readable.
 *
 * Person, vehicle and empty are left out. They are detector categories, not
 * species, and the other pages already exclude them.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PawPrint } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import { imagesApi } from '../../api/images';
import { normalizeLabel, isWildlifeLabel } from '../../utils/labels';
import { DetectionCrop } from './DetectionCrop';
import { ImageDetailModal } from '../ImageDetailModal';

/** Rows shown before the list is cut. Each row costs one image request. */
const MAX_ROWS = 6;

interface SpeciesPortraitListProps {
  projectId?: number;
  siteIds?: string;
}

interface RowProps {
  species: string;
  count: number;
  share: number;
  verifiedPercentage: number | null;
  projectId?: number;
  siteIds?: string;
  onOpen: (uuid: string) => void;
}

const SpeciesRow: React.FC<RowProps> = ({
  species,
  count,
  share,
  verifiedPercentage,
  projectId,
  siteIds,
  onOpen,
}) => {
  // One request per row, for the clearest photo of this species rather than
  // merely a recent one. Cached by react-query, so switching tabs is free.
  const { data } = useQuery({
    queryKey: ['dashboard', 'species-portrait', projectId, siteIds, species],
    queryFn: () =>
      imagesApi.getAll({
        project_id: projectId,
        limit: 1,
        species,
        site_id: siteIds,
        sort: 'confidence',
      }),
    enabled: projectId !== undefined,
    staleTime: 5 * 60 * 1000,
  });

  const image = data?.items?.[0];

  // The portrait is 44 pixels square, so even a heavy crop of a 300px
  // thumbnail is still being scaled down. Thumbnail is the right source here,
  // unlike the hero tile which needs the full-size image.
  const body = (
    <>
      {image ? (
        <DetectionCrop
          imageUrl={image.thumbnail_url ?? ''}
          alt={normalizeLabel(species)}
          detections={image.detections}
          imageWidth={image.image_width}
          imageHeight={image.image_height}
          aspect={1}
          className="h-11 w-11 shrink-0 rounded-md"
        />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted">
          <PawPrint className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{normalizeLabel(species)}</p>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">{count.toLocaleString()}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {verifiedPercentage === null ? 'events' : `${verifiedPercentage}% verified`}
        </p>
      </div>
    </>
  );

  if (!image) {
    return <div className="flex items-center gap-3 py-2.5">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(image.uuid)}
      className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-accent/50"
    >
      {body}
    </button>
  );
};

export const SpeciesPortraitList: React.FC<SpeciesPortraitListProps> = ({
  projectId,
  siteIds,
}) => {
  const [openUuid, setOpenUuid] = useState<string | null>(null);

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
          <div className="divide-y">
            {shown.map((s) => (
              <SpeciesRow
                key={s.species}
                species={s.species}
                count={s.count}
                share={s.count / top}
                verifiedPercentage={verifiedByLabel.get(s.species) ?? null}
                projectId={projectId}
                siteIds={siteIds}
                onOpen={setOpenUuid}
              />
            ))}
          </div>
        )}
      </CardContent>

      {openUuid && (
        <ImageDetailModal
          imageUuid={openUuid}
          isOpen={openUuid !== null}
          onClose={() => setOpenUuid(null)}
        />
      )}
    </Card>
  );
};
