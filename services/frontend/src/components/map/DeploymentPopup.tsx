/**
 * Deployment popup component
 * Shows deployment details when marker is clicked
 */
import type { DeploymentFeatureProperties } from '../../api/types';

interface DeploymentPopupProps {
  properties: DeploymentFeatureProperties;
}

export function DeploymentPopup({ properties }: DeploymentPopupProps) {
  const {
    camera_name,
    deployment_id,
    start_date,
    end_date,
    trap_days,
    detection_count,
    detection_rate_per_100,
  } = properties;

  const isActive = end_date === null;

  return (
    <div className="p-1 min-w-[200px]">
      <div className="font-semibold text-base mb-2">
        {camera_name}
        {deployment_id > 1 && (
          <span className="text-sm text-gray-500 ml-1">
            (deployment {deployment_id})
          </span>
        )}
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">period:</span>
          <span className="font-medium">
            {start_date} — {end_date || 'active'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">trap-days:</span>
          <span className="font-medium">{trap_days}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">detections:</span>
          <span className="font-medium">{detection_count}</span>
        </div>

        <div className="flex justify-between border-t pt-1 mt-1">
          <span className="text-gray-600">rate:</span>
          <span className="font-semibold">
            {detection_rate_per_100.toFixed(2)} / 100 trap-days
          </span>
        </div>

        {isActive && (
          <div className="mt-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
            currently active
          </div>
        )}
      </div>
    </div>
  );
}
