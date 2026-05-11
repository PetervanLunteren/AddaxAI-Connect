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
            Each marker is one camera deployment, coloured by its detection rate
            (detections per trap-day). Markers fall on the deployment&apos;s recorded GPS
            location. Filter by species or date range using the controls inside the map.
          </p>
        }
        how={
          <p>
            Detection rate = detections in the window / trap-days, where trap-days =
            (end_date - start_date + 1) for closed deployments, or
            (CURRENT_DATE - start_date + 1) for active ones. Person and vehicle detections
            are counted alongside animals; restrict via the species filter if you want a
            wildlife-only view.
          </p>
        }
        caveats={
          <p>
            Detection rates are not corrected for imperfect detection. Two cameras with the
            same trap-days but different effective detection probabilities will show
            different rates even at equal true densities. The map is a relative-effort view,
            not an abundance estimate.
          </p>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
