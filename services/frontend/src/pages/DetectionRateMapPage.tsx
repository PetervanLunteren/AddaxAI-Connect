/**
 * Detection rate map page
 * Shows camera deployments with effort-corrected detection rates
 */
import React from 'react';
import { MapPin } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { DetectionRateMap } from '../components/map';

export const DetectionRateMapPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MapPin className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Detection rate map</h1>
          <p className="text-gray-600">
            Camera deployments with effort-corrected detection rates
          </p>
        </div>
      </div>

      <Card>
        <CardContent>
          <DetectionRateMap />
        </CardContent>
      </Card>
    </div>
  );
};
