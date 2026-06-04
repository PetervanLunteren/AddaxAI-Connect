/**
 * Site popup for the detection-rate map. Shows a site's pooled detection rate
 * (over all its deployments) when its point is clicked.
 */
import type { SiteFeatureProperties } from '../../api/types';

interface SitePopupProps {
  properties: SiteFeatureProperties;
}

export function SitePopup({ properties }: SitePopupProps) {
  const {
    site_name,
    deployment_count,
    first_date,
    last_date,
    trap_days,
    detection_count,
    detection_rate_per_100,
  } = properties;

  return (
    <div className="p-1 min-w-[200px]">
      <div className="font-semibold text-base mb-2">{site_name}</div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between border-b pb-1 mb-1">
          <span className="text-gray-600">Detection rate</span>
          <span className="font-semibold">
            {detection_rate_per_100.toFixed(2)} per 100 trap-days
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
          <span className="text-gray-600">Deployments pooled</span>
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
