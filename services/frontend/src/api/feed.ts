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
  // Already seen on an earlier visit, personal. New entries show bold.
  // Stamped when the panel closes.
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

// Open means nobody has dealt with it yet. Shared: the badge is the open
// count, and the panel's to-do section is the open entries.
export function isOpen(e: FeedEventItem): boolean {
  return !e.resolved_action;
}

const base = (projectId: number) => `/api/projects/${projectId}/feed`;

export const feedApi = {
  list: async (projectId: number, limit: number = FEED_PAGE): Promise<FeedEventItem[]> => {
    const { data } = await apiClient.get(base(projectId), { params: { limit } });
    return data;
  },
  // Entries nobody has dealt with yet, the badge. Same for every user.
  openCount: async (projectId: number): Promise<number> => {
    const { data } = await apiClient.get(`${base(projectId)}/open`);
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
