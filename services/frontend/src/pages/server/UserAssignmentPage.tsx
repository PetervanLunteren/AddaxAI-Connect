/**
 * User Project Assignment Page
 *
 * Allows server admins to manage user project memberships and roles
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Loader2, Plus, Trash2, Edit2, Shield, Eye, Users as UsersIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { Label } from '../../components/ui/Label';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';
import { projectsApi } from '../../api/projects';
import { useToast } from '../../hooks/useToast';
import type { UserWithMemberships, ProjectMembershipInfo } from '../../api/types';

export const UserAssignmentPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState<UserWithMemberships | null>(null);
  const [showAddMembershipModal, setShowAddMembershipModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showRemoveMembershipModal, setShowRemoveMembershipModal] = useState(false);
  const [selectedMembership, setSelectedMembership] = useState<ProjectMembershipInfo | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('project-viewer');

  // Queries
  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminApi.listUsers,
  });

  const { data: projects, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.getAll,
  });

  // Add membership mutation
  const addMembershipMutation = useMutation({
    mutationFn: ({ userId, projectId, role }: { userId: number; projectId: number; role: string }) =>
      adminApi.addUserToProject(userId, projectId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: 'Success',
        description: 'User added to project',
      });
      setShowAddMembershipModal(false);
      setSelectedUser(null);
      setSelectedProjectId(null);
      setSelectedRole('project-viewer');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to add user to project',
        variant: 'destructive',
      });
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, projectId, role }: { userId: number; projectId: number; role: string }) =>
      adminApi.updateUserProjectRole(userId, projectId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: 'Success',
        description: 'User role updated',
      });
      setShowEditRoleModal(false);
      setSelectedMembership(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to update role',
        variant: 'destructive',
      });
    },
  });

  // Remove membership mutation
  const removeMembershipMutation = useMutation({
    mutationFn: ({ userId, projectId }: { userId: number; projectId: number }) =>
      adminApi.removeUserFromProject(userId, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: 'Success',
        description: 'User removed from project',
      });
      setShowRemoveMembershipModal(false);
      setSelectedMembership(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to remove user from project',
        variant: 'destructive',
      });
    },
  });

  const handleAddMembership = () => {
    if (selectedUser && selectedProjectId && selectedRole) {
      addMembershipMutation.mutate({
        userId: selectedUser.id,
        projectId: selectedProjectId,
        role: selectedRole,
      });
    }
  };

  const handleUpdateRole = () => {
    if (selectedUser && selectedMembership && selectedRole) {
      updateRoleMutation.mutate({
        userId: selectedUser.id,
        projectId: selectedMembership.project_id,
        role: selectedRole,
      });
    }
  };

  const handleRemoveMembership = () => {
    if (selectedUser && selectedMembership) {
      removeMembershipMutation.mutate({
        userId: selectedUser.id,
        projectId: selectedMembership.project_id,
      });
    }
  };

  const getRoleBadge = (role: string) => {
    const config = {
      'project-admin': { label: 'project admin', icon: UsersIcon, className: 'bg-blue-100 text-blue-700' },
      'project-viewer': { label: 'project viewer', icon: Eye, className: 'bg-gray-100 text-gray-700' },
    }[role] || { label: role, icon: Shield, className: 'bg-gray-100 text-gray-700' };

    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${config.className}`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </span>
    );
  };

  // Get available projects for adding membership (not already assigned to user)
  const getAvailableProjects = (user: UserWithMemberships) => {
    return projects?.filter(
      (project) => !user.project_memberships.some((m) => m.project_id === project.id)
    ) || [];
  };

  return (
    <ServerPageLayout
      title="User Project Assignment"
      description="Manage user access to projects. Users can have different roles in different projects."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <CardTitle>User Assignments</CardTitle>
          </div>
          <CardDescription>
            Manage which users have access to which projects and their roles
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsers || isLoadingProjects ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {users?.map((user) => (
                <div key={user.id} className="border rounded-lg p-4">
                  {/* User Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{user.email}</h3>
                        {user.is_server_admin && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            <Shield className="h-3 w-3" />
                            server admin
                          </span>
                        )}
                      </div>
                      {user.is_server_admin && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Has access to all projects
                        </p>
                      )}
                    </div>
                    {!user.is_server_admin && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedUser(user);
                          setShowAddMembershipModal(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add to Project
                      </Button>
                    )}
                  </div>

                  {/* Project Memberships */}
                  {!user.is_server_admin && (
                    <div className="space-y-2">
                      {user.project_memberships.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          No project assignments
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {user.project_memberships.map((membership) => (
                            <div
                              key={`${user.id}-${membership.project_id}`}
                              className="flex items-center justify-between bg-muted/30 rounded p-3"
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-medium">{membership.project_name}</span>
                                {getRoleBadge(membership.role)}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedUser(user);
                                    setSelectedMembership(membership);
                                    setSelectedRole(membership.role);
                                    setShowEditRoleModal(true);
                                  }}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedUser(user);
                                    setSelectedMembership(membership);
                                    setShowRemoveMembershipModal(true);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Membership Modal */}
      <Dialog open={showAddMembershipModal} onOpenChange={setShowAddMembershipModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User to Project</DialogTitle>
            <DialogDescription>
              Assign {selectedUser?.email} to a project with a specific role
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="project">Project</Label>
              <Select
                value={selectedProjectId?.toString()}
                onValueChange={(value) => setSelectedProjectId(parseInt(value))}
              >
                <SelectTrigger id="project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {selectedUser &&
                    getAvailableProjects(selectedUser).map((project) => (
                      <SelectItem key={project.id} value={project.id.toString()}>
                        {project.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="role">Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project-viewer">project viewer</SelectItem>
                  <SelectItem value="project-admin">project admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddMembershipModal(false);
                setSelectedUser(null);
                setSelectedProjectId(null);
              }}
              disabled={addMembershipMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddMembership}
              disabled={!selectedProjectId || addMembershipMutation.isPending}
            >
              {addMembershipMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add to Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Modal */}
      <Dialog open={showEditRoleModal} onOpenChange={setShowEditRoleModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update User Role</DialogTitle>
            <DialogDescription>
              Change {selectedUser?.email}'s role in {selectedMembership?.project_name}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="edit-role">Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project-viewer">project viewer</SelectItem>
                <SelectItem value="project-admin">project admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditRoleModal(false);
                setSelectedMembership(null);
              }}
              disabled={updateRoleMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateRole}
              disabled={updateRoleMutation.isPending}
            >
              {updateRoleMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Update Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Membership Modal */}
      <Dialog open={showRemoveMembershipModal} onOpenChange={setShowRemoveMembershipModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User from Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {selectedUser?.email} from {selectedMembership?.project_name}?
              They will lose all access to this project's data.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRemoveMembershipModal(false);
                setSelectedMembership(null);
              }}
              disabled={removeMembershipMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveMembership}
              disabled={removeMembershipMutation.isPending}
            >
              {removeMembershipMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Remove from Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ServerPageLayout>
  );
};
