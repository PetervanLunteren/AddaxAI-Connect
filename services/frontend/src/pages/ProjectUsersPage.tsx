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
import { useProject } from '../contexts/ProjectContext';
import { Card, CardContent } from '../components/ui/Card';
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
import { Select, SelectItem } from '../components/ui/Select';
import { Label } from '../components/ui/Label';
import type { ProjectUserInfo, UserWithMemberships } from '../api/types';

export const ProjectUsersPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { canAdminCurrentProject, selectedProject } = useProject();
  const queryClient = useQueryClient();

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showRemoveUserModal, setShowRemoveUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ProjectUserInfo | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('project-viewer');
  const [addUserEmail, setAddUserEmail] = useState<string>('');
  const [addUserRole, setAddUserRole] = useState<string>('project-viewer');

  // Fetch project users
  const { data: projectUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ['project-users', projectId],
    queryFn: () => projectsApi.getUsers(parseInt(projectId!)),
    enabled: !!projectId,
  });

  // Unified add user mutation (handles both existing users and new invitations)
  const addUserByEmailMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      projectsApi.addUserByEmail(parseInt(projectId!), { email, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-users', projectId] });
      setShowAddUserModal(false);
      setAddUserEmail('');
      setAddUserRole('project-viewer');
    },
    onError: (error: any) => {
      alert(`Failed to add user: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      projectsApi.updateUserRole(parseInt(projectId!), userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-users', projectId] });
      setShowEditRoleModal(false);
      setSelectedUser(null);
    },
    onError: (error: any) => {
      alert(`Failed to update role: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  // Remove user mutation
  const removeUserMutation = useMutation({
    mutationFn: (userId: number) =>
      projectsApi.removeUser(parseInt(projectId!), userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-users', projectId] });
      setShowRemoveUserModal(false);
      setSelectedUser(null);
    },
    onError: (error: any) => {
      alert(`Failed to remove user: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  // Redirect if user doesn't have admin access (must be after all hooks)
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  const handleAddUser = () => {
    if (addUserEmail && addUserRole) {
      addUserByEmailMutation.mutate({
        email: addUserEmail,
        role: addUserRole
      });
    }
  };

  const handleUpdateRole = () => {
    console.log('[DEBUG] handleUpdateRole called', {
      selectedUser,
      selectedRole,
      userId: selectedUser?.user_id
    });
    if (selectedUser && selectedUser.user_id && selectedRole) {
      console.log('[DEBUG] Calling updateRoleMutation with:', { userId: selectedUser.user_id, role: selectedRole });
      updateRoleMutation.mutate({ userId: selectedUser.user_id, role: selectedRole });
    } else {
      console.log('[DEBUG] Skipping mutation - missing data');
    }
  };

  const handleRemoveUser = () => {
    if (selectedUser && selectedUser.user_id) {
      removeUserMutation.mutate(selectedUser.user_id);
    }
  };

  const getRoleBadge = (role: string) => {
    const config = {
      'project-admin': { label: 'project admin', icon: UsersIcon, color: '#ff8945' },
      'project-viewer': { label: 'project viewer', icon: Eye, color: '#71b7ba' },
      'server-admin': { label: 'server admin', icon: Shield, color: '#0f6064' },
    }[role] || { label: role, icon: Shield, color: '#71b7ba' };

    const Icon = config.icon;

    return (
      <div
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
        style={{ backgroundColor: `${config.color}1a`, color: config.color }}
      >
        <Icon className="h-3 w-3" />
        <span>{config.label}</span>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-0">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage user access and permissions</p>
        </div>
        <Button onClick={() => setShowAddUserModal(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add user
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
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
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectUsers.map((user, index) => (
                  <TableRow key={user.user_id || `pending-${index}`}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      {user.is_registered ? (
                        <span
                          className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium"
                          style={{ backgroundColor: '#0f60641a', color: '#0f6064' }}
                        >
                          Yes
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium"
                          style={{ backgroundColor: '#8820001a', color: '#882000' }}
                        >
                          No
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {user.is_registered && user.is_active && (
                          <span
                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium"
                            style={{ backgroundColor: '#0f60641a', color: '#0f6064' }}
                          >
                            Active
                          </span>
                        )}
                        {user.is_registered && user.is_verified && (
                          <span
                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium"
                            style={{ backgroundColor: '#71b7ba1a', color: '#71b7ba' }}
                          >
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
                            console.log('[DEBUG] Edit button clicked for user:', { email: user.email, role: user.role, user_id: user.user_id });
                            setSelectedUser(user);
                            setSelectedRole(user.role);
                            console.log('[DEBUG] Set selectedRole to:', user.role);
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

      {/* Add user Modal */}
      <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user to Project</DialogTitle>
            <DialogDescription>
              Enter a user's email and assign them a role.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <input
                id="email"
                type="email"
                placeholder="user@example.com"
                className="w-full mt-1 px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                value={addUserEmail}
                onChange={(e) => setAddUserEmail(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="role">Role</Label>
              <Select id="role" value={addUserRole} onValueChange={setAddUserRole}>
                <SelectItem value="project-viewer">project viewer</SelectItem>
                <SelectItem value="project-admin">project admin</SelectItem>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddUserModal(false);
                setAddUserEmail('');
                setAddUserRole('project-viewer');
              }}
              disabled={addUserByEmailMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={!addUserEmail || addUserByEmailMutation.isPending}
            >
              {addUserByEmailMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Modal */}
      <Dialog
        open={showEditRoleModal}
        onOpenChange={(open) => {
          console.log('[DEBUG] Dialog onOpenChange:', { open, selectedRole });
          setShowEditRoleModal(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update User Role</DialogTitle>
            <DialogDescription>
              Change {selectedUser?.email}'s role in this project
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="edit-role">Role</Label>
            <Select
              id="edit-role"
              value={selectedRole}
              onValueChange={(value) => {
                console.log('[DEBUG] Edit Role Select onChange:', { from: selectedRole, to: value });
                setSelectedRole(value);
              }}
            >
              <SelectItem value="project-viewer">project viewer</SelectItem>
              <SelectItem value="project-admin">project admin</SelectItem>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Current value: {selectedRole}</p>
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
