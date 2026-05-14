/**
 * Notifications page for project-level notification preferences
 *
 * Two-column layout matching ProjectSettingsPage pattern
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Save, MessageCircle, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toaster';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { remindersApi } from '../api/reminders';
import { RemindersSheet } from '../components/RemindersSheet';
import { adminApi } from '../api/admin';
import { camerasApi } from '../api/cameras';
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

  // Telegram per-camera scope. Empty selection = all cameras (saved as null
  // in notification_channels.species_detection.notify_cameras). A non-empty
  // selection limits alerts to those camera ids.
  const [telegramNotifyCameras, setTelegramNotifyCameras] = useState<Option[]>([]);

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

  // Scheduled reminders state (project admin only). The full UI lives in
  // a slideout; we only need to track whether the sheet is open and the
  // count for the row-level summary below.
  const [showRemindersSheet, setShowRemindersSheet] = useState(false);

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

  // Fetch cameras in this project for the per-camera scope picker
  const { data: projectCameras } = useQuery({
    queryKey: ['cameras', projectIdNum],
    queryFn: () => camerasApi.getAll(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });
  const cameraOptions: Option[] = useMemo(() => {
    const list = projectCameras ?? [];
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cam) => ({ label: cam.name, value: cam.id }));
  }, [projectCameras]);

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

        // Per-camera scope. Cameras now behave like notify_species: the list
        // is required, an empty list means no alerts. Rows that pre-date this
        // feature (notify_cameras missing or null) are read as 'every camera
        // in the project' and the picker pre-fills with all options, so the
        // user can see the current scope and save explicitly.
        const cameraOptionById = new Map(cameraOptions.map((opt) => [opt.value as number, opt]));
        const storedNotifyCameras = speciesConfig.notify_cameras;
        if (Array.isArray(storedNotifyCameras)) {
          setTelegramNotifyCameras(
            storedNotifyCameras
              .map((cid: number) => cameraOptionById.get(cid))
              .filter((opt): opt is Option => Boolean(opt))
          );
        } else {
          setTelegramNotifyCameras(cameraOptions);
        }

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
  }, [preferences, availableSpecies, cameraOptions]);

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

  // Lightweight count query so the row-level summary on this page can show
  // "N scheduled reminders" without duplicating the full list logic that
  // already lives in RemindersSheet.
  const { data: reminders } = useQuery({
    queryKey: ['project-reminders', projectIdNum],
    queryFn: () => remindersApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0 && canAdminCurrentProject,
  });
  const activeReminderCount = (reminders || []).filter(
    (r) => !r.sent_at && !r.cancelled_at,
  ).length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build notification_channels JSON structure
    const channels: string[] = [];
    if (isTelegramLinked) channels.push('telegram');

    // Use Telegram settings for legacy fields
    const legacySpeciesValues = isTelegramLinked ? telegramNotifySpecies.map(opt => opt.value) : [];

    // Camera scope mirrors species: an explicit list of ids that must
    // contain the event's camera. An empty list means no alerts.
    const cameraScope: number[] = isTelegramLinked
      ? telegramNotifyCameras.map(opt => Number(opt.value))
      : [];

    // Build notification_channels JSON with per-channel configuration
    const notificationChannels = {
      species_detection: {
        enabled: isTelegramLinked,
        channels: channels,
        notify_species: isTelegramLinked
          ? telegramNotifySpecies.map(opt => opt.value)
          : [],
        notify_cameras: cameraScope,
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

              {/* Real-time detection alerts row. Species and camera scope sit in
                  one column on the right so they read as one notification type,
                  not two. When Telegram is not yet linked the pickers are greyed
                  via opacity-50 and the call-to-action sits under them. */}
              <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8 ${!isTelegramUsable ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">Real-time detection alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isTelegramLinked
                      ? 'Receive an instant Telegram message with a photo each time a selected label is detected at a selected camera. Both lists must contain at least one entry, otherwise no alerts fire.'
                      : isTelegramConfigured
                        ? 'Receive an instant Telegram message with a photo each time a selected label is detected at a selected camera. Link your Telegram account to get started.'
                        : user?.is_superuser
                          ? 'Receive an instant Telegram message with a photo each time a selected label is detected at a selected camera. A Telegram bot has not been configured yet.'
                          : 'Receive an instant Telegram message with a photo each time a selected label is detected at a selected camera. A Telegram bot has not been configured for this server yet.'
                    }
                  </p>
                </div>
                <div className="w-full sm:flex-1 flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                    <div className="w-full sm:flex-1 min-w-0">
                      <MultiSelect
                        options={speciesOptions}
                        value={telegramNotifySpecies}
                        onChange={setTelegramNotifySpecies}
                        placeholder="Select labels"
                        selectedNoun="labels"
                      />
                    </div>
                    <div className="w-full sm:flex-1 min-w-0">
                      <MultiSelect
                        options={cameraOptions}
                        value={telegramNotifyCameras}
                        onChange={setTelegramNotifyCameras}
                        placeholder="Select cameras"
                        selectedNoun="cameras"
                      />
                    </div>
                  </div>
                  {!isTelegramLinked && (
                    <div className="flex justify-end">
                      {isTelegramConfigured ? (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={handleGenerateLink}
                          disabled={generateTokenMutation.isPending}
                          className="whitespace-nowrap pointer-events-auto"
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
                          className="whitespace-nowrap pointer-events-auto"
                        >
                          Configure
                        </Button>
                      ) : adminEmail ? (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => window.location.href = `mailto:${adminEmail}`}
                          className="whitespace-nowrap pointer-events-auto"
                        >
                          Contact admin
                        </Button>
                      ) : null}
                    </div>
                  )}
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

              {/* Scheduled reminders row (project admins only). The
                  manage-reminders slideout holds the full list + add /
                  edit / cancel UI, keeping this row consistent with the
                  rest of the notifications page. */}
              {canAdminCurrentProject && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                    <div className="w-full sm:w-1/2 sm:shrink-0">
                      <label className="text-sm font-medium block">Scheduled reminders</label>
                      <p className="text-sm text-muted-foreground mt-1">Schedule a one-shot email to your future self. Useful for project end dates, seasonal cleanup deadlines, hardware swaps. The email lands only with you.</p>
                    </div>
                    <div className="flex-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRemindersSheet(true)}
                      >
                        Manage reminders
                        {activeReminderCount > 0 && (
                          <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                            {activeReminderCount}
                          </span>
                        )}
                      </Button>
                    </div>
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

      {/* Scheduled reminders slideout (admin only). Self-contained: it
          owns its own queries, mutations, and dialogs. */}
      {canAdminCurrentProject && projectIdNum > 0 && (
        <RemindersSheet
          open={showRemindersSheet}
          onClose={() => setShowRemindersSheet(false)}
          projectId={projectIdNum}
        />
      )}
    </div>
  );
};
