/**
 * Camera map controls component
 * Provides color-by selector and base layer toggle as segmented buttons
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        {/* Color-by segmented button */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Color by
          </label>
          <div className="flex w-full rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => onColorByChange('status')}
              className={`flex-1 h-10 px-2 text-sm font-medium rounded-l-md border flex items-center justify-center ${
                colorBy === 'status'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Status
            </button>
            <button
              type="button"
              onClick={() => onColorByChange('battery')}
              className={`flex-1 h-10 px-2 text-sm font-medium border-t border-b border-r flex items-center justify-center ${
                colorBy === 'battery'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Battery
            </button>
            <button
              type="button"
              onClick={() => onColorByChange('signal')}
              className={`flex-1 h-10 px-2 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center justify-center ${
                colorBy === 'signal'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Signal
            </button>
          </div>
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

        {/* Empty columns 3 and 4 */}
        <div className="hidden md:block" />
        <div className="hidden md:block" />
      </div>
    </div>
  );
}
