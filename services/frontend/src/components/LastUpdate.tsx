/**
 * LastUpdate component - shows time since last classified image
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { statisticsApi } from '../api/statistics';
import { useProject } from '../contexts/ProjectContext';

/**
 * Format a date as relative time string
 * @param date - ISO date string, EXIF format string (YYYY:MM:DD HH:MM:SS), or Date object
 * @returns Relative time string like "5s ago", "2m ago", "1h ago", etc.
 */
const formatRelativeTime = (date: string | Date): string => {
  const now = new Date();
  const then = new Date(date);
  const diffSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (diffSeconds < 0) {
    return 'just now';
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // Format as date for > 7 days
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const LastUpdate: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const { data } = useQuery({
    queryKey: ['last-update', projectId],
    queryFn: () => statisticsApi.getLastUpdate(projectId),
    enabled: projectId !== undefined,
    refetchInterval: 15000, // Refresh every 15 seconds
    retry: false, // Don't retry on failure, just keep showing last value
    staleTime: 10000, // Consider data stale after 10 seconds
  });

  // Show nothing if no data yet (component loading)
  if (!data) {
    return null;
  }

  // Show "No updates yet" if no images exist
  if (!data.last_update) {
    return (
      <div className="px-4 py-3 border-t border-border">
        <p className="text-xs text-muted-foreground">No updates yet</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-border">
      <p className="text-xs text-muted-foreground">
        Last update: {formatRelativeTime(data.last_update)}
      </p>
    </div>
  );
};
