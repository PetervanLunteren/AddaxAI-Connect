/**
 * Insights -> Naive occupancy page.
 *
 * Page owns the header, filters (date range, camera tags), the download
 * action for the detection-history CSV, and the PlotExplainer. The chart
 * component just renders the bars.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Download, Info } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { camerasApi } from '../../api/cameras';
import { statisticsApi } from '../../api/statistics';
import type { NaiveOccupancyMetadata } from '../../api/types';
import { Button } from '../../components/ui/Button';
import type { Option } from '../../components/ui/MultiSelect';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import {
  DashboardFilters,
  type DateRange,
} from '../../components/dashboard';
import { NaiveOccupancyChart } from '../../components/dashboard/NaiveOccupancyChart';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
};

const REFERENCES: PlotReference[] = [
  {
    citation:
      'MacKenzie, D. I., Nichols, J. D., Lachman, G. B., Droege, S., Royle, J. A., & Langtimm, C. A. ' +
      '(2002). Estimating site occupancy rates when detection probabilities are less than one. ' +
      'Ecology, 83(8), 2248–2255.',
    url: 'https://esajournals.onlinelibrary.wiley.com/doi/10.1890/0012-9658(2002)083[2248:ESORWD]2.0.CO;2',
  },
  {
    citation:
      'Niedballa, J., Sollmann, R., Courtiol, A., & Wilting, A. (2016). camtrapR: ' +
      'An R package for efficient camera trap data management. Methods in Ecology and Evolution, 7(12), 1457–1462.',
    url: 'https://besjournals.onlinelibrary.wiley.com/doi/10.1111/2041-210X.12600',
  },
];

export const NaiveOccupancyPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const dateRange: DateRange = useMemo(
    () => ({
      startDate: (parsed.date_from as string) || null,
      endDate: (parsed.date_to as string) || null,
    }),
    [parsed.date_from, parsed.date_to],
  );
  const tagValues: string[] = useMemo(
    () => (Array.isArray(parsed.tags) ? parsed.tags : []),
    [parsed.tags],
  );

  const setDateRange = (range: DateRange) => {
    const next = filtersToSearchParams(
      {
        date_from: range.startDate ?? undefined,
        date_to: range.endDate ?? undefined,
        tags: tagValues,
      },
      FILTER_SCHEMA,
    );
    setSearchParams(next, { replace: true });
  };
  const setTags = (tags: Option[]) => {
    const next = filtersToSearchParams(
      {
        date_from: dateRange.startDate ?? undefined,
        date_to: dateRange.endDate ?? undefined,
        tags: tags.map((t) => String(t.value)),
      },
      FILTER_SCHEMA,
    );
    setSearchParams(next, { replace: true });
  };

  const selectedTags: Option[] = tagValues.map((v) => ({ label: v, value: v }));

  // Fetch cameras to map tags -> camera ids (same pattern as Dashboard)
  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
    enabled: projectId !== undefined,
  });

  const cameraIdsFromTags = useMemo(() => {
    if (tagValues.length === 0 || !cameras) return undefined;
    const tagSet = new Set(tagValues);
    const matchingIds = cameras
      .filter((c) => c.tags?.some((tag) => tagSet.has(tag)))
      .map((c) => c.id);
    return matchingIds.join(',') || '0';
  }, [tagValues, cameras]);

  const [meta, setMeta] = useState<NaiveOccupancyMetadata | null>(null);

  const downloadDisabled = !projectId || !dateRange.startDate || !dateRange.endDate;
  const downloadUrl =
    !downloadDisabled && projectId
      ? statisticsApi.getDetectionHistoryCsvUrl(
          projectId,
          dateRange.startDate as string,
          dateRange.endDate as string,
          { cameraIds: cameraIdsFromTags, occasionLengthDays: 1 },
        )
      : '#';

  const captionWindow =
    meta?.window_start && meta?.window_end ? `${meta.window_start} to ${meta.window_end}` : '';
  const subtitle = 'Sites where each species was detected at least once / total active sites';

  return (
    <InsightsPageLayout
      title="Naive occupancy"
      subtitle={subtitle}
      actions={
        <a
          href={downloadDisabled ? undefined : downloadUrl}
          aria-disabled={downloadDisabled}
          onClick={(e) => downloadDisabled && e.preventDefault()}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={downloadDisabled}
            className="gap-1"
            title={
              downloadDisabled
                ? 'Pick an explicit date range to download the detection history'
                : 'Download sites by occasions detection history (CSV)'
            }
          >
            <Download className="h-4 w-4" />
            Detection history (CSV)
          </Button>
        </a>
      }
    >
      <div className="flex items-center justify-end gap-2">
        <DashboardFilters
          tags={selectedTags}
          onTagsChange={setTags}
          tagOptions={tagOptions || []}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <NaiveOccupancyChart
          dateRange={dateRange}
          projectId={projectId}
          cameraIds={cameraIdsFromTags}
          onMetadataChange={setMeta}
        />
        {meta && (
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>n = {meta.sites_total} active sites</span>
            {captionWindow && (
              <>
                <span aria-hidden="true">·</span>
                <span>Window {captionWindow}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Uncorrected for detection probability</span>
          </div>
        )}
      </div>
      <PlotExplainer
        plotKey="naive-occupancy"
        what={
          <p>
            For each species, the proportion of sampled camera sites where it was detected at least
            once in the window. Bars are ranked descending and labelled with raw{' '}
            <code>n_detected / n_total</code> so small samples are visible at a glance.
          </p>
        }
        how={
          <>
            <p>
              Site = camera. A camera counts as active in the window if any deployment period
              overlaps the window, even by a single day. Person and vehicle detections are excluded.
              Independence interval is not applied because binary presence at the (site, window)
              level is independence-immune.
            </p>
            <p>
              The unverified-image path gates on the project&apos;s detection-confidence threshold
              and the per-species classification threshold. Verified human observations override AI
              for the same image.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              Naive occupancy is biased low when detection probability is less than one. For an
              estimated occupancy &psi; that corrects for imperfect detection, run the
              detection-history CSV through R&apos;s <code>unmarked::occu()</code> or{' '}
              <code>camtrapR</code>.
            </p>
            <p>
              A camera that physically moved across deployments is counted as one site here, not
              two locations. Camtrap-DP&apos;s <code>locationID</code> is a future enhancement.
            </p>
          </>
        }
        settings={
          meta
            ? [
                ...(meta.detection_threshold !== null
                  ? [
                      {
                        label: 'Detection threshold',
                        detail: `${meta.detection_threshold} (sub-threshold detections are dropped before counting).`,
                      },
                    ]
                  : []),
                ...(meta.classification_threshold_default !== null
                  ? [
                      {
                        label: 'Classification threshold default',
                        detail: `${meta.classification_threshold_default} (per-species overrides applied where set).`,
                      },
                    ]
                  : []),
                {
                  label: 'Independence interval',
                  detail: `${meta.independence_interval_minutes_recorded} min on the project, declared but not applied to binary presence.`,
                },
              ]
            : undefined
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
