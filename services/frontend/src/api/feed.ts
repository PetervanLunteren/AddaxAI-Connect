/**
 * Camera updates feed endpoints.
 *
 * One entry per deployment the system created (a camera's first images, or a
 * confirmed move). Entries report what already happened; nothing blocks and
 * ignoring them is harmless. A project admin can act on an entry with one of
 * four actions, each wrapping existing site/deployment plumbing.
 */
import apiClient from './client';

export interface FeedCandidate {
  site_id: number;
  name: string;
  distance_m: number;
}

export interface FeedEventItem {
  id: number;
  event_type: 'camera_first_seen' | 'camera_moved';
  created_at: string;
  camera_id: number;
  camera_label: string | null;
  site_id: number | null;
  site_name: string | null;
  // The site's name when the event happened, frozen. site_name is live and
  // feeds the resolution line ("renamed this site to X").
  original_site_name: string | null;
  from_site_id: number | null;
  from_site_name: string | null;
  distance_m: number | null;
  // Whether the site was auto-created for this event. The "new site" action
  // only shows when it was not (on a fresh site it equals renaming it).
  site_created: boolean;
  deployment_id: number | null;
  // The camera's placement location for this entry; anchors Show location.
  deployment_lat: number | null;
  deployment_lon: number | null;
  // Sites within the threshold of the deployment location, nearest first.
  candidates: FeedCandidate[];
  // Cameras standing at the assigned site right now, this one included.
  // Drives the "N cameras" chip. 0 when the site was deleted since.
  site_camera_count: number;
  resolved_action: string | null;
  resolved_at: string | null;
  resolved_by_email: string | null;
  // Already seen on an earlier visit; the panel collapses these under
  // "Already seen" together with resolved entries. Stamped when the panel
  // closes.
  seen: boolean;
}

export type ResolveAction = 'rename_site' | 'set_site' | 'new_site' | 'not_moved' | 'confirmed';

export interface ResolveRequest {
  action: ResolveAction;
  name?: string;     // rename_site, new_site
  site_id?: number;  // set_site
}

// Page size of the list; the panel asks for more in steps of this.
export const FEED_PAGE = 100;

// The panel's "new" section and the badge share one rule: new to this user
// and not yet handled by anyone. Resolved entries fold into the archive even
// when this user never saw them, so one admin's work quiets everyone.
export function isOpenAndNew(e: FeedEventItem): boolean {
  return !e.seen && !e.resolved_action;
}

const base = (projectId: number) => `/api/projects/${projectId}/feed`;

export const feedApi = {
  list: async (projectId: number, limit: number = FEED_PAGE): Promise<FeedEventItem[]> => {
    const { data } = await apiClient.get(base(projectId), { params: { limit } });
    return data;
  },
  unseen: async (projectId: number): Promise<number> => {
    const { data } = await apiClient.get(`${base(projectId)}/unseen`);
    return data.count as number;
  },
  // upTo is the newest created_at the user had on screen, so an entry that
  // arrived while the panel was open stays new. Omit for an empty feed.
  markSeen: async (projectId: number, upTo?: string): Promise<void> => {
    await apiClient.post(`${base(projectId)}/seen`, upTo ? { up_to: upTo } : {});
  },
  resolve: async (
    projectId: number,
    eventId: number,
    body: ResolveRequest,
  ): Promise<{ merged: number }> => {
    const { data } = await apiClient.post(`${base(projectId)}/${eventId}/resolve`, body);
    return data;
  },
  // Photos for an entry whose deployment was merged away (undone move).
  eventThumbnails: async (projectId: number, eventId: number): Promise<string[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/${eventId}/thumbnails`);
    return data.uuids as string[];
  },
};
