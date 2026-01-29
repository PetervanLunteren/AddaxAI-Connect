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
                Each point represents a camera deployment period. Detection rates are effort-corrected
                (detections per 100 trap-days) to account for varying deployment durations.
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Click markers to view deployment details</li>
                <li>Cameras with multiple deployments appear as separate points</li>
                <li>Hollow circles indicate zero detections</li>
                <li>Use filters to narrow results by species or date range</li>
              </ul>
            </div>

            <DetectionRateMap />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
