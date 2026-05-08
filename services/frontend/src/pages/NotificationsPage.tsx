/**
 * Notifications page for project-level notification preferences
 *
 * Two-column layout matching ProjectSettingsPage pattern
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Save, X, MessageCircle, ChevronDown, ChevronRight, Link2, Unlink2, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toaster';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { remindersApi, type Reminder } from '../api/reminders';
import { adminApi } from '../api/admin';
import { speciesApi } from '../api/species';
import QRCode from 'react-qr-code';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { normalizeLabel } from '../utils/labels';

export const NotificationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { user } = useAuth();
  const { selectedProject, canAdminCurrentProject } = useProject();

  // Telegram species state
  const [telegramNotifySpecies, setTelegramNotifySpecies] = useState<Option[]>([]);

  // Telegram linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  // Email reports state
  const [reportFrequency, setReportFrequency] = useState<'disabled' | 'daily' | 'weekly' | 'monthly'>('disabled');

  // Excessive image alerts state
  const [excessiveImagesThreshold, setExcessiveImagesThreshold] = useState(0);

  // Project inactivity alerts state
  const [projectInactivityEnabled, setProjectInactivityEnabled] = useState(false);

  // SIM expiry alert state (project admin only)
  const [simExpiryEnabled, setSimExpiryEnabled] = useState(false);

  // Scheduled reminders state (project admin only)
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderMessage, setReminderMessage] = useState('');
  const [reminderToCancel, setReminderToCancel] = useState<Reminder | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Query preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notification-preferences', projectIdNum],
    queryFn: () => notificationsApi.getPreferences(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });

  // Query Telegram status (any authenticated user)
  const { data: telegramStatus } = useQuery({
    queryKey: ['telegram-status'],
    queryFn: () => adminApi.getTelegramStatus(),
  });
  const isTelegramConfigured = telegramStatus?.is_configured ?? false;
  const adminEmail = telegramStatus?.admin_email ?? null;

  // Fetch available species from the API (model-dependent)
  const { data: availableSpeciesData } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
  });
  const isSpeciesNet = availableSpeciesData?.model === 'speciesnet';

  // For DeepFaune: use project's included_species filter if set, otherwise full model list
  // For SpeciesNet: always use taxonomy_mapping labels (included_species is not used)
  // Always include person/vehicle as they are detection-level categories
  const availableSpecies = useMemo(() => {
    const modelSpecies = availableSpeciesData?.species ?? [];
    const baseSpecies = (!isSpeciesNet && selectedProject?.included_species) || modelSpecies;
    return [...new Set([...baseSpecies, 'person', 'vehicle'])];
  }, [availableSpeciesData?.species, isSpeciesNet, selectedProject?.included_species]);
  const speciesOptions: Option[] = useMemo(() =>
    availableSpecies
      .slice()
      .sort()
      .map(species => ({
        label: normalizeLabel(species),
        value: species
      })),
    [availableSpecies]
  );

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      const notificationChannels = (preferences as any).notification_channels;

      if (notificationChannels) {
        const speciesConfig = notificationChannels.species_detection || {};

        // Convert species to options, filtering out species no longer in the project
        const telegramSpeciesValues = (speciesConfig.notify_species || [])
          .filter((species: string) => availableSpecies.includes(species));
        setTelegramNotifySpecies(telegramSpeciesValues.map((species: string) => ({
          label: normalizeLabel(species),
          value: species
        })));

        // Email reports configuration
        const emailReportConfig = notificationChannels.email_report || {};
        setReportFrequency(emailReportConfig.enabled ? (emailReportConfig.frequency || 'weekly') : 'disabled');

        // Excessive image alerts configuration
        const excessiveConfig = notificationChannels.excessive_images || {};
        setExcessiveImagesThreshold(excessiveConfig.enabled ? (excessiveConfig.threshold || 50) : 0);

        // Project inactivity alerts configuration
        const inactivityConfig = notificationChannels.project_inactivity || {};
        setProjectInactivityEnabled(inactivityConfig.enabled || false);

        // SIM expiry alert configuration
        const simExpiryConfig = notificationChannels.sim_expiry || {};
        setSimExpiryEnabled(simExpiryConfig.enabled || false);

      } else {
        // Fall back to legacy fields if notification_channels doesn't exist
        const speciesOpts = (preferences.notify_species || [])
          .filter(species => availableSpecies.includes(species))
          .map(species => ({
            label: normalizeLabel(species),
            value: species
          }));
        setTelegramNotifySpecies(speciesOpts);
      }
    }
  }, [preferences, availableSpecies]);

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: (data: any) => notificationsApi.updatePreferences(projectIdNum, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', projectIdNum] });
      toast.success('Notification preferences updated');
    },
    onError: (error: any) => {
      toast.error(`Failed to update preferences: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Query Telegram link status
  const { data: linkStatus, refetch: refetchLinkStatus } = useQuery({
    queryKey: ['telegram-link-status', projectIdNum],
    queryFn: () => notificationsApi.checkTelegramLinkStatus(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0 && isTelegramConfigured,
    refetchInterval: false,
  });

  const isTelegramLinked = linkStatus?.linked ?? false;
  const isTelegramUsable = isTelegramConfigured && isTelegramLinked;

  // Generate Telegram link token mutation
  const generateTokenMutation = useMutation({
    mutationFn: () => notificationsApi.generateTelegramLinkToken(projectIdNum),
    onSuccess: (data) => {
      setLinkToken(data.token);
      setDeepLink(data.deep_link);
      setShowLinkModal(true);
    },
    onError: (error: any) => {
      toast.error(`Failed to generate link: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleGenerateLink = () => {
    generateTokenMutation.mutate();
  };

  // Unlink Telegram mutation
  const unlinkMutation = useMutation({
    mutationFn: () => notificationsApi.unlinkTelegram(projectIdNum),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-link-status', projectIdNum] });
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', projectIdNum] });
      toast.success('Telegram account unlinked');
    },
    onError: (error: any) => {
      toast.error(`Failed to unlink Telegram: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Scheduled reminders. Only project admins fetch the list; viewers do
  // not see the section at all so the query stays gated.
  const { data: reminders } = useQuery({
    queryKey: ['project-reminders', projectIdNum],
    queryFn: () => remindersApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0 && canAdminCurrentProject,
  });

  const activeReminders = useMemo(
    () => (reminders || []).filter((r) => !r.sent_at && !r.cancelled_at),
    [reminders],
  );
  const historyReminders = useMemo(
    () => (reminders || []).filter((r) => r.sent_at || r.cancelled_at),
    [reminders],
  );

  const createReminderMutation = useMutation({
    mutationFn: ({ sendOn, message }: { sendOn: string; message: string }) =>
      remindersApi.create(projectIdNum, sendOn, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-reminders', projectIdNum] });
      setShowAddReminder(false);
      setReminderDate('');
      setReminderMessage('');
      toast.success('Reminder scheduled');
    },
    onError: (error: any) => {
      toast.error(`Failed to schedule reminder: ${error.response?.data?.detail || error.message}`);
    },
  });

  const cancelReminderMutation = useMutation({
    mutationFn: (reminderId: number) => remindersApi.cancel(projectIdNum, reminderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-reminders', projectIdNum] });
      setReminderToCancel(null);
      toast.success('Reminder cancelled');
    },
    onError: (error: any) => {
      toast.error(`Failed to cancel reminder: ${error.response?.data?.detail || error.message}`);
      setReminderToCancel(null);
    },
  });

  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const handleUnlink = () => setShowUnlinkConfirm(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build notification_channels JSON structure
    const channels: string[] = [];
    if (isTelegramLinked) channels.push('telegram');

    // Use Telegram settings for legacy fields
    const legacySpeciesValues = isTelegramLinked ? telegramNotifySpecies.map(opt => opt.value) : [];

    // Build notification_channels JSON with per-channel configuration
    const notificationChannels = {
      species_detection: {
        enabled: isTelegramLinked,
        channels: channels,
        notify_species: isTelegramLinked
          ? telegramNotifySpecies.map(opt => opt.value)
          : []
      },
      email_report: {
        enabled: reportFrequency !== 'disabled',
        frequency: reportFrequency !== 'disabled' ? reportFrequency : 'weekly'
      },
      excessive_images: {
        enabled: excessiveImagesThreshold > 0,
        threshold: excessiveImagesThreshold > 0 ? excessiveImagesThreshold : 50
      },
      project_inactivity: {
        enabled: projectInactivityEnabled
      },
      sim_expiry: {
        enabled: simExpiryEnabled
      }
    };

    updateMutation.mutate({
      // Legacy fields (for backward compatibility)
      enabled: isTelegramLinked,
      telegram_chat_id: isTelegramLinked ? (linkStatus?.chat_id || null) : null,
      notify_species: legacySpeciesValues,
      notify_low_battery: false,
      battery_threshold: 30,
      notify_system_health: false,
      // New multi-channel configuration
      notification_channels: notificationChannels,
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Notifications</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Configure alerts for species detections and system events. These settings apply to your account only.</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardContent className="pt-6">

              {/* Species alerts row */}
              <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8 ${!isTelegramUsable ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">Real-time detection alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isTelegramLinked
                      ? 'Receive an instant Telegram message with a photo each time a selected species is detected. Leave empty for no Telegram notifications.'
                      : isTelegramConfigured
                        ? 'Receive an instant Telegram message with a photo each time a species is detected. Link your Telegram account to get started.'
                        : user?.is_superuser
                          ? 'Receive an instant Telegram message with a photo each time a species is detected. A Telegram bot has not been configured yet.'
                          : 'Receive an instant Telegram message with a photo each time a species is detected. A Telegram bot has not been configured for this server yet.'
                    }
                  </p>
                </div>
                <div className="w-full flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center sm:gap-3">
                  <div className="w-full sm:flex-[2]">
                    <MultiSelect
                      options={speciesOptions}
                      value={telegramNotifySpecies}
                      onChange={setTelegramNotifySpecies}
                      placeholder="Select species to notify about..."
                    />
                  </div>
                  <div className="w-full flex sm:flex-1 sm:justify-end">
                    {isTelegramLinked ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleUnlink}
                        disabled={unlinkMutation.isPending}
                        className="w-full whitespace-nowrap pointer-events-auto"
                      >
                        {unlinkMutation.isPending ? (
                          <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Unlinking...</>
                        ) : (
                          'Unlink Telegram'
                        )}
                      </Button>
                    ) : isTelegramConfigured ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleGenerateLink}
                        disabled={generateTokenMutation.isPending}
                        className="w-full whitespace-nowrap pointer-events-auto"
                      >
                        {generateTokenMutation.isPending ? (
                          <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Linking...</>
                        ) : (
                          'Link Telegram'
                        )}
                      </Button>
                    ) : user?.is_superuser ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => window.location.href = '/server/settings'}
                        className="w-full whitespace-nowrap pointer-events-auto"
                      >
                        Configure
                      </Button>
                    ) : adminEmail ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => window.location.href = `mailto:${adminEmail}`}
                        className="w-full whitespace-nowrap pointer-events-auto"
                      >
                        Contact admin
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Email reports row */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">Project updates</label>
                  <p className="text-sm text-muted-foreground mt-1">Receive a scheduled email with a summary of your project, including the number of new images, species detected, and camera activity since the last report.</p>
                </div>
                <div className="flex-1 relative">
                  <select
                    value={reportFrequency}
                    onChange={(e) => setReportFrequency(e.target.value as 'disabled' | 'daily' | 'weekly' | 'monthly')}
                    className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="disabled">Disabled</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly (every Monday)</option>
                    <option value="monthly">Monthly (on the 1st)</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Project inactivity alerts row (project admins only) */}
              {canAdminCurrentProject && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                    <div className="w-full sm:w-1/2 sm:shrink-0">
                      <label className="text-sm font-medium block">Project inactivity alert</label>
                      <p className="text-sm text-muted-foreground mt-1">Receive an email if this project receives zero images in 48 hours. This usually means something is wrong with the server or network.</p>
                    </div>
                    <div className="flex-1 relative">
                      <select
                        value={projectInactivityEnabled ? 'enabled' : 'disabled'}
                        onChange={(e) => setProjectInactivityEnabled(e.target.value === 'enabled')}
                        className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="disabled">Disabled</option>
                        <option value="enabled">Enabled</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </>
              )}

              {/* SIM expiry alert row (project admins only) */}
              {canAdminCurrentProject && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                    <div className="w-full sm:w-1/2 sm:shrink-0">
                      <label className="text-sm font-medium block">SIM expiry alert</label>
                      <p className="text-sm text-muted-foreground mt-1">Receive an email on the 1st of every month listing cameras in this project whose SIM card expires within the next two months or has already expired. The email keeps coming every month until the date is updated.</p>
                    </div>
                    <div className="flex-1 relative">
                      <select
                        value={simExpiryEnabled ? 'enabled' : 'disabled'}
                        onChange={(e) => setSimExpiryEnabled(e.target.value === 'enabled')}
                        className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="disabled">Disabled</option>
                        <option value="enabled">Enabled</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </>
              )}

              {/* Scheduled reminders (project admins only). One-shot
                  emails to whoever creates them; the list is shared so
                  admins can see what other admins already scheduled. */}
              {canAdminCurrentProject && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[12rem]">
                        <label className="text-sm font-medium block">Scheduled reminders</label>
                        <p className="text-sm text-muted-foreground mt-1">Schedule a one-shot email reminder for yourself on a future date. Useful for project end dates, seasonal cleanup deadlines, hardware swaps. Only the user who creates the reminder receives the email.</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddReminder(true)}
                      >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add reminder
                      </Button>
                    </div>

                    {activeReminders.length > 0 ? (
                      <ul className="divide-y border rounded-md">
                        {activeReminders.map((r) => (
                          <li key={r.id} className="p-3 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{r.send_on}</span>
                                <span className="text-xs text-muted-foreground">
                                  Created by {r.created_by_email || `user ${r.created_by_user_id}`}
                                </span>
                              </div>
                              <p className="text-sm mt-1 whitespace-pre-wrap break-words">
                                {r.message}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setReminderToCancel(r)}
                              className="text-muted-foreground"
                              aria-label="Cancel reminder"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No scheduled reminders.</p>
                    )}

                    {historyReminders.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setHistoryOpen((o) => !o)}
                          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                        >
                          {historyOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          History ({historyReminders.length})
                        </button>
                        {historyOpen && (
                          <ul className="mt-2 divide-y border rounded-md text-muted-foreground">
                            {historyReminders.map((r) => {
                              const status = r.cancelled_at
                                ? `Cancelled ${r.cancelled_at.slice(0, 10)}${r.cancelled_by_email ? ` by ${r.cancelled_by_email}` : ''}`
                                : `Sent ${r.sent_at?.slice(0, 10)}`;
                              return (
                                <li key={r.id} className="p-3">
                                  <div className="flex items-center gap-2 flex-wrap text-xs">
                                    <span className="font-medium">{r.send_on}</span>
                                    <span>·</span>
                                    <span>{status}</span>
                                    <span>·</span>
                                    <span>Created by {r.created_by_email || `user ${r.created_by_user_id}`}</span>
                                  </div>
                                  <p className="text-sm mt-1 whitespace-pre-wrap break-words">{r.message}</p>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Excessive image alerts row */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">Excessive image alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">Receive an email alert when a camera exceeds a daily image threshold. This usually indicates a problem like waving grass or direct sunlight triggering the sensor repeatedly.</p>
                </div>
                <div className="flex-1 relative">
                  <select
                    value={excessiveImagesThreshold}
                    onChange={(e) => setExcessiveImagesThreshold(Number(e.target.value))}
                    className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value={0}>Disabled</option>
                    <option value={25}>25 images per day</option>
                    <option value={50}>50 images per day</option>
                    <option value={100}>100 images per day</option>
                    <option value={200}>200 images per day</option>
                    <option value={500}>500 images per day</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Save button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save preferences
                    </>
                  )}
                </button>
              </div>

            </CardContent>
          </Card>
        </form>
      )}

      {/* Telegram linking modal */}
      <Dialog open={showLinkModal && !!deepLink} onOpenChange={setShowLinkModal}>
        <DialogContent onClose={() => setShowLinkModal(false)}>
          <DialogHeader>
            <DialogTitle>Link your Telegram account</DialogTitle>
          </DialogHeader>

              <div className="space-y-6">
                {/* QR code */}
                <div className="flex justify-center bg-white p-4 rounded-lg">
                  <QRCode value={deepLink} size={200} />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-border" />
                  <span className="text-sm text-muted-foreground">or</span>
                  <div className="flex-1 border-t border-border" />
                </div>

                {/* Open Telegram button */}
                <div className="flex justify-center">
                  <a
                    href={deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-center font-medium flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Open in Telegram
                  </a>
                </div>

                {/* Instructions */}
                <div className="bg-muted border border-border p-4 rounded-md">
                  <ol className="list-decimal list-outside ml-4 space-y-2 text-sm text-muted-foreground">
                    <li className="pl-2">Scan the QR code above with your phone, or click the button above to open Telegram</li>
                    <li className="pl-2">Press Start in Telegram when it opens</li>
                    <li className="pl-2">Come back here and click "Check status" to confirm</li>
                  </ol>
                </div>

                {/* Check status button */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await refetchLinkStatus();
                      if (result.data?.linked) {
                        setShowLinkModal(false);
                      }
                    }}
                    className="px-6 py-2 border border-border bg-background rounded-md hover:bg-accent transition-colors"
                  >
                    Check status
                  </button>
                </div>
              </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showUnlinkConfirm}
        onClose={() => setShowUnlinkConfirm(false)}
        onConfirm={() => {
          setShowUnlinkConfirm(false);
          unlinkMutation.mutate();
        }}
        title="Unlink Telegram account"
        body="You will need to link Telegram again to receive notifications for this project."
        confirmLabel="Unlink"
        variant="destructive"
        isPending={unlinkMutation.isPending}
      />

      {/* Add-reminder dialog */}
      <Dialog open={showAddReminder} onOpenChange={(o) => !o && setShowAddReminder(false)}>
        <DialogContent onClose={() => setShowAddReminder(false)}>
          <DialogHeader>
            <DialogTitle>Add a scheduled reminder</DialogTitle>
            <DialogDescription>
              Pick a future date and write the message you want to send yourself. The email arrives in your inbox on that date and does not repeat.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={reminderDate}
                min={todayIso}
                onChange={(e) => setReminderDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Message</label>
              <textarea
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                rows={5}
                placeholder="e.g. Project ends Friday. Email John Doe to talk about next steps."
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddReminder(false)}
              disabled={createReminderMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                createReminderMutation.mutate({
                  sendOn: reminderDate,
                  message: reminderMessage,
                })
              }
              disabled={
                createReminderMutation.isPending ||
                !reminderDate ||
                reminderMessage.trim().length === 0
              }
            >
              {createReminderMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Schedule reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel-reminder confirmation */}
      <ConfirmDialog
        open={reminderToCancel !== null}
        onClose={() => setReminderToCancel(null)}
        onConfirm={() => {
          if (reminderToCancel) cancelReminderMutation.mutate(reminderToCancel.id);
        }}
        title="Cancel this reminder?"
        body={
          reminderToCancel
            ? `The reminder for ${reminderToCancel.send_on} will not be sent.`
            : ''
        }
        confirmLabel="Cancel reminder"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={cancelReminderMutation.isPending}
      />
    </div>
  );
};
