/**
 * Links that open a camera's or a site's panel, a deployment's window, one
 * photo or a set of photos on its page, and the hook that opens a panel
 * from such a link. One
 * place for every screen that links there (deployment cards, the image
 * detail, the deployment window), so an address and its handling never
 * drift.
 *
 * A panel's parameter is read once and removed from the address: closing
 * the panel does not reopen it, back stays usable, and it is never
 * remembered as a filter (the Sites page's own `site` parameter is a
 * filter, so the site panel has its own name).
 */
import { useEffect } from 'react';

export const CAMERA_PANEL_PARAM = 'camera';
export const SITE_PANEL_PARAM = 'site_panel';
// The window of one deployment on the Deployments page.
export const DEPLOYMENT_WINDOW_PARAM = 'deployment';

export const cameraPanelHref = (projectId: number, cameraId: number) =>
  `/projects/${projectId}/cameras?${CAMERA_PANEL_PARAM}=${cameraId}`;
export const sitePanelHref = (projectId: number, siteId: number) =>
  `/projects/${projectId}/sites?${SITE_PANEL_PARAM}=${siteId}`;

export const deploymentWindowHref = (projectId: number, deploymentId: number) =>
  `/projects/${projectId}/deployments?${DEPLOYMENT_WINDOW_PARAM}=${deploymentId}`;

/** One photo, opened in image verification on the Images page. */
export const imageHref = (projectId: number, imageUuid: string) =>
  `/projects/${projectId}/images?image=${imageUuid}`;

/**
 * A set of photos of one camera: those of a deployment (its first day to its
 * last, no last day while it runs), or the camera's photos without a site.
 */
export interface PhotoSet {
  cameraId: number;
  firstDay: string | null; // YYYY-MM-DD
  lastDay: string | null;
  noSite?: boolean; // only the photos no deployment covers
}

// The value in a site filter that asks for photos without a site (NO_SITE
// in the API's utils/site_scope.py). The Images page and Curation offer it
// as "No site" in their Sites filter.
export const NO_SITE = 'none';

/**
 * The set on the Images page, to look through. show_empty ticks every label
 * (the Images page hides empty photos by default), so the page lists what a
 * deployment card counts; hidden photos and photos still being processed
 * are not listed there. A link never overwrites the page's remembered
 * filters.
 */
export const imagesHref = (projectId: number, set: PhotoSet) => {
  const params = new URLSearchParams({ camera_ids: String(set.cameraId), show_empty: 'true' });
  if (set.firstDay) params.set('date_from', set.firstDay);
  if (set.lastDay) params.set('date_to', set.lastDay);
  if (set.noSite) params.set('site_id', NO_SITE);
  return `/projects/${projectId}/images?${params}`;
};

/**
 * The same set in Curation, where a project admin can hide or delete photos
 * (test photos, for example). Curation lists analysed photos only.
 */
export const curationHref = (projectId: number, set: PhotoSet) => {
  const params = new URLSearchParams({ camera_id: String(set.cameraId) });
  if (set.firstDay) params.set('date_from', set.firstDay);
  if (set.lastDay) params.set('date_to', set.lastDay);
  if (set.noSite) params.set('site_id', NO_SITE);
  return `/projects/${projectId}/manage-images?${params}`;
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
