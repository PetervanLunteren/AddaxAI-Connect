/**
 * Links that open a camera's or a site's panel on its page, and the hook
 * that opens it. One pair for every place that links to a panel (deployment
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
