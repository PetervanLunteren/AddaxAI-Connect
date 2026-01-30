/**
 * Detection rate map page
 * Shows camera deployments with effort-corrected detection rates
 */
import React from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { DetectionRateMap } from '../components/map';

export const DetectionRateMapPage: React.FC = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Map</h1>

      <Card>
        <CardContent>
          <DetectionRateMap />
        </CardContent>
      </Card>
    </div>
  );
};
