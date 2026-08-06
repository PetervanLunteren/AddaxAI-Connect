/**
 * The clearest photographs of the selected species.
 *
 * This is the lead of the Explore tab. Once you have named a species, a wall
 * of its best pictures is the fastest way to check whether the model is right
 * about it, and every picture opens the modal that can correct the label. That
 * turns looking into verifying, which is the slow part of the whole product.
 *
 * Ranked by classification confidence, which the images endpoint does with
 * sort=confidence. Without that the strip would be "six recent photos", which
 * is a different and much less useful thing.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { imagesApi } from '../../api/images';
import { normalizeLabel } from '../../utils/labels';
import { DetectionCrop } from './DetectionCrop';
import { ImageDetailModal } from '../ImageDetailModal';

/**
 * Four rather than six, because each tile loads the full-size image.
 *
 * Thumbnails are 300 pixels wide, and a distant animal is only a dozen pixels
 * across in one, so a wall built from thumbnails is a wall of mush and answers
 * nothing. Full images cost around 600 KB each. Four is the point where the
 * pictures are worth looking at without the page becoming heavy, and the
 * browser reuses them when the modal opens the same image.
 */
const COUNT = 4;

interface BestPhotosCardProps {
  projectId?: number;
  siteIds?: string;
  /** Single species, or the comma-separated wildlife list when none is chosen. */
  species: string;
  /** True when `species` is the fallback list rather than one chosen species. */
  isAllSpecies: boolean;
  startDate?: string;
  endDate?: string;
}

export const BestPhotosCard: React.FC<BestPhotosCardProps> = ({
  projectId,
  siteIds,
  species,
  isAllSpecies,
  startDate,
  endDate,
}) => {
  const [openUuid, setOpenUuid] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'best-photos', projectId, siteIds, species, startDate, endDate],
    queryFn: () =>
      imagesApi.getAll({
        project_id: projectId,
        limit: COUNT,
        species,
        site_id: siteIds,
        start_date: startDate,
        end_date: endDate,
        sort: 'confidence',
      }),
    enabled: projectId !== undefined && species.length > 0,
  });

  const items = data?.items ?? [];
  const uuids = items.map((i) => i.uuid);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Best photographs</CardTitle>
        <p className="text-sm text-muted-foreground">
          {isAllSpecies
            ? 'Clearest animal photos in this selection, open one to check or correct it'
            : 'Clearest photos of this species, open one to check or correct it'}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: COUNT }, (_, i) => (
              <div key={i} className="aspect-[4/3] animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No photos match this selection yet
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {items.map((image) => (
              <button
                key={image.uuid}
                type="button"
                onClick={() => setOpenUuid(image.uuid)}
                className="group relative block aspect-[4/3] overflow-hidden rounded-md border text-left"
              >
                <DetectionCrop
                  imageUrl={`/api/images/${image.uuid}/full`}
                  alt={image.top_species ? normalizeLabel(image.top_species) : 'Detection'}
                  detections={image.detections}
                  imageWidth={image.image_width}
                  imageHeight={image.image_height}
                  maxZoom={5}
                  className="h-full w-full"
                />
                {/* A verified image carries no AI confidence, on purpose. It is
                    the most trustworthy photo on the wall, so say so rather
                    than leaving the corner blank. */}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-xs font-medium tabular-nums text-white">
                  {image.is_verified
                    ? 'Verified'
                    : image.max_confidence !== null
                      ? `${Math.round(image.max_confidence * 100)}%`
                      : ''}
                  {isAllSpecies && image.top_species
                    ? ` · ${normalizeLabel(image.top_species)}`
                    : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      {openUuid && (
        <ImageDetailModal
          imageUuid={openUuid}
          allImageUuids={uuids}
          isOpen={openUuid !== null}
          onClose={() => setOpenUuid(null)}
        />
      )}
    </Card>
  );
};
