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
import { rankByAppeal, cannotTellWhichAnimal } from './photoAppeal';

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

/**
 * How many the endpoint returns before appeal picks four from them.
 *
 * Confidence is the gate and appeal is the ranker, so the pool has to be wide
 * enough to hold some good-looking photos. It is the endpoint's maximum,
 * because on this data confidence saturates: every candidate scores 1.0000, so
 * the order past that is really capture time and a small pool is just "the
 * most recent", which is night-heavy for most species.
 *
 * Measured on red deer: 24 candidates contain 5 daylight photos, 100 contain
 * 17. The cost is 80 KB of JSON instead of 17 KB and about 100 ms, against the
 * 2.4 MB of full-size images the card then loads for the four it shows. No
 * extra image bytes at all.
 */
const CANDIDATES = 100;

/**
 * Tiles are 16:10 rather than 4:3, which takes about 65px off the card.
 *
 * Cheap to change because DetectionCrop measures its own box now. It used to
 * be told the aspect, so this would have meant editing two places and would
 * have silently mis-framed every animal if the second one were missed.
 *
 * A shorter window crops sky and foreground, which is what a camera trap
 * frame has most of, and the animal keeps the same share of the tile.
 */

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
        limit: CANDIDATES,
        species,
        site_id: siteIds,
        start_date: startDate,
        end_date: endDate,
        sort: 'confidence',
      }),
    enabled: projectId !== undefined && species.length > 0,
  });

  // One chosen species can frame a box; the all-species fallback is a list, so
  // there is nothing to match against and the crop stays on the biggest animal.
  const chosenSpecies = isAllSpecies ? undefined : species;
  const items = rankByAppeal(data?.items ?? [], COUNT, chosenSpecies);
  const uuids = items.map((i) => i.uuid);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Best photographs</CardTitle>
        <p className="text-sm text-muted-foreground">
          {isAllSpecies
            ? 'Clearest animal photos in this selection'
            : 'Clearest photos of this species'}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: COUNT }, (_, i) => (
              <div key={i} className="aspect-[16/10] animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No photos match this selection yet
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {items.map((image) => (
              <button
                key={image.uuid}
                type="button"
                onClick={() => setOpenUuid(image.uuid)}
                className="group relative block aspect-[16/10] overflow-hidden rounded-md border text-left"
              >
                {/* Passing no detections means "do not crop": the whole frame
                    is the honest answer when we cannot say which animal is the
                    one being asked for. The thumbnail shows blurred while the
                    full image downloads, so the wall appears at once on slow
                    connections. */}
                <DetectionCrop
                  imageUrl={`/api/images/${image.uuid}/full`}
                  previewUrl={`/api/images/${image.uuid}/thumbnail`}
                  alt={image.top_species ? normalizeLabel(image.top_species) : 'Detection'}
                  detections={
                    cannotTellWhichAnimal(image, chosenSpecies) ? [] : image.detections
                  }
                  species={chosenSpecies}
                  imageWidth={image.image_width}
                  imageHeight={image.image_height}
                  maxZoom={5}
                  className="h-full w-full"
                />
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
