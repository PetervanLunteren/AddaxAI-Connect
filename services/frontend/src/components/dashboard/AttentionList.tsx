/**
 * What is broken, with a link to the page that fixes it.
 *
 * This replaces the camera activity doughnut. Camera health is a status
 * question, "which ones stopped and when", not a proportion question, and a
 * ring drawn from three numbers answered neither. Each row names the problem
 * in the row itself, so colour is a second signal rather than the only one.
 *
 * Only things a person can act on belong here. Two rows were removed after
 * review because they were facts, not faults:
 *
 * The share of empty images. On a camera trap network most triggers are
 * branches and weather, and 50 to 85 percent empty is ordinary. It is a
 * property of the data, not a problem to solve.
 *
 * The share of verified images. The product classifies images automatically
 * and verifying is optional, so a low number is a choice rather than a
 * failure. Nagging about it misrepresents what the software is for.
 *
 * Both are still on the dashboard as plain stat tiles, which is the right
 * place for a fact.
 *
 * A project with nothing wrong gets a single calm line instead of an empty
 * card. That is the normal state and it should look normal.
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
