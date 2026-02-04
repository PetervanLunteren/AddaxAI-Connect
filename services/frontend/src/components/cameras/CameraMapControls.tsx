/**
 * Camera map controls component
 * Provides color-by selector and base layer toggle
 */
import { Map, Satellite, Navigation } from 'lucide-react';
import type { ColorByMetric } from '../../utils/camera-colors';

interface CameraMapControlsProps {
  colorBy: ColorByMetric;
  onColorByChange: (value: ColorByMetric) => void;
  baseLayer: string;
  onBaseLayerChange: (layer: string) => void;
}

export function CameraMapControls({
  colorBy,
  onColorByChange,
  baseLayer,
  onBaseLayerChange,
}: CameraMapControlsProps) {
  return (
    <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
        {/* Color-by selector */}
        <div>
          <label
            htmlFor="color-by"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Color by
          </label>
          <select
            id="color-by"
            value={colorBy}
            onChange={(e) => onColorByChange(e.target.value as ColorByMetric)}
            className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="status">Status</option>
            <option value="battery">Battery</option>
            <option value="signal">Signal</option>
          </select>
        </div>

        {/* Base layer toggle */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
