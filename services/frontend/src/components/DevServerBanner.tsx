/**
 * Dev-server banner.
 *
 * Visible only to server admins when the API reports this box looks like a
 * dev server and there are still non-admin users present. Dismissible for
 * the current browser session.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { adminApi } from '../api/admin';
import type { DevModeStatus } from '../api/types';
import { logger } from '../utils/logger';
import { DevPurgeConfirmModal } from './DevPurgeConfirmModal';

const DISMISS_KEY = 'dev_banner_dismissed';

export const DevServerBanner: React.FC = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<DevModeStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(
    () => sessionStorage.getItem(DISMISS_KEY) === '1',
  );
  const [modalOpen, setModalOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await adminApi.getDevModeStatus();
      setStatus(data);
    } catch (e) {
      logger.warn('Failed to fetch dev-mode status', { error: String(e) });
    }
  }, []);

  useEffect(() => {
    if (!user?.is_superuser) return;
    fetchStatus();
  }, [user?.is_superuser, fetchStatus]);

  if (!user?.is_superuser) return null;
  if (dismissed) return null;
  if (!status) return null;
  if (!status.is_dev_server) return null;
  if (status.non_admin_user_count === 0) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <>
      <div
        role="alert"
        className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 flex items-center gap-3"
      >
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-700" />
        <div className="flex-1 text-sm">
          <span className="font-semibold">Dev server detected.</span>{' '}
          This server looks like a dev box. {status.non_admin_user_count} non-admin
          users from production are still here, and pending notifications could fire.
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="text-sm font-medium px-3 py-1.5 rounded-md bg-amber-900 text-amber-50 hover:bg-amber-950"
        >
          Remove all users
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss for this session"
          className="text-amber-900 hover:text-amber-950 p-1 -m-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <DevPurgeConfirmModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        status={status}
        onPurged={fetchStatus}
      />
    </>
  );
};
