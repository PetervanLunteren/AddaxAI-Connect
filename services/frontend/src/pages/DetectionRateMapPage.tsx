/**
 * Detection rate map page
 * Shows camera deployments with effort-corrected detection rates
 */
import React from 'react';
import { MapPin } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { DetectionRateMap } from '../components/map';

export const DetectionRateMapPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MapPin className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">detection rate map</h1>
          <p className="text-gray-600">
            camera deployments with effort-corrected detection rates
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>deployment locations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              <p className="mb-2">
                Detection rates are effort-corrected (detections per 100 trap-days) to account for
                varying deployment durations. Choose between point markers or hexagonal aggregation views.
              </p>

              <div className="mb-3">
                <p className="font-semibold text-gray-700 mb-1">point view:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Each marker represents a single camera deployment period</li>
                  <li>Click markers to view individual deployment details</li>
                  <li>Hollow circles indicate zero detections</li>
                  <li>Best for viewing individual camera performance</li>
                </ul>
              </div>

              <div className="mb-3">
                <p className="font-semibold text-gray-700 mb-1">hexbin view:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Aggregates multiple deployments into hexagonal cells</li>
                  <li>Cell size adapts automatically as you zoom in/out</li>
                  <li>Click hexagons to see list of cameras and aggregated metrics</li>
                  <li>Best for identifying regional patterns with many cameras</li>
                  <li>Only cells containing cameras are shown (no interpolation)</li>
                </ul>
              </div>

              <p className="text-xs italic">
                Tip: Use filters to narrow results by species or date range in both views
              </p>
            </div>

            <DetectionRateMap />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
