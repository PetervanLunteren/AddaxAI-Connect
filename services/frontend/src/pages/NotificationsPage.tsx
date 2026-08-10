/**
 * Notifications page for project-level notification preferences
 *
 * Two-column layout matching ProjectSettingsPage pattern
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2, Save, MessageCircle, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toaster';
import { Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { remindersApi } from '../api/reminders';
import { RemindersSheet } from '../components/RemindersSheet';
import { CameraAlertRulesSheet } from '../components/CameraAlertRulesSheet';
import { cameraAlertRulesApi } from '../api/cameraAlertRules';
import { DetectionAlertRulesSheet } from '../components/DetectionAlertRulesSheet';
import { detectionAlertRulesApi } from '../api/detectionAlertRules';
import { adminApi } from '../api/admin';
import { sitesApi } from '../api/sites';
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

  // Telegram linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
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
  const [showAlertRulesSheet, setShowAlertRulesSheet] = useState(false);
  const [showDetectionRulesSheet, setShowDetectionRulesSheet] = useState(false);

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

  // Fetch sites in this project for the per-site scope picker
  const { data: projectSites } = useQuery({
    queryKey: ['sites', projectIdNum],
    queryFn: () => sitesApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });
  const siteOptions: Option[] = useMemo(() => {
    const list = projectSites ?? [];
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((site) => ({ label: site.name, value: site.id }));
  }, [projectSites]);

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

  // Update form when preferences load. Real-time detection alerts live in
  // their own rules (the slideout), not in this blob anymore.
  useEffect(() => {
    if (preferences) {
      const notificationChannels = (preferences as any).notification_channels;

      if (notificationChannels) {
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
      }
    }
  }, [preferences]);

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

  // Generate Telegram link token mutation
  const generateTokenMutation = useMutation({
    mutationFn: () => notificationsApi.generateTelegramLinkToken(projectIdNum),
    onSuccess: (data) => {
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

  // Same lightweight count pattern for the camera alert rules row
  const { data: alertRules } = useQuery({
    queryKey: ['camera-alert-rules', projectIdNum],
    queryFn: () => cameraAlertRulesApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });
  const activeAlertRuleCount = (alertRules || []).filter((r) => r.is_active).length;

  // And for the detection alert rules row
  const { data: detectionRules } = useQuery({
    queryKey: ['detection-alert-rules', projectIdNum],
    queryFn: () => detectionAlertRulesApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });
  const activeDetectionRuleCount = (detectionRules || []).filter((r) => r.is_active).length;

  // Default cooldown for new detection rules. The independence interval
  // expresses how far apart two sightings must be to count as separate
  // events, so it is the natural burst control; 30 minutes when disabled.
  const defaultCooldownMinutes =
    selectedProject && selectedProject.independence_interval_minutes > 0
      ? selectedProject.independence_interval_minutes
      : 30;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build notification_channels JSON with per-type configuration. The
    // stored blob is spread first so keys this page does not manage
    // survive the whole-replace PUT, including the retired
    // species_detection key, which must stay untouched so a version
    // rollback still finds the old real-time alert configuration.
    const notificationChannels = {
      ...((preferences as any)?.notification_channels ?? {}),
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
      notification_channels: notificationChannels,
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Notifications</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Configure alerts for species detections and system events. These settings apply to your account only.</p>

      {/* Without a Telegram bot there is nothing account-related to
          configure, so the Telegram row disappears and this note takes
          its place */}
      {telegramStatus && !isTelegramConfigured && (
        <Callout
          variant="info"
          className="mb-6"
          action={
            user?.is_superuser ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => window.location.href = '/server/settings'}
                className="whitespace-nowrap"
              >
                Server settings
              </Button>
            ) : adminEmail ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => window.location.href = `mailto:${adminEmail}`}
                className="whitespace-nowrap"
              >
                Contact admin
              </Button>
            ) : null
          }
        >
          Telegram messages are not available yet. A Telegram bot has not
          been set up for this server. Ask your server admin to set it up.
        </Callout>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardContent className="pt-6">

              {/* Telegram account row, only when a bot exists. Linking a
                  personal account is a per-user setting; the link CTA
                  lives here so both the detection and camera alert rules
                  can point at one place. */}
              {isTelegramConfigured && (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                    <div className="w-full sm:w-1/2 sm:shrink-0">
                      <label className="text-sm font-medium block">Telegram account</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {isTelegramLinked
                          ? 'Your Telegram account is linked. Alert rules can send you Telegram messages with photos.'
                          : 'Link your Telegram account so alert rules can send you instant Telegram messages with photos.'
                        }
                      </p>
                    </div>
                    <div className="flex-1">
                      {isTelegramLinked ? (
                        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-primary/10 text-primary">
                          Linked
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={handleGenerateLink}
                          disabled={generateTokenMutation.isPending}
                          className="whitespace-nowrap"
                        >
                          {generateTokenMutation.isPending ? (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Linking...</>
                          ) : (
                            'Link Telegram'
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t my-6" />
                </>
              )}

              {/* Real-time detection alerts row (any member). The slideout
                  holds the rule list plus add / edit / delete. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">Real-time detection alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">Get an instant email or Telegram message with a photo each time a selected label is detected. Rules can be narrowed by site, time of day, or group size, and quieted with a cooldown. Only you receive your alerts.</p>
                </div>
                <div className="flex-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDetectionRulesSheet(true)}
                  >
                    Manage detection rules
                    {activeDetectionRuleCount > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                        {activeDetectionRuleCount}
                      </span>
                    )}
                  </Button>
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

              {/* Camera condition alerts row (any member). The slideout
                  holds the rule list plus add / edit / delete. */}
              <div className="border-t my-6" />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
                <div className="w-full sm:w-1/2 sm:shrink-0">
                  <label className="text-sm font-medium block">Camera condition alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">Get an email or Telegram message when a camera's battery drops below a threshold, its SD card fills up, or it goes silent for too long. Alerts fire once per incident and re-arm when the camera recovers. Only you receive your alerts.</p>
                </div>
                <div className="flex-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAlertRulesSheet(true)}
                  >
                    Manage alert rules
                    {activeAlertRuleCount > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                        {activeAlertRuleCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

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
                  {/* Guard needed even though the dialog only opens with a
                      link, React validates props at element creation */}
                  {deepLink && <QRCode value={deepLink} size={200} />}
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
                    href={deepLink ?? undefined}
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

      {/* Camera condition alert rules slideout (any member). Rules are
          private, only the creator receives the alerts. */}
      {projectIdNum > 0 && (
        <CameraAlertRulesSheet
          open={showAlertRulesSheet}
          onClose={() => setShowAlertRulesSheet(false)}
          projectId={projectIdNum}
          telegramLinked={isTelegramLinked}
        />
      )}

      {/* Real-time detection alert rules slideout (any member). Rules are
          private, only the creator receives the alerts. */}
      {projectIdNum > 0 && (
        <DetectionAlertRulesSheet
          open={showDetectionRulesSheet}
          onClose={() => setShowDetectionRulesSheet(false)}
          projectId={projectIdNum}
          telegramLinked={isTelegramLinked}
          speciesOptions={speciesOptions}
          siteOptions={siteOptions}
          defaultCooldownMinutes={defaultCooldownMinutes}
        />
      )}
    </div>
  );
};
