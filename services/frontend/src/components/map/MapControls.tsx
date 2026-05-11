/**
 * Map controls component
 * Provides filters for species and date range, and view mode selection
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Circle, Hexagon, Group, Map, Satellite, Navigation, ChevronDown } from 'lucide-react';
import type { DetectionRateMapFilters } from '../../api/types';
import { Button } from '../ui/Button';
import { DateRangePicker } from '../ui/DateRangePicker';
import { MultiSelect, type Option } from '../ui/MultiSelect';
import { imagesApi } from '../../api/images';
import { camerasApi } from '../../api/cameras';
import { useProject } from '../../contexts/ProjectContext';

interface MapControlsProps {
  filters: DetectionRateMapFilters;
  onFiltersChange: (filters: DetectionRateMapFilters) => void;
  viewMode: 'points' | 'hexbins' | 'clusters';
  onViewModeChange: (mode: 'points' | 'hexbins' | 'clusters') => void;
  baseLayer: string;
  onBaseLayerChange: (layer: string) => void;
  minDate?: string | null;  // YYYY-MM-DD
  maxDate?: string | null;  // YYYY-MM-DD
}

export function MapControls({ filters, onFiltersChange, viewMode, onViewModeChange, baseLayer, onBaseLayerChange, minDate, maxDate }: MapControlsProps) {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const species = filters.species || '';
  const startDate = filters.start_date || '';
  const endDate = filters.end_date || '';

  // Fetch species for dropdown
  const { data: speciesOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species'],
    queryFn: () => imagesApi.getSpecies(),
  });

  // Fetch cameras and tag options so the camera-tag filter can map from
  // selected tag labels to a comma-separated list of camera IDs the
  // backend understands. Same pattern as DashboardFilters.
  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
    enabled: projectId !== undefined,
  });

  // Tag and camera selections are stored locally — the filters object
  // only carries the derived `camera_ids` API param. Local state means the
  // UI keeps the user's intent (tag vs explicit camera) even when both
  // contribute to the same `camera_ids` string. Trade-off: a `?camera_ids=`
  // URL won't pre-populate the UI, but the map page does not URL-sync
  // these filters today.
  const [selectedTags, setSelectedTags] = useState<Option[]>([]);
  const [selectedCameras, setSelectedCameras] = useState<Option[]>([]);

  const allTagOptions: Option[] = useMemo(
    () => (tagOptions ?? []).map((t) => ({ label: t, value: t })),
    [tagOptions],
  );
  const cameraSelectOptions: Option[] = useMemo(
    () => (cameras ?? []).map((c) => ({ label: c.name, value: String(c.id) })),
    [cameras],
  );

  const computeCameraIds = (tags: Option[], cams: Option[]): string | undefined => {
    if (tags.length === 0 && cams.length === 0) return undefined;
    const ids = new Set<string>(cams.map((c) => String(c.value)));
    if (tags.length > 0 && cameras) {
      const tagSet = new Set(tags.map((t) => String(t.value)));
      for (const c of cameras) {
        if (c.tags?.some((tag) => tagSet.has(tag))) ids.add(String(c.id));
      }
    }
    return ids.size === 0 ? '0' : Array.from(ids).join(',');
  };

  const handleTagsChange = (tags: Option[]) => {
    setSelectedTags(tags);
    onFiltersChange({ ...filters, camera_ids: computeCameraIds(tags, selectedCameras) });
  };
  const handleCamerasChange = (cams: Option[]) => {
    setSelectedCameras(cams);
    onFiltersChange({ ...filters, camera_ids: computeCameraIds(selectedTags, cams) });
  };

  const handleSpeciesChange = (value: string) => {
    onFiltersChange({
      ...filters,
      species: value || undefined,
    });
  };

  return (
    // Leaflet's panes use z-indexes up to 1000 within its own stacking
    // context. Lift the entire controls bar above that so the MultiSelect
    // popup, the date-range popover, and the native species select all
    // render on top of the map below.
    <div className="relative z-[1100] mb-4 rounded-lg border bg-card pt-2 pb-3 px-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-end">
        {/* View mode selector */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            View mode
          </label>
          <div className="flex w-full rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => onViewModeChange('hexbins')}
              title="Hexbins"
              aria-label="Hexbins"
              className={`flex-1 h-10 px-3 text-sm font-medium rounded-l-md border flex items-center justify-center ${
                viewMode === 'hexbins'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Hexagon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('points')}
              title="Points"
              aria-label="Points"
              className={`flex-1 h-10 px-3 text-sm font-medium border-t border-b border-r flex items-center justify-center ${
                viewMode === 'points'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Circle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('clusters')}
              title="Clusters"
              aria-label="Clusters"
              className={`flex-1 h-10 px-3 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center justify-center ${
                viewMode === 'clusters'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Group className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="species-filter" className="block text-xs font-medium text-muted-foreground mb-1">
            Species
          </label>
          <div className="relative">
            <select
              id="species-filter"
              value={species}
              onChange={(e) => handleSpeciesChange(e.target.value)}
              disabled={speciesLoading}
              className="w-full h-10 px-3 pr-8 border border-gray-300 rounded-md text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-100"
            >
              <option value="">All species</option>
              {speciesOptions?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Cameras
          </label>
          <MultiSelect
            options={cameraSelectOptions}
            value={selectedCameras}
            onChange={handleCamerasChange}
            placeholder="All cameras"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Camera tags
          </label>
          <MultiSelect
            options={allTagOptions}
            value={selectedTags}
            onChange={handleTagsChange}
            placeholder="Any tags"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Date range
          </label>
          <DateRangePicker
            from={startDate || null}
            to={endDate || null}
            onChange={({ from, to }) =>
              onFiltersChange({ ...filters, start_date: from, end_date: to })
            }
            minDate={minDate}
            maxDate={maxDate}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Map style
          </label>
          <div className="flex w-full rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => onBaseLayerChange('positron')}
              title="Light"
              aria-label="Light"
              className={`flex-1 h-10 px-3 text-sm font-medium rounded-l-md border flex items-center justify-center ${
                baseLayer === 'positron'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Map className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onBaseLayerChange('satellite')}
              title="Satellite"
              aria-label="Satellite"
              className={`flex-1 h-10 px-3 text-sm font-medium border-t border-b border-r flex items-center justify-center ${
                baseLayer === 'satellite'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Satellite className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onBaseLayerChange('osm')}
              title="Street map"
              aria-label="Street map"
              className={`flex-1 h-10 px-3 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center justify-center ${
                baseLayer === 'osm'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Navigation className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
