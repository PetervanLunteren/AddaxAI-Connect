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
  // Sites within the threshold of the deployment location, nearest first.
  candidates: FeedCandidate[];
  resolved_action: string | null;
  resolved_at: string | null;
  resolved_by_email: string | null;
  // Already seen on an earlier visit; the panel collapses these under
  // "Earlier". Stamped when the panel closes.
  seen: boolean;
}

export type ResolveAction = 'rename_site' | 'set_site' | 'new_site' | 'not_moved';

export interface ResolveRequest {
  action: ResolveAction;
  name?: string;     // rename_site, new_site
  site_id?: number;  // set_site
}

const base = (projectId: number) => `/api/projects/${projectId}/feed`;

export const feedApi = {
  list: async (projectId: number): Promise<FeedEventItem[]> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  unseen: async (projectId: number): Promise<number> => {
    const { data } = await apiClient.get(`${base(projectId)}/unseen`);
    return data.count as number;
  },
  markSeen: async (projectId: number): Promise<void> => {
    await apiClient.post(`${base(projectId)}/seen`);
  },
  resolve: async (
    projectId: number,
    eventId: number,
    body: ResolveRequest,
  ): Promise<{ merged: number }> => {
    const { data } = await apiClient.post(`${base(projectId)}/${eventId}/resolve`, body);
    return data;
  },
};
