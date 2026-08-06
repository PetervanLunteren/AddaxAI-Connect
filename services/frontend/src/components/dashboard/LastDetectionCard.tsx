/**
 * The newest wildlife photograph in the project, large.
 *
 * Wildlife only, deliberately. Projects can blur people and vehicles and most
 * do, so leading the dashboard with the newest image of anything would often
 * mean opening on a blurred human. The species filter is passed in rather than
 * derived here, because the page already holds the species list.
 *
 * Clicking opens the existing image modal, which carries the verification
 * panel, so the photograph is a way into the work rather than decoration.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { imagesApi } from '../../api/images';
import { normalizeLabel } from '../../utils/labels';
import { DetectionCrop } from './DetectionCrop';
import { ImageDetailModal } from '../ImageDetailModal';

interface LastDetectionCardProps {
  projectId?: number;
  siteIds?: string;
  /** Comma-separated wildlife species. Empty string means the project has none. */
  wildlifeSpecies: string;
  className?: string;
}

function formatWhen(captured: string): string {
  const date = new Date(captured);
  if (Number.isNaN(date.getTime())) return captured;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const LastDetectionCard: React.FC<LastDetectionCardProps> = ({
  projectId,
  siteIds,
  wildlifeSpecies,
  className = '',
}) => {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'last-detection', projectId, siteIds, wildlifeSpecies],
    queryFn: () =>
      imagesApi.getAll({
        project_id: projectId,
        limit: 1,
        species: wildlifeSpecies,
        site_id: siteIds,
      }),
    enabled: projectId !== undefined && wildlifeSpecies.length > 0,
  });

  const image = data?.items?.[0];

  if (isLoading || !image) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border bg-card p-8 text-center ${className}`}
      >
        <Camera className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {isLoading ? 'Looking for the newest photo' : 'No wildlife photos yet'}
        </p>
        {!isLoading && (
          <p className="text-xs text-muted-foreground">
            Once a camera detects an animal its picture appears here
          </p>
        )}
      </div>
    );
  }

  const species = image.top_species ? normalizeLabel(image.top_species) : 'Animal';
  const confidence =
    image.max_confidence !== null ? ` · ${Math.round(image.max_confidence * 100)}%` : '';

  return (
    <>
      {/* Keeps a 16:10 shape while it is the only thing in its row, and
          stretches to the row height once it sits beside the stat tiles, so
          the photograph and the tiles finish at the same line. DetectionCrop
          measures whatever shape it ends up with. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group relative block w-full overflow-hidden rounded-lg border text-left aspect-[16/10] lg:aspect-auto lg:h-full ${className}`}
      >
        {/* Full size, not the thumbnail. This tile is around 540px wide and a
            distant animal is only a dozen pixels across in a 300px thumbnail,
            which magnifies into mush. One large image on the dashboard is a
            fair price for a photograph people actually want to look at. The
            thumbnail bridges the wait: it shows blurred right away and the
            full image replaces it when downloaded. */}
        <DetectionCrop
          imageUrl={`/api/images/${image.uuid}/full`}
          previewUrl={`/api/images/${image.uuid}/thumbnail`}
          alt={species}
          detections={image.detections}
          imageWidth={image.image_width}
          imageHeight={image.image_height}
          maxZoom={5}
          className="h-full w-full"
        />
        {/* Dark wash only behind the text, so the picture stays bright. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-4">
          <p className="text-base font-semibold text-white drop-shadow">Last detection</p>
          <p className="text-xs text-white/90 drop-shadow">
            {species}
            {confidence} · {image.site_name ?? image.camera_name} · {formatWhen(image.captured_at)}
          </p>
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow">
          {species}
        </span>
      </button>

      {open && (
        <ImageDetailModal
          imageUuid={image.uuid}
          isOpen={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
