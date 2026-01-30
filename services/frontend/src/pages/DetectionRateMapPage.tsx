/**
 * Detection rate map page
 * Shows camera deployments with effort-corrected detection rates
 */
import React from 'react';
import { DetectionRateMap } from '../components/map';

export const DetectionRateMapPage: React.FC = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold">Map</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Visualize camera deployments and detection rates spatially</p>
      <DetectionRateMap />
    </div>
  );
};
