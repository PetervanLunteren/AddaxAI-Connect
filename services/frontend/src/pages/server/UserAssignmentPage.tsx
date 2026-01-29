/**
 * Server Admin Management Page
 *
 * Allows server admins to add new server admins (unified invite/promote workflow)
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Loader2, UserPlus, Trash2 } from 'lucide-react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table';
import { Label } from '../../components/ui/Label';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';
import { useAuth } from '../../hooks/useAuth';

export const UserAssignmentPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState<string>('');
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [userToRemove, setUserToRemove] = useState<{ id: number; email: string } | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [invitationToCancel, setInvitationToCancel] = useState<{ id: number; email: string } | null>(null);

  // Fetch all users to filter server admins
  const { data: users, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminApi.listUsers,
  });

  // Filter to show only server admins
  const serverAdmins = users?.filter(user => user.is_superuser) || [];

  // Add server admin mutation (unified invite/promote)
  const addServerAdminMutation = useMutation({
    mutationFn: (data: { email: string }) =>
      adminApi.addServerAdmin(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowAddModal(false);
      setAddEmail('');
    },
    onError: (error: any) => {
      alert(`Failed to add server admin: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  // Remove server admin mutation
  const removeServerAdminMutation = useMutation({
    mutationFn: (userId: number) => adminApi.removeServerAdmin(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowRemoveModal(false);
      setUserToRemove(null);
    },
    onError: (error: any) => {
      alert(`Failed to remove server admin: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  // Cancel invitation mutation
  const cancelInvitationMutation = useMutation({
    mutationFn: (invitationId: number) => adminApi.cancelInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowCancelModal(false);
      setInvitationToCancel(null);
    },
    onError: (error: any) => {
      alert(`Failed to cancel invitation: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  const handleAddServerAdmin = () => {
    if (addEmail) {
      addServerAdminMutation.mutate({
        email: addEmail
      });
    }
  };

  return (
    <ServerPageLayout
      title="Server Admin Management"
      description="Manage server administrators. Server admins have access to all projects and can manage users."
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <CardTitle>Server Administrators</CardTitle>
            </div>
            <Button onClick={() => setShowAddModal(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Server Admin
            </Button>
          </div>
          <CardDescription>
            Users with server admin privileges can access all projects and administrative tools
          </CardDescription>
        </CardHeader>

        <CardContent>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : serverAdmins.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No server administrators found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serverAdmins.map((serverAdmin) => (
                  <TableRow key={serverAdmin.id}>
                    <TableCell className="font-medium">{serverAdmin.email}</TableCell>
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          <Shield className="h-3 w-3" />
                          Server Admin
                        </span>
                        {serverAdmin.is_pending_invitation ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-yellow-100 text-yellow-700">
                            Pending Invitation
                          </span>
                        ) : (
                          <>
                            {serverAdmin.is_active && (
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-700">
                                Active
                              </span>
                            )}
                            {serverAdmin.is_verified && (
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-700">
                                Verified
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (serverAdmin.is_pending_invitation) {
                            setInvitationToCancel({ id: serverAdmin.id, email: serverAdmin.email });
                            setShowCancelModal(true);
                          } else {
                            setUserToRemove({ id: serverAdmin.id, email: serverAdmin.email });
                            setShowRemoveModal(true);
                          }
                        }}
                        disabled={!serverAdmin.is_pending_invitation && serverAdmin.id === user?.id}
                        className="h-8 w-8 p-0"
                        title={
                          serverAdmin.is_pending_invitation
                            ? "Cancel invitation"
                            : serverAdmin.id === user?.id
                            ? "Cannot remove yourself"
                            : "Remove server admin"
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Server Admin Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Server Admin</DialogTitle>
            <DialogDescription>
              Enter an email address to add a server admin. If the user already exists, they'll be promoted. If they're new, an invitation will be sent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <input
                id="email"
                type="email"
                placeholder="admin@example.com"
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddModal(false);
                setAddEmail('');
              }}
              disabled={addServerAdminMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddServerAdmin}
              disabled={!addEmail || addServerAdminMutation.isPending}
            >
              {addServerAdminMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Server Admin Confirmation Modal */}
      <Dialog open={showRemoveModal} onOpenChange={setShowRemoveModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove server admin?</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{userToRemove?.email}</strong> as a server admin? They will be demoted to a regular user but will keep their existing project memberships.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRemoveModal(false);
                setUserToRemove(null);
              }}
              disabled={removeServerAdminMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (userToRemove) {
                  removeServerAdminMutation.mutate(userToRemove.id);
                }
              }}
              disabled={removeServerAdminMutation.isPending}
            >
              {removeServerAdminMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Invitation Confirmation Modal */}
      <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel invitation?</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel the invitation for <strong>{invitationToCancel?.email}</strong>? They will no longer be able to register as a server admin using this invitation.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCancelModal(false);
                setInvitationToCancel(null);
              }}
              disabled={cancelInvitationMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (invitationToCancel) {
                  cancelInvitationMutation.mutate(invitationToCancel.id);
                }
              }}
              disabled={cancelInvitationMutation.isPending}
            >
              {cancelInvitationMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Cancel Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ServerPageLayout>
  );
};
