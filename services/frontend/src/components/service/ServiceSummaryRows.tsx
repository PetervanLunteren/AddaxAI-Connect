/**
 * Service summary lines for the camera and site slide-outs.
 *
 * The slide-outs only summarise; the Service page is where service is
 * listed and changed, so the last line links there, filtered to this
 * camera or site. Reads the same cached lists as the page.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { serviceApi, serviceKeys } from '../../api/service';
import { formatServiceDate } from '../../lib/service-actions';

interface ServiceSummaryRowsProps {
  projectId: number;
  by: 'camera' | 'site';
  id: number;
  /** The camera's own last service date. Omitted for a site, where it is
   * taken from the visits at that site. */
  lastService?: string | null;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right">{children}</span>
  </div>
);

export const ServiceSummaryRows: React.FC<ServiceSummaryRowsProps> = ({ projectId, by, id, lastService }) => {
  const matches = (row: { camera_id: number; site_id: number | null }) =>
    by === 'camera' ? row.camera_id === id : row.site_id === id;

  const { data: tasks } = useQuery({
    queryKey: serviceKeys.tasks(projectId),
    queryFn: () => serviceApi.listTasks(projectId),
  });
  const { data: visits } = useQuery({
    queryKey: serviceKeys.visits(projectId),
    queryFn: () => serviceApi.listVisits(projectId),
    enabled: lastService === undefined,
  });

  // Visits arrive newest first, so the first match is the latest.
  const last = lastService !== undefined ? lastService : (visits?.find(matches)?.event_date ?? null);
  const open = (tasks ?? []).filter(matches);
  // Tasks arrive sorted by due date, so the first dated one is the next due.
  const nextDue = open.find((t) => t.due_date)?.due_date;

  return (
    <>
      <Row label="Last service">{last ? formatServiceDate(last) : '-'}</Row>
      <Row label="Open service tasks">
        {open.length === 0 ? 'None' : nextDue ? `${open.length}, next due ${formatServiceDate(nextDue)}` : open.length}
      </Row>
      <Row label="Service history">
        <Link to={`/projects/${projectId}/service?${by}=${id}`} className="text-primary hover:underline">
          Show
        </Link>
      </Row>
    </>
  );
};
