/**
 * Site popup for the detection-rate map. Shows the selected metric for a site
 * plus the fixed context rows (detections, trap-days, coverage). Trap-days
 * always stay visible so effort-sensitive metrics like richness can be judged
 * honestly.
 */
import type { SiteFeatureProperties } from '../../api/types';
import type { MapMetric } from '../../utils/map-metrics';

interface SitePopupProps {
  properties: SiteFeatureProperties;
  metric: MapMetric;
}

export function SitePopup({ properties, metric }: SitePopupProps) {
  const {
    site_name,
    deployment_count,
    first_date,
    last_date,
    trap_days,
    detection_count,
  } = properties;

  return (
    <div className="p-1 min-w-[200px]">
      <div className="font-semibold text-base mb-2">{site_name}</div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between border-b pb-1 mb-1">
          <span className="text-gray-600">{metric.label}</span>
          <span className="font-semibold">
            {metric.formatValue(metric.siteValue(properties))}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Detections</span>
          <span className="font-medium">{detection_count}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Trap-days</span>
          <span className="font-medium">{trap_days}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Placements pooled</span>
          <span className="font-medium">{deployment_count}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Covered</span>
          <span className="font-medium">
            {first_date} to {last_date || 'now'}
          </span>
        </div>
      </div>
    </div>
  );
}
