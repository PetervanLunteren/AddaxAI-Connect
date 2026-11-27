/**
 * How many photos of the project have no site yet: a camera without GPS
 * until a person sets where it stood. The sum of the cameras list, the
 * number each camera panel shows, so every screen gives the same number.
 *
 * Reads the cameras list most pages have cached already, under the key
 * every deployment change invalidates, so the number follows a fix at
 * once. Null for a viewer with a site list: they never see these photos.
 */
import { useQuery } from '@tanstack/react-query';
import { camerasApi } from '../api/cameras';
import type { Camera } from '../api/types';

const sum = (cameras: Camera[]): number | null =>
  cameras.some((c) => c.unplaced_photo_count === null)
    ? null
    : cameras.reduce((n, c) => n + (c.unplaced_photo_count ?? 0), 0);

export function useUnplacedPhotos(projectId: number | undefined): number | null {
  const { data } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
    select: sum,
  });
  return data ?? null;
}
