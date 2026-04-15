/**
 * LastUpdate component - shows time since last classified image
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { statisticsApi } from '../api/statistics';
import { useProject } from '../contexts/ProjectContext';
import { formatRelative } from '../utils/datetime';

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
        Last update: {formatRelative(data.last_update)}
      </p>
    </div>
  );
};
