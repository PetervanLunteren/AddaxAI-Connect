/**
 * Camera map controls component
 * Provides the color-by selector as segmented buttons. The base-layer switch
 * lives in the map itself (BaseLayersControl), shared with every other map.
 */
import { Activity, Battery, Signal } from 'lucide-react';
import type { ColorByMetric } from '../../utils/camera-colors';

interface CameraMapControlsProps {
  colorBy: ColorByMetric;
  onColorByChange: (value: ColorByMetric) => void;
}

export function CameraMapControls({
  colorBy,
  onColorByChange,
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
              title="Status"
              aria-label="Status"
              className={`flex-1 h-10 px-3 text-sm font-medium rounded-l-md border flex items-center justify-center ${
                colorBy === 'status'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Activity className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onColorByChange('battery')}
              title="Battery"
              aria-label="Battery"
              className={`flex-1 h-10 px-3 text-sm font-medium border-t border-b border-r flex items-center justify-center ${
                colorBy === 'battery'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Battery className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onColorByChange('signal')}
              title="Signal"
              aria-label="Signal"
              className={`flex-1 h-10 px-3 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center justify-center ${
                colorBy === 'signal'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Signal className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Empty columns 2-4 keep the color-by control left-aligned */}
        <div className="hidden md:block" />
        <div className="hidden md:block" />
        <div className="hidden md:block" />
      </div>
    </div>
  );
}
