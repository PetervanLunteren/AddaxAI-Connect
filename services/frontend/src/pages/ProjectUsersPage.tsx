/**
 * Project Users Page
 *
 * Allows project admins to manage users in their project.
 * Server admins can also access this page.
 */
import React, { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus, Trash2, Edit2, Shield, Eye, Users as UsersIcon } from 'lucide-react';
import { projectsApi } from '../api/projects';
import { adminApi } from '../api/admin';
import { useProject } from '../contexts/ProjectContext';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/Select';
import { Label } from '../components/ui/Label';
import { useToast } from '../hooks/useToast';
import type { ProjectUserInfo, UserWithMemberships } from '../api/types';

export const ProjectUsersPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { canAdminCurrentProject, selectedProject } = useProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showRemoveUserModal, setShowRemoveUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ProjectUserInfo | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('project-viewer');

  // Redirect if user doesn't have admin access
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  // Fetch project users
  const { data: projectUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ['project-users', projectId],
    queryFn: () => projectsApi.getUsers(parseInt(projectId!)),
    enabled: !!projectId,
  });

  // Fetch all users (for add user dropdown) - server admin only
  const { data: allUsers } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => adminApi.listUsers(),
    enabled: showAddUserModal,
  });

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      projectsApi.addUser(parseInt(projectId!), userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-users', projectId] });
      toast({
        title: 'Success',
        description: 'User added to project',
      });
      setShowAddUserModal(false);
      setSelectedUserId(null);
      setSelectedRole('project-viewer');
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to add user',
        variant: 'destructive',
      });
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      projectsApi.updateUserRole(parseInt(projectId!), userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-users', projectId] });
      toast({
        title: 'Success',
        description: 'User role updated',
      });
      setShowEditRoleModal(false);
      setSelectedUser(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to update role',
        variant: 'destructive',
      });
    },
  });

  // Remove user mutation
  const removeUserMutation = useMutation({
    mutationFn: (userId: number) =>
      projectsApi.removeUser(parseInt(projectId!), userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-users', projectId] });
      toast({
        title: 'Success',
        description: 'User removed from project',
      });
      setShowRemoveUserModal(false);
      setSelectedUser(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.response?.data?.detail || 'Failed to remove user',
        variant: 'destructive',
      });
    },
  });

  const handleAddUser = () => {
    if (selectedUserId && selectedRole) {
      addUserMutation.mutate({ userId: selectedUserId, role: selectedRole });
    }
  };

  const handleUpdateRole = () => {
    if (selectedUser && selectedRole) {
      updateRoleMutation.mutate({ userId: selectedUser.user_id, role: selectedRole });
    }
  };

  const handleRemoveUser = () => {
    if (selectedUser) {
      removeUserMutation.mutate(selectedUser.user_id);
    }
  };

  const getRoleBadge = (role: string) => {
    const config = {
      'project-admin': { label: 'project admin', icon: UsersIcon, className: 'bg-blue-100 text-blue-700' },
      'project-viewer': { label: 'project viewer', icon: Eye, className: 'bg-gray-100 text-gray-700' },
      'server-admin': { label: 'server admin', icon: Shield, className: 'bg-purple-100 text-purple-700' },
    }[role] || { label: role, icon: Shield, className: 'bg-gray-100 text-gray-700' };

    const Icon = config.icon;

    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${config.className}`}>
        <Icon className="h-3 w-3" />
        <span>{config.label}</span>
      </div>
    );
  };

  // Filter users not already in project for add dropdown
  const availableUsers = allUsers?.filter(
    (user) => !projectUsers?.some((pu) => pu.user_id === user.id)
  ) || [];

  return (
    <div className="container mx-auto px-6 py-8 max-w-6xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Project Users</h2>
              <p className="text-muted-foreground mt-1">
                Manage user access to {selectedProject?.name}
              </p>
            </div>
            <Button onClick={() => setShowAddUserModal(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !projectUsers || projectUsers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No users in this project yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectUsers.map((user) => (
                  <TableRow key={user.user_id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {user.is_active && (
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-700">
                            Active
                          </span>
                        )}
                        {user.is_verified && (
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-700">
                            Verified
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(user.added_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedUser(user);
                            setSelectedRole(user.role);
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
                            setShowRemoveUserModal(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add User Modal */}
      <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User to Project</DialogTitle>
            <DialogDescription>
              Select a user and assign them a role in this project
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="user">User</Label>
              <Select
                value={selectedUserId?.toString()}
                onValueChange={(value) => setSelectedUserId(parseInt(value))}
              >
                <SelectTrigger id="user">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id.toString()}>
                      {user.email}
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
              onClick={() => setShowAddUserModal(false)}
              disabled={addUserMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={!selectedUserId || addUserMutation.isPending}
            >
              {addUserMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add User
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
              Change {selectedUser?.email}'s role in this project
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
              onClick={() => setShowEditRoleModal(false)}
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

      {/* Remove User Modal */}
      <Dialog open={showRemoveUserModal} onOpenChange={setShowRemoveUserModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User from Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {selectedUser?.email} from this project?
              They will lose all access to project data.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRemoveUserModal(false)}
              disabled={removeUserMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveUser}
              disabled={removeUserMutation.isPending}
            >
              {removeUserMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Remove User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
