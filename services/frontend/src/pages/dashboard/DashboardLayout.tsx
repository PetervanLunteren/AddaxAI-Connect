/**
 * Dashboard shell: page header and the Overview / Explore tab strip.
 *
 * The two tabs are real routes, so deep links, the back button and
 * "open in new tab" all work. The current query string is carried across
 * when switching tabs, which is what keeps the filters in place. Both tabs
 * share one filter schema (see useDashboardFilters), so nothing is dropped.
 */
import React from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { SpeciesFilterHintBanner } from '../../components/dashboard';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
    isActive
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  );

export const DashboardLayout: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { search } = useLocation();
  const base = `/projects/${projectId}/dashboard`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          Project overview with statistics and trends. Observation counts are based on MaxN, the peak number of individuals per species visible in a single image within each event, summed across all events.
        </p>
      </div>

      {/* Species filtering hint (DeepFaune projects, admins, not yet narrowed) */}
      <SpeciesFilterHintBanner />

      <div className="flex border-b">
        {/* `end` is required, otherwise the Explore route would also mark
            this tab active. */}
        <NavLink end to={{ pathname: base, search }} className={tabClass}>
          Overview
        </NavLink>
        <NavLink to={{ pathname: `${base}/explore`, search }} className={tabClass}>
          Explore
        </NavLink>
      </div>

      <Outlet />
    </div>
  );
};
