/**
 * Dashboard shell: page header and the Overview / Explore tab strip.
 *
 * The two tabs are real routes, so deep links, the back button and
 * "open in new tab" all work. The current query string is carried across when
 * switching tabs, which is what keeps the Explore filters in place.
 *
 * Only Explore has filters. Overview always shows the whole project and never
 * reads the query string, so moving between the tabs cannot disturb what
 * Explore has selected, and Overview cannot end up filtered by a control it
 * does not show.
 */
import React from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { SpeciesFilterHintBanner } from '../../components/dashboard';

// One line per tab, because the two tabs answer different questions. How the
// numbers are counted is explained on the card it applies to, not here.
const CAPTIONS = {
  overview: 'The state of the project, across all species.',
  explore: 'One species at a time, over a date range you choose.',
} as const;

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
    isActive
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  );

export const DashboardLayout: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { pathname, search } = useLocation();
  const base = `/projects/${projectId}/dashboard`;
  const onExplore = pathname.endsWith('/explore');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-0">Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          {onExplore ? CAPTIONS.explore : CAPTIONS.overview}
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
