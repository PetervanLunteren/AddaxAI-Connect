/**
 * Popup for a hexbin cell on the detection-rate map. Shows the cell's pooled
 * metric and the sites inside it. Trap-days stay visible on every metric so
 * effort-sensitive numbers like richness can be judged honestly.
 */
import type { HexCell } from '../../utils/hex-grid';
import type { MapMetric } from '../../utils/map-metrics';

interface HexPopupProps {
  hexCell: HexCell;
  metric: MapMetric;
  /** The cell's pooled metric value, computed by the layer. */
  value: number;
}

export function HexPopup({ hexCell, metric, value }: HexPopupProps) {
  const { trap_days, detection_count, site_count, sites } = hexCell;

  return (
    <div className="p-2 min-w-[280px] max-w-[400px]">
      {/* Pooled metrics for the cell */}
      <div className="mb-3 pb-2 border-b border-gray-200">
        <div className="font-semibold text-gray-900 mb-1">This area</div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">{metric.label}</span>
            <span className="font-medium">{metric.formatValue(value)}</span>
          </div>
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
        </div>
      </div>

      {/* The sites pooled into this cell */}
      <div>
        <div className="font-semibold text-gray-900 mb-2">
          {sites.length === 1 ? 'Site' : 'Sites'} ({sites.length})
        </div>
        <div className="max-h-[200px] overflow-y-auto space-y-2">
          {sites.map((site) => {
            const { site_id, site_name, trap_days, detection_count } =
              site.properties;
            const isEmpty = metric.isEmpty(site.properties);

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
                    {detection_count === 0 && <span className="text-gray-500 ml-1">(none)</span>}
                  </span>
                </div>
                {!isEmpty && (
                  <div className="text-gray-700">
                    {metric.formatValue(metric.siteValue(site.properties))}
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
