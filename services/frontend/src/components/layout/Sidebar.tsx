/**
 * Sidebar navigation component
 */
import React, { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Camera,
  LayoutDashboard,
  Images,
  Bell,
  Download,
  FileText,
  X,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Users,
  Settings,
  Map,
  ListChecks,
  Upload,
  BarChart3,
  Grid3x3,
  Lightbulb,
  GanttChartSquare,
  LineChart,
  Table2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useProject } from '../../contexts/ProjectContext';
import { cn } from '../../lib/utils';
import { LastUpdate } from '../LastUpdate';
import { bulkUploadApi, type BulkUploadJob } from '../../api/bulkUpload';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { selectedProject, isServerAdmin, isProjectAdmin } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const [adminToolsOpen, setAdminToolsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);

  // Navigation items (all project-specific). Map and Performance now live
  // under the collapsible Insights group below.
  const navItems = [
    { to: `/projects/${projectId}/dashboard`, icon: LayoutDashboard, label: 'Dashboard' },
    { to: `/projects/${projectId}/cameras`, icon: Camera, label: 'Cameras' },
    { to: `/projects/${projectId}/images`, icon: Images, label: 'Images' },
    { to: `/projects/${projectId}/notifications`, icon: Bell, label: 'Notifications' },
    { to: `/projects/${projectId}/exports`, icon: Download, label: 'Exports' },
    { to: `/projects/${projectId}/documents`, icon: FileText, label: 'Documents' },
  ];

  // Insights group - deeper analytical views, ordered + iconed identically
  // to AddaxAI WebUI's Insights submenu so the two products feel the same
  // here. Naive occupancy is Connect-only (WebUI does not have it) and
  // appears last in the group.
  const insightsItems = [
    { to: `/projects/${projectId}/insights/map`, icon: Map, label: 'Map' },
    { to: `/projects/${projectId}/insights/deployment-timeline`, icon: GanttChartSquare, label: 'Timeline' },
    { to: `/projects/${projectId}/insights/activity-overlap`, icon: LineChart, label: 'Activity overlap' },
    { to: `/projects/${projectId}/insights/confusion-matrix`, icon: Grid3x3, label: 'Confusion matrix' },
    { to: `/projects/${projectId}/insights/per-class-performance`, icon: Table2, label: 'Performance' },
    { to: `/projects/${projectId}/insights/naive-occupancy`, icon: BarChart3, label: 'Naive occupancy' },
  ];

  // Background poll for in-flight bulk-upload jobs so we can badge
  // the admin entry. Fast tick (5 s) when a job is actively
  // uploading or processing so the badge updates in near-real-time.
  // Stretch to 5 min when idle: badge changes are rare in that
  // state and the only consequence of a slow refresh is the user
  // missing the start of a fresh upload they themselves did not
  // initiate. Anyone starting their own upload triggers an
  // immediate query invalidation, so they never wait.
  const numericProjectId = projectId ? Number(projectId) : undefined;
  const { data: bulkJobs } = useQuery({
    queryKey: ['bulk-upload-jobs', numericProjectId],
    queryFn: () => bulkUploadApi.list(numericProjectId!),
    enabled: numericProjectId !== undefined && isProjectAdmin,
    refetchInterval: (q) => {
      const data = q.state.data as BulkUploadJob[] | undefined;
      const anyInFlight = (data ?? []).some(
        (j) => j.status === 'uploading' || j.status === 'processing',
      );
      return anyInFlight ? 5000 : 300000;
    },
  });
  const inFlightBulkCount = (bulkJobs ?? []).filter(
    (j) => j.status === 'uploading' || j.status === 'processing',
  ).length;

  // Admin tools - visible to project admins and server admins. The
  // bulk-upload entry carries a live badge with the number of jobs in
  // flight so users notice work in progress from any page.
  const adminTools = [
    { to: `/projects/${projectId}/settings`, icon: Settings, label: 'Settings' },
    { to: `/projects/${projectId}/users`, icon: Users, label: 'Users', requiresAdmin: true },
    { to: `/projects/${projectId}/manage-images`, icon: ListChecks, label: 'Curation' },
    {
      to: `/projects/${projectId}/bulk-upload`,
      icon: Upload,
      label: 'Bulk upload',
      badge: inFlightBulkCount > 0 ? inFlightBulkCount : undefined,
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex flex-col h-[100dvh] w-64 bg-card border-r border-border transition-transform duration-300',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-20 px-6 border-b border-border shrink-0">
          <div className="flex items-center space-x-3">
            <img src="/logo-wide.png" alt="AddaxAI Connect" className="h-[54px] w-auto" />
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-2 hover:bg-accent rounded-md"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1 mt-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-4 py-3 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {/* Insights section (collapsible) */}
          <div className="mt-2">
            <button
              onClick={() => setInsightsOpen(!insightsOpen)}
              className="flex items-center justify-between w-full px-4 py-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Lightbulb className="h-5 w-5" />
                <span>Insights</span>
              </div>
              {insightsOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {insightsOpen && (
              <div className="ml-4 mt-1 space-y-1">
                {insightsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center space-x-3 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          {/* Admin Tools Section (project admin or server admin) */}
          {isProjectAdmin && (
            <div className="mt-2">
              <button
                onClick={() => setAdminToolsOpen(!adminToolsOpen)}
                className="flex items-center justify-between w-full px-4 py-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <ShieldAlert className="h-5 w-5" />
                  <span>Admin tools</span>
                </div>
                {adminToolsOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              {/* Admin Tools Submenu */}
              {adminToolsOpen && (
                <div className="ml-4 mt-1 space-y-1">
                  {adminTools.map((tool) => (
                    <NavLink
                      key={tool.to}
                      to={tool.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center justify-between space-x-3 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )
                      }
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <tool.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{tool.label}</span>
                      </div>
                      {(tool as { badge?: number }).badge !== undefined && (
                        <span
                          className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: '#71b7ba', color: 'white' }}
                        >
                          {(tool as { badge?: number }).badge}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Bottom section with project info, Last Update, and User info */}
        <div className="shrink-0 bg-card">
          {/* Current Project Display with Back to Projects */}
          {selectedProject && (
            <div className="px-4 py-3 border-t border-border bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">Current project</p>
                <NavLink
                  to="/projects"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </NavLink>
              </div>
              <p className="truncate text-sm font-semibold">
                {selectedProject.name}
              </p>
            </div>
          )}

          {/* Last Update Widget */}
          <LastUpdate />
        </div>
      </aside>
    </>
  );
};

