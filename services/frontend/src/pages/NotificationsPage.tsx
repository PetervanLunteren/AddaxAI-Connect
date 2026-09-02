/**
 * Notifications page for project-level notification preferences
 *
 * Two-column layout matching ProjectSettingsPage pattern
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2, Save, MessageCircle, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { SettingRow, SettingRowDivider } from '../components/ui/SettingRow';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toaster';
import { notificationsApi } from '../api/notifications';
import { remindersApi } from '../api/reminders';
import { RemindersSheet } from '../components/RemindersSheet';
import { CameraAlertRulesSheet } from '../components/CameraAlertRulesSheet';
import { cameraAlertRulesApi } from '../api/cameraAlertRules';
import { DetectionAlertRulesSheet } from '../components/DetectionAlertRulesSheet';
import { detectionAlertRulesApi } from '../api/detectionAlertRules';
import { SpeciesReportsSheet } from '../components/SpeciesReportsSheet';
import { scheduledReportsApi } from '../api/scheduledReports';
import { TheftWatchSheet } from '../components/TheftWatchSheet';
import { theftWatchApi } from '../api/theftWatch';
import { adminApi } from '../api/admin';
import QRCode from 'react-qr-code';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { useRuleOptions } from '../hooks/useRuleOptions';

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
  const [showSpeciesReportsSheet, setShowSpeciesReportsSheet] = useState(false);
  const [showTheftWatchSheet, setShowTheftWatchSheet] = useState(false);

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
  const { siteOptions, speciesOptions, defaultCooldownMinutes } = useRuleOptions(
    projectIdNum, selectedProject,
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

  // And for the species reports row. Same query key as the sheet, so
  // changes made there refresh this badge too.
  const { data: speciesReportRules } = useQuery({
    queryKey: ['species-report-rules', projectIdNum],
    queryFn: () => scheduledReportsApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });
  const activeSpeciesReportCount = (speciesReportRules || []).filter((r) => r.is_active).length;

  // And for the theft watch row
  const { data: theftWatchRules } = useQuery({
    queryKey: ['theft-watch-rules', projectIdNum],
    queryFn: () => theftWatchApi.list(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });
  const activeTheftWatchCount = (theftWatchRules || []).filter((r) => r.is_active).length;

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
                  <SettingRow
                    title="Telegram account"
                    description={isTelegramLinked
                      ? 'Your Telegram account is linked. Alert rules can send you Telegram messages with photos.'
                      : 'Link your Telegram account so alert rules can send you instant Telegram messages with photos.'}
                  >
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
                  </SettingRow>

                  <SettingRowDivider />
                </>
              )}

              {/* Real-time detection alerts row (any member). The slideout
                  holds the rule list plus add / edit / delete. */}
              <SettingRow
                title="Real-time detection alerts"
                description="Get an instant email or Telegram message with a photo each time a selected label is detected. Rules can be narrowed by site, time of day, or group size, and quieted with a cooldown. Only you receive your alerts."
              >
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
              </SettingRow>

              <SettingRowDivider />

              {/* Email reports row */}
              <SettingRow
                title="Project updates"
                description="Receive a scheduled email with a summary of your project, including the number of new images, species detected, and camera activity since the last report."
              >
                <div className="relative">
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
              </SettingRow>

              <SettingRowDivider />

              {/* Species reports row (any member). The slideout holds the
                  report list plus add / edit / delete. */}
              <SettingRow
                title="Species reports"
                description="Get a weekly, monthly, or quarterly email with the numbers for selected species. Each report shows a per-site table with counts, trap-days, and detections per 100 trap-days. Only you receive your reports."
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSpeciesReportsSheet(true)}
                >
                  Manage species reports
                  {activeSpeciesReportCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                      {activeSpeciesReportCount}
                    </span>
                  )}
                </Button>
              </SettingRow>

              <SettingRowDivider />

              {/* Theft watch row (any member, beta). The slideout holds
                  the rule list plus add / edit / delete. */}
              <SettingRow
                title={
                  <>
                    Theft watch
                    <span className="ml-2 align-middle inline-flex items-center px-1.5 h-5 text-[10px] font-semibold uppercase tracking-wide rounded bg-[#882000]/10 text-[#882000]">
                      beta
                    </span>
                  </>
                }
                description="An experimental attempt to notice camera theft or tampering. A person unusually close to a camera sends an instant alert, and a camera that stays silent longer than its own normal rhythm sends an alert within hours or days. It can miss real thefts and it can raise false alarms. Only you receive your alerts."
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTheftWatchSheet(true)}
                >
                  Manage theft watch
                  {activeTheftWatchCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                      {activeTheftWatchCount}
                    </span>
                  )}
                </Button>
              </SettingRow>

              {/* Project inactivity alerts row (project admins only) */}
              {canAdminCurrentProject && (
                <>
                  <SettingRowDivider />
                  <SettingRow
                    title="Project inactivity alert"
                    description="Receive an email if this project receives zero images in 48 hours. This usually means something is wrong with the server or network."
                  >
                    <div className="relative">
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
                  </SettingRow>
                </>
              )}

              {/* SIM expiry alert row (project admins only) */}
              {canAdminCurrentProject && (
                <>
                  <SettingRowDivider />
                  <SettingRow
                    title="SIM expiry alert"
                    description="Receive an email on the 1st of every month listing cameras in this project whose SIM card expires within the next two months or has already expired. The email keeps coming every month until the date is updated."
                  >
                    <div className="relative">
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
                  </SettingRow>
                </>
              )}

              {/* Scheduled reminders row (project admins only). The
                  manage-reminders slideout holds the full list + add /
                  edit / cancel UI, keeping this row consistent with the
                  rest of the notifications page. */}
              {canAdminCurrentProject && (
                <>
                  <SettingRowDivider />
                  <SettingRow
                    title="Scheduled reminders"
                    description="Schedule a one-shot email to your future self. Useful for project end dates, seasonal cleanup deadlines, hardware swaps. The email lands only with you."
                  >
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
                  </SettingRow>
                </>
              )}

              {/* Camera condition alerts row (any member). The slideout
                  holds the rule list plus add / edit / delete. */}
              <SettingRowDivider />
              <SettingRow
                title="Camera condition alerts"
                description="Get an email or Telegram message when a camera's battery drops below a threshold, its SD card fills up, or it goes silent for too long. Alerts fire once per incident and re-arm when the camera recovers. Only you receive your alerts."
              >
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
              </SettingRow>

              <SettingRowDivider />

              {/* Excessive image alerts row */}
              <SettingRow
                title="Excessive image alerts"
                description="Receive an email alert when a camera exceeds a daily image threshold. This usually indicates a problem like waving grass or direct sunlight triggering the sensor repeatedly."
              >
                <div className="relative">
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
              </SettingRow>

              <SettingRowDivider />

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

      {/* Species reports slideout (any member). Rules are private, only
          the creator receives the emails. */}
      {projectIdNum > 0 && (
        <SpeciesReportsSheet
          open={showSpeciesReportsSheet}
          onClose={() => setShowSpeciesReportsSheet(false)}
          projectId={projectIdNum}
          speciesOptions={speciesOptions}
        />
      )}

      {/* Theft watch slideout (any member, beta). Rules are private,
          only the creator receives the alerts. */}
      {projectIdNum > 0 && (
        <TheftWatchSheet
          open={showTheftWatchSheet}
          onClose={() => setShowTheftWatchSheet(false)}
          projectId={projectIdNum}
          telegramLinked={isTelegramLinked}
          siteOptions={siteOptions}
        />
      )}
    </div>
  );
};
