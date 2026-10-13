/**
 * Typed-domain confirmation modal for the dev-server user purge.
 *
 * Mirrors the typed-confirm pattern from DeleteProjectModal. The submit button
 * stays disabled until the operator types the current domain exactly.
 */
import React, { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { ConfirmWordField } from './ui/ConfirmWordField';
import { ImpactBox } from './ui/ImpactBox';
import { useToast } from './ui/Toaster';
import { adminApi } from '../api/admin';
import type { DevModeStatus } from '../api/types';
import { logger } from '../utils/logger';

interface DevPurgeConfirmModalProps {
  open: boolean;
  onClose: () => void;
  status: DevModeStatus;
  onPurged: () => void;
}

export const DevPurgeConfirmModal: React.FC<DevPurgeConfirmModalProps> = ({
  open,
  onClose,
  status,
  onPurged,
}) => {
  const toast = useToast();
  const [confirmDomain, setConfirmDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmDomain('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const expectedDomain = status.domain_name ?? '';
  const isConfirmValid =
    expectedDomain.length > 0 && confirmDomain === expectedDomain;

  const handleClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await adminApi.purgeNonAdminUsers(confirmDomain);
      toast.success(
        `Removed ${result.deleted_users} users and ${result.deleted_notification_preferences} notification preferences, drained ${result.drained_email} emails and ${result.drained_telegram} Telegram messages`,
      );
      logger.info('Dev purge completed', { ...result });
      onPurged();
      onClose();
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail || err?.message || 'Failed to purge users';
      setError(String(detail));
      logger.error('Dev purge failed', { error: String(detail) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent onClose={submitting ? undefined : handleClose}>
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle>Reset dev server</DialogTitle>
          </div>
          <DialogDescription>
            This action cannot be undone. Server admins stay, every other user
            on this server will be hard-deleted, and all notification
            preferences will be cleared so the scheduled emails stop.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <ImpactBox
            sections={[
              {
                heading: 'This will remove',
                bullets: [
                  `${status.non_admin_user_count} non-admin user accounts`,
                  `${status.project_membership_count} project memberships`,
                  `${status.notification_preference_count} notification preferences`,
                  `${status.queued_notification_email_count} pending email notifications in the queue`,
                  `${status.queued_notification_telegram_count} pending Telegram notifications in the queue`,
                ],
              },
            ]}
          >
            <p className="text-muted-foreground">
              Historical attributions on projects, documents, reminders, bulk
              uploads, and human observations created by removed users will be
              reassigned to you.
            </p>
          </ImpactBox>

          <ConfirmWordField
            word={expectedDomain}
            value={confirmDomain}
            onChange={setConfirmDomain}
            disabled={submitting}
          />

          {error && (
            <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md">
              {error}
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isConfirmValid || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Reset dev server
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
