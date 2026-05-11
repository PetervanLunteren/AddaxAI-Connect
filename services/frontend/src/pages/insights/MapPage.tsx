/**
 * Insights -> Map page (detection-rate map).
 *
 * Thin wrapper that places the existing DetectionRateMap component inside
 * the shared Insights page shell with a PlotExplainer below. The map
 * renderer keeps its own internal filter UI for now; URL-synced filters
 * land when the map is touched again.
 */
import React from 'react';
import { DetectionRateMap } from '../../components/map';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';

const REFERENCES: PlotReference[] = [
  {
    citation:
      "Rovero, F., & Marshall, A. R. (2009). Camera trapping photographic rate as an index of " +
      "density in forest ungulates. Journal of Applied Ecology, 46(5), 1011–1017.",
    url: 'https://besjournals.onlinelibrary.wiley.com/doi/10.1111/j.1365-2664.2009.01705.x',
  },
];

export const InsightsMapPage: React.FC = () => {
  return (
    <InsightsPageLayout
      title="Map"
      subtitle="Detection rate per camera deployment, corrected for trap-days"
    >
      <div className="rounded-lg border bg-card p-4">
        <DetectionRateMap />
      </div>
      <PlotExplainer
        plotKey="detection-rate-map"
        what={
          <p>
            One coloured cell per camera deployment, mapped to the deployment&apos;s
            recorded GPS. Three view modes choose how the cells are drawn: hexbins
            aggregate nearby deployments onto a hex grid, points show each deployment
            individually, and clusters group nearby points into a single circle with
            the count inside. The species and camera-tag filters narrow which
            detections and which sites enter the calculation.
          </p>
        }
        how={
          <p>
            Detection rate = detections in the window divided by the days the camera
            was deployed. Active deployments count up to today. Detections below the
            project&apos;s confidence threshold are dropped, and a human-verified
            image always wins over the AI. Colours rescale to fit the cells currently
            in view, not a fixed scale across projects.
          </p>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
