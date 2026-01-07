/**
 * User Project Assignment Page
 *
 * Allows superusers to assign users to projects
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';
import { projectsApi } from '../../api/projects';

export const UserAssignmentPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [assigningUserId, setAssigningUserId] = useState<number | null>(null);

  // Queries
  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminApi.listUsers,
  });

  const { data: projects, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.getAll,
  });

  // User assignment mutation
  const assignMutation = useMutation({
    mutationFn: ({ userId, projectId }: { userId: number; projectId: number | null }) =>
      adminApi.assignUserToProject(userId, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setAssigningUserId(null);
    },
    onError: (error: any) => {
      alert(`Failed to assign user: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleAssignUser = (userId: number, projectId: number | null) => {
    setAssigningUserId(userId);
    assignMutation.mutate({ userId, projectId });
  };

  return (
    <ServerPageLayout
      title="User Project Assignment"
      description="Assign users to projects. Regular users can only access their assigned project."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <CardTitle>User Assignments</CardTitle>
          </div>
          <CardDescription>
            Manage which users have access to which projects
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsers || isLoadingProjects ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Email</th>
                    <th className="text-left py-2 px-2">Role</th>
                    <th className="text-left py-2 px-2">Assigned Project</th>
                    <th className="text-left py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((user) => (
                    <tr key={user.id} className="border-b last:border-0">
                      <td className="py-3 px-2">{user.email}</td>
                      <td className="py-3 px-2">
                        {user.is_superuser ? (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                            Superuser
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            User
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        {user.is_superuser ? (
                          <span className="text-muted-foreground text-sm">All projects</span>
                        ) : user.project_name ? (
                          <span className="font-medium">{user.project_name}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">No project assigned</span>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        {!user.is_superuser && (
                          <select
                            value={user.project_id || ''}
                            onChange={(e) => {
                              const projectId = e.target.value ? parseInt(e.target.value) : null;
                              handleAssignUser(user.id, projectId);
                            }}
                            disabled={assignMutation.isPending && assigningUserId === user.id}
                            className="text-sm border rounded px-2 py-1 min-w-[180px]"
                          >
                            <option value="">No project</option>
                            {projects?.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </ServerPageLayout>
  );
};
