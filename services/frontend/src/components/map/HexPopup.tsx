/**
 * Popup for a hexbin cell on the detection-rate map. Shows the cell's pooled
 * metrics and the sites inside it.
 */
import type { HexCell } from '../../utils/hex-grid';

interface HexPopupProps {
  hexCell: HexCell;
}

export function HexPopup({ hexCell }: HexPopupProps) {
  const { trap_days, detection_count, detection_rate_per_100, site_count, sites } =
    hexCell;

  return (
    <div className="p-2 min-w-[280px] max-w-[400px]">
      {/* Pooled metrics for the cell */}
      <div className="mb-3 pb-2 border-b border-gray-200">
        <div className="font-semibold text-gray-900 mb-1">This area</div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Sites</span>
            <span className="font-medium">{site_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Trap-days</span>
            <span className="font-medium">{trap_days}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Detections</span>
            <span className="font-medium">{detection_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Detection rate</span>
            <span className="font-medium">
              {detection_rate_per_100.toFixed(2)} per 100 trap-days
            </span>
          </div>
        </div>
      </div>

      {/* The sites pooled into this cell */}
      <div>
        <div className="font-semibold text-gray-900 mb-2">
          {sites.length === 1 ? 'Site' : 'Sites'} ({sites.length})
        </div>
        <div className="max-h-[200px] overflow-y-auto space-y-2">
          {sites.map((site) => {
            const { site_id, site_name, trap_days, detection_count, detection_rate_per_100 } =
              site.properties;
            const isZeroDetections = detection_count === 0;

            return (
              <div
                key={`site-${site_id}`}
                className="p-2 bg-gray-50 rounded text-xs space-y-1"
              >
                <div className="font-medium text-gray-900">{site_name}</div>
                <div className="flex justify-between text-gray-700">
                  <span>{trap_days} trap-days</span>
                  <span>
                    {detection_count} detections
                    {isZeroDetections && <span className="text-gray-500 ml-1">(none)</span>}
                  </span>
                </div>
                {!isZeroDetections && (
                  <div className="text-gray-700">
                    {detection_rate_per_100.toFixed(2)} per 100 trap-days
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
