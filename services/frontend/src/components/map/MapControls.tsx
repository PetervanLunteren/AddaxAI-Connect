/**
 * Map controls component
 * Provides filters for species and date range, and view mode selection
 */
import { useQuery } from '@tanstack/react-query';
import { Circle, Hexagon, Users, Map, Satellite, Navigation } from 'lucide-react';
import type { DetectionRateMapFilters } from '../../api/types';
import { Button } from '../ui/Button';
import { imagesApi } from '../../api/images';

interface MapControlsProps {
  filters: DetectionRateMapFilters;
  onFiltersChange: (filters: DetectionRateMapFilters) => void;
  viewMode: 'points' | 'hexbins' | 'clusters';
  onViewModeChange: (mode: 'points' | 'hexbins' | 'clusters') => void;
  baseLayer: string;
  onBaseLayerChange: (layer: string) => void;
}

export function MapControls({ filters, onFiltersChange, viewMode, onViewModeChange, baseLayer, onBaseLayerChange }: MapControlsProps) {
  const species = filters.species || '';
  const startDate = filters.start_date || '';
  const endDate = filters.end_date || '';

  // Fetch species for dropdown
  const { data: speciesOptions, isLoading: speciesLoading } = useQuery({
    queryKey: ['species'],
    queryFn: () => imagesApi.getSpecies(),
  });

  const handleSpeciesChange = (value: string) => {
    onFiltersChange({
      ...filters,
      species: value || undefined,
    });
  };

  const handleStartDateChange = (value: string) => {
    onFiltersChange({
      ...filters,
      start_date: value || undefined,
    });
  };

  const handleEndDateChange = (value: string) => {
    onFiltersChange({
      ...filters,
      end_date: value || undefined,
    });
  };

  return (
    <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
        {/* View mode selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            View mode
          </label>
          <div className="inline-flex rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => onViewModeChange('hexbins')}
              title="Hexbins"
              className={`px-3 py-2 text-sm font-medium rounded-l-md border flex items-center justify-center ${
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
              className={`px-3 py-2 text-sm font-medium border-t border-b border-r flex items-center justify-center ${
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
              className={`px-3 py-2 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center justify-center ${
                viewMode === 'clusters'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Users className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="species-filter" className="block text-sm font-medium text-gray-700 mb-1">
            Species
          </label>
          <select
            id="species-filter"
            value={species}
            onChange={(e) => handleSpeciesChange(e.target.value)}
            disabled={speciesLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-100"
          >
            <option value="">All species</option>
            {speciesOptions?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="start-date-filter" className="block text-sm font-medium text-gray-700 mb-1">
            Start date
          </label>
          <input
            id="start-date-filter"
            type="date"
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="end-date-filter" className="block text-sm font-medium text-gray-700 mb-1">
            End date
          </label>
          <input
            id="end-date-filter"
            type="date"
            value={endDate}
            onChange={(e) => handleEndDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Map style
          </label>
          <div className="inline-flex rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => onBaseLayerChange('positron')}
              title="Light"
              className={`px-3 py-2 text-sm font-medium rounded-l-md border flex items-center justify-center ${
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
              className={`px-3 py-2 text-sm font-medium border-t border-b border-r flex items-center justify-center ${
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
              className={`px-3 py-2 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center justify-center ${
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
