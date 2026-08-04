/**
 * What needs doing, with a link to the page that does it.
 *
 * This replaces the camera activity doughnut. Camera health is a status
 * question, "which ones stopped and when", not a proportion question, and a
 * ring drawn from three numbers answered neither. Rows are ordered worst
 * first and each one names the problem in the row itself, so the colour is a
 * second signal rather than the only one.
 *
 * A project with nothing wrong gets a single calm line instead of an empty
 * card.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';

type Severity = 'bad' | 'warn' | 'ok';

const PIP: Record<Severity, string> = {
  bad: 'bg-[#882000]',
  warn: 'bg-[#ff8945]',
  ok: 'bg-primary',
};

interface AttentionListProps {
  projectId?: number;
  siteIds?: string;
  /** Days without an upload before a camera counts as silent. */
  quietDays?: number;
}

interface Row {
  severity: Severity;
  title: string;
  detail: string;
  action?: { label: string; to: string };
}

export const AttentionList: React.FC<AttentionListProps> = ({
  projectId,
  siteIds,
  quietDays = 7,
}) => {
  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['statistics', 'activity', projectId, siteIds],
    queryFn: () => statisticsApi.getCameraActivity(projectId, siteIds),
    enabled: projectId !== undefined,
  });

  const { data: pipeline } = useQuery({
    queryKey: ['statistics', 'pipeline-status', projectId, siteIds],
    queryFn: () => statisticsApi.getPipelineStatus(projectId, siteIds),
    enabled: projectId !== undefined,
  });

  const { data: verification } = useQuery({
    queryKey: ['statistics', 'verification-progress-all', projectId, undefined, undefined, siteIds],
    queryFn: () => statisticsApi.getVerificationProgressAll(projectId!, { site_ids: siteIds }),
    enabled: projectId !== undefined,
  });

  const base = projectId !== undefined ? `/projects/${projectId}` : '';
  const rows: Row[] = [];

  if (activity) {
    const silent = activity.inactive + activity.never_reported;
    const total = activity.active + silent;
    if (silent > 0) {
      rows.push({
        severity: activity.active === 0 && total > 0 ? 'bad' : 'warn',
        title:
          silent === total
            ? `All ${total} cameras have gone quiet`
            : `${silent} of ${total} cameras have gone quiet`,
        detail: `No image in the last ${quietDays} days`,
        action: { label: 'Open cameras', to: `${base}/cameras` },
      });
    }
  }

  if (pipeline) {
    const withContent = pipeline.animal_count + pipeline.person_count + pipeline.vehicle_count;
    const total = withContent + pipeline.empty_count;
    // Empty images are the single largest cost in most projects and the
    // dashboard never mentioned them before. Only worth raising once they
    // dominate, otherwise it is noise on a healthy project.
    if (total > 0 && pipeline.empty_count / total >= 0.5) {
      const share = Math.round((pipeline.empty_count / total) * 100);
      rows.push({
        severity: 'warn',
        title: `${share}% of images have nothing in them`,
        detail: `${pipeline.empty_count.toLocaleString()} empty images, worth checking the trigger settings`,
        action: { label: 'Open images', to: `${base}/images?species=empty` },
      });
    }
  }

  const all = verification?.rows.find((r) => r.label === 'all');
  if (all && all.total > 0 && all.percentage < 100) {
    rows.push({
      severity: all.percentage < 25 ? 'warn' : 'ok',
      title: `${all.percentage}% of images verified`,
      detail: `${all.verified.toLocaleString()} of ${all.total.toLocaleString()} checked by a person`,
      action: { label: 'Verify', to: `${base}/images?verified=false` },
    });
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        {activityLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-3 py-3">
            <span className={`h-6 w-1.5 shrink-0 rounded-full ${PIP.ok}`} />
            <div>
              <p className="text-sm font-medium">Nothing needs attention</p>
              <p className="text-xs text-muted-foreground">
                Cameras are reporting and verification is complete
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <div key={row.title} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className={`h-8 w-1.5 shrink-0 rounded-full ${PIP[row.severity]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">{row.detail}</p>
                </div>
                {row.action && (
                  <Link
                    to={row.action.to}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    {row.action.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
