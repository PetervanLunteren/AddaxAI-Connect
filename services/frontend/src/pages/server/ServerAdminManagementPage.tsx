/**
 * Server Admin Management Page
 *
 * Allows server admins to add new server admins (unified invite/promote workflow)
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldOff, UserPlus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
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
import { useToast } from '../../components/ui/Toaster';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';
import { useAuth } from '../../hooks/useAuth';
import { useProject } from '../../contexts/ProjectContext';
import { ResetTwoFactorDialog, TwoFactorPill } from '../../components/ResetTwoFactorDialog';
import { RowActionsMenu } from '../../components/ui/RowActionsMenu';
import type { RowAction } from '../../components/ui/RowActionsMenu';
import { StatusPill } from '../../components/ui/StatusPill';
import type { UserWithMemberships } from '../../api/types';

export const ServerAdminManagementPage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { projects } = useProject();

  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState<string>('');
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [userToRemove, setUserToRemove] = useState<{ id: number; email: string } | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [invitationToCancel, setInvitationToCancel] = useState<{ id: number; email: string } | null>(null);
  // The server admin whose two-factor login is about to be reset
  const [resetTwoFactorUser, setResetTwoFactorUser] = useState<{ id: number; email: string } | null>(null);

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
      toast.error(`Failed to add server admin: ${error.response?.data?.detail || 'Unknown error'}`);
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
      toast.error(`Failed to remove server admin: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  // Cancel invitation mutation
  // Reset two-factor login of another server admin, for example after a lost phone
  const resetTwoFactorMutation = useMutation({
    mutationFn: (userId: number) => adminApi.resetUserTwoFactor(userId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setResetTwoFactorUser(null);
      toast.success(data.message);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to reset two-factor login');
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: (invitationId: number) => adminApi.cancelInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowCancelModal(false);
      setInvitationToCancel(null);
    },
    onError: (error: any) => {
      toast.error(`Failed to cancel invitation: ${error.response?.data?.detail || 'Unknown error'}`);
    },
  });

  const handleAddServerAdmin = () => {
    if (addEmail) {
      addServerAdminMutation.mutate({
        email: addEmail
      });
    }
  };

  // The actions of one row, for its three-dot menu. Your own row has none:
  // you cannot remove yourself, and your own two-factor login is switched off
  // on the Account page, with a code.
  const rowActions = (serverAdmin: UserWithMemberships): RowAction[] => {
    const target = { id: serverAdmin.id, email: serverAdmin.email };
    if (serverAdmin.is_pending_invitation) {
      return [{
        label: 'Cancel invitation',
        icon: Trash2,
        destructive: true,
        onClick: () => { setInvitationToCancel(target); setShowCancelModal(true); },
      }];
    }
    if (serverAdmin.id === user?.id) return [];
    return [
      ...(serverAdmin.two_factor_enabled
        ? [{
            label: 'Reset two-factor login',
            icon: ShieldOff,
            onClick: () => setResetTwoFactorUser(target),
          }]
        : []),
      {
        label: 'Remove server admin',
        icon: Trash2,
        destructive: true,
        onClick: () => { setUserToRemove(target); setShowRemoveModal(true); },
      },
    ];
  };

  return (
    <ServerPageLayout
      title="Server admins"
      description="Server admins have access to all projects and can manage users."
      action={
        <Button
          size="sm"
          onClick={() => setShowAddModal(true)}
          className="self-start whitespace-nowrap"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add server admin
        </Button>
      }
    >
      {/* No card title. The page title above says what this list is. */}
      <Card>
        <CardContent className="pt-6">
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
                  <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serverAdmins.map((serverAdmin) => (
                  <TableRow key={serverAdmin.id}>
                    <TableCell className="font-medium break-all">{serverAdmin.email}</TableCell>
                    {/* Only what is not the normal case. Everyone here is a
                        server admin, and every registered account is active
                        and verified. */}
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {serverAdmin.is_pending_invitation && (
                          <StatusPill tone="warning">Invitation pending</StatusPill>
                        )}
                        {serverAdmin.two_factor_enabled && <TwoFactorPill />}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActionsMenu rowLabel={serverAdmin.email} actions={rowActions(serverAdmin)} />
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
            <DialogTitle>Add server admin</DialogTitle>
            <DialogDescription>
              Enter an email address to add a server admin. If the user already exists, they'll be promoted. If they're new, an invitation will be sent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email address</Label>
              <input
                id="email"
                type="email"
                placeholder="admin@example.com"
                className="w-full mt-1 px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
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
              Cancel invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResetTwoFactorDialog
        email={resetTwoFactorUser?.email ?? null}
        requiredBecause={
          projects?.some((project) => project.require_two_factor)
            ? 'A project on this server requires two-factor login, and server admins can open every project'
            : undefined
        }
        pending={resetTwoFactorMutation.isPending}
        onCancel={() => setResetTwoFactorUser(null)}
        onConfirm={() => resetTwoFactorUser && resetTwoFactorMutation.mutate(resetTwoFactorUser.id)}
      />
    </ServerPageLayout>
  );
};
