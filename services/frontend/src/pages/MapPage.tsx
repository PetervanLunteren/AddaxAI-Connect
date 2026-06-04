/**
 * Project map.
 *
 * One map for the whole project, with a segmented control for what to show:
 * - Sites: the curated places (site pins).
 * - Cameras: one pin per camera at ITS SITE location, colored by health
 *   (battery / signal / status) for planning service visits. A camera with no
 *   site yet falls back to its last reported GPS.
 *
 * This replaces the separate map tabs that used to live on the Cameras and
 * Sites pages, so there is one place, and one coordinate system, for "where is
 * everything". Clicking a marker opens that entity's page for the detail.
 */
import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Camera as CameraIcon, Activity } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { sitesApi } from '../api/sites';
import { camerasApi } from '../api/cameras';
import type { Camera } from '../api/types';
import { SitesMapView } from '../components/sites/SitesMapView';
import { CameraMapView } from '../components/cameras/CameraMapView';
import { CameraDetailSheet } from '../components/CameraDetailSheet';
import { SiteDetailWithActions } from '../components/SiteDetailWithActions';
import { DetectionRatePanel } from '../components/map/DetectionRatePanel';
import { cn } from '../lib/utils';

type Layer = 'sites' | 'cameras' | 'detections';

export const MapPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { selectedProject, isProjectAdmin, isServerAdmin, canAdminCurrentProject } =
    useProject();
  const canEdit = isProjectAdmin || isServerAdmin;
  const queryClient = useQueryClient();

  const [detailSiteId, setDetailSiteId] = React.useState<number | null>(null);
  const [detailCamera, setDetailCamera] = React.useState<Camera | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('layer');
  const layer: Layer = raw === 'cameras' || raw === 'detections' ? raw : 'sites';
  const setLayer = (l: Layer) => {
    const next = new URLSearchParams(searchParams);
    if (l === 'sites') next.delete('layer');
    else next.set('layer', l);
    setSearchParams(next, { replace: true });
  };

  const { data: sites } = useQuery({
    queryKey: ['sites', pid],
    queryFn: () => sitesApi.list(pid),
    enabled: Number.isFinite(pid),
  });
  const { data: cameras } = useQuery({
    queryKey: ['cameras', pid],
    queryFn: () => camerasApi.getAll(pid),
    enabled: Number.isFinite(pid),
  });

  // Plot each camera at its site, so both layers share one coordinate system.
  // Fall back to the camera's reported GPS when it has no site yet.
  const camerasAtSites = React.useMemo<Camera[]>(() => {
    if (!cameras) return [];
    const byId = new Map((sites ?? []).map((s) => [s.id, s]));
    return cameras.map((c) => {
      const site = c.current_site ? byId.get(c.current_site.id) : undefined;
      if (site && site.latitude != null && site.longitude != null) {
        return { ...c, location: { lat: site.latitude, lon: site.longitude } };
      }
      return c;
    });
  }, [cameras, sites]);

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view the map.</p>
      </div>
    );
  }

  const tab = (l: Layer, label: string, Icon: typeof MapPin) => (
    <button
      onClick={() => setLayer(l)}
      className={cn(
        'px-4 py-1.5 text-sm font-medium rounded flex items-center gap-2 transition-colors',
        layer === l ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Map</h1>
        <p className="text-sm text-gray-600 mt-1">
          Where everything is. Switch between your sites and your cameras.
          Cameras are shown at their site and colored by health, to plan visits.
        </p>
      </div>

      <div className="inline-flex rounded-md border p-0.5 bg-muted/50">
        {tab('sites', 'Sites', MapPin)}
        {tab('cameras', 'Cameras', CameraIcon)}
        {tab('detections', 'Detections', Activity)}
      </div>

      {layer === 'sites' && (
        <SitesMapView
          sites={sites ?? []}
          onSiteClick={(id) => setDetailSiteId(id)}
        />
      )}
      {layer === 'cameras' && (
        <CameraMapView
          cameras={camerasAtSites}
          onCameraClick={(c) => setDetailCamera(c)}
        />
      )}
      {layer === 'detections' && <DetectionRatePanel />}

      <SiteDetailWithActions
        open={detailSiteId != null}
        onClose={() => setDetailSiteId(null)}
        projectId={pid}
        siteId={detailSiteId}
        canEdit={canEdit}
      />
      <CameraDetailSheet
        camera={detailCamera}
        isOpen={detailCamera != null}
        onClose={() => setDetailCamera(null)}
        canAdmin={canAdminCurrentProject}
        isServerAdmin={isServerAdmin}
        projectId={pid}
        onUpdate={() => queryClient.invalidateQueries({ queryKey: ['cameras', pid] })}
      />
    </div>
  );
};
