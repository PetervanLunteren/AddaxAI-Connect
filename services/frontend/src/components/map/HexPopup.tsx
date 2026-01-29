/**
 * Popup component for hexbin cells
 * Shows aggregated metrics and list of cameras in the hex
 */
import type { HexCell } from '../../utils/hex-grid';

interface HexPopupProps {
  hexCell: HexCell;
}

export function HexPopup({ hexCell }: HexPopupProps) {
  const {
    trap_days,
    detection_count,
    detection_rate_per_100,
    camera_count,
    deployments,
  } = hexCell;

  return (
    <div className="p-2 min-w-[280px] max-w-[400px]">
      {/* Aggregated metrics */}
      <div className="mb-3 pb-2 border-b border-gray-200">
        <div className="font-semibold text-gray-900 mb-1">aggregated metrics</div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">cameras:</span>
            <span className="font-medium">{camera_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">total trap-days:</span>
            <span className="font-medium">{trap_days}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">total detections:</span>
            <span className="font-medium">{detection_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">detection rate:</span>
            <span className="font-medium">{detection_rate_per_100.toFixed(2)} / 100 trap-days</span>
          </div>
        </div>
      </div>

      {/* List of deployments */}
      <div>
        <div className="font-semibold text-gray-900 mb-2">
          {deployments.length === 1 ? 'deployment' : 'deployments'} ({deployments.length})
        </div>
        <div className="max-h-[200px] overflow-y-auto space-y-2">
          {deployments.map((deployment) => {
            const { camera_name, deployment_id, trap_days, detection_count, detection_rate_per_100 } =
              deployment.properties;
            const isZeroDetections = detection_count === 0;

            return (
              <div
                key={`${deployment.properties.camera_id}-${deployment_id}`}
                className="p-2 bg-gray-50 rounded text-xs space-y-1"
              >
                <div className="font-medium text-gray-900">{camera_name}</div>
                <div className="text-gray-600">deployment #{deployment_id}</div>
                <div className="flex justify-between text-gray-700">
                  <span>trap-days: {trap_days}</span>
                  <span>
                    detections: {detection_count}
                    {isZeroDetections && <span className="text-gray-500 ml-1">(empty)</span>}
                  </span>
                </div>
                {!isZeroDetections && (
                  <div className="text-gray-700">
                    rate: {detection_rate_per_100.toFixed(2)} / 100 trap-days
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
