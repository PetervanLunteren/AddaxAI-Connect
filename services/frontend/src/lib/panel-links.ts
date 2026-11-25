/**
 * Links that open a camera's or a site's panel on its page, the hook that
 * opens it, and the link to a deployment's photos. One pair for every place that links to a panel (deployment
 * cards, the image detail), so the address and its handling never drift.
 *
 * The parameter is read once and removed from the address: closing the
 * panel does not reopen it, back stays usable, and it is never remembered
 * as a filter (the Sites page's own `site` parameter is a filter, so the
 * site panel has its own name).
 */
import { useEffect } from 'react';

export const CAMERA_PANEL_PARAM = 'camera';
export const SITE_PANEL_PARAM = 'site_panel';

export const cameraPanelHref = (projectId: number, cameraId: number) =>
  `/projects/${projectId}/cameras?${CAMERA_PANEL_PARAM}=${cameraId}`;
export const sitePanelHref = (projectId: number, siteId: number) =>
  `/projects/${projectId}/sites?${SITE_PANEL_PARAM}=${siteId}`;

/**
 * The photos of one deployment on the Images page: its camera, from its
 * first day to its last (no end while it runs). show_empty ticks every label
 * (the Images page hides empty photos by default), so the page lists what the
 * card counts; hidden photos and photos still being processed are not
 * listed there. A link never overwrites the page's remembered filters.
 */
export const deploymentImagesHref = (
  projectId: number, cameraId: number, firstDay: string | null, lastDay: string | null,
) => {
  const params = new URLSearchParams({ camera_ids: String(cameraId), show_empty: 'true' });
  if (firstDay) params.set('date_from', firstDay);
  if (lastDay) params.set('date_to', lastDay);
  return `/projects/${projectId}/images?${params}`;
};

/**
 * Open the panel named in the address once `ready` (the page has what the
 * panel needs), then drop the parameter. `open` gets the id.
 */
export function useOpenPanelFromLink(
  param: string,
  searchParams: URLSearchParams,
  setSearchParams: (next: URLSearchParams, opts?: { replace?: boolean }) => void,
  ready: boolean,
  open: (id: number) => void,
) {
  const wanted = searchParams.get(param);
  useEffect(() => {
    if (!wanted || !ready) return;
    const id = Number(wanted);
    if (Number.isFinite(id)) open(id);
    const next = new URLSearchParams(searchParams);
    next.delete(param);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, ready]);
}
