/**
 * Notifications page for project-level notification preferences
 *
 * Two-column layout matching ProjectSettingsPage pattern
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Save, X, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { adminApi } from '../api/admin';
import QRCode from 'react-qr-code';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { normalizeLabel } from '../utils/labels';

// DeepFaune v1.4 species list (38 European wildlife species)
const DEEPFAUNE_SPECIES = [
  'badger', 'bear', 'beaver', 'bird', 'bison', 'cat', 'chamois', 'cow',
  'dog', 'equid', 'fallow_deer', 'fox', 'genet', 'goat', 'golden_jackal',
  'hedgehog', 'ibex', 'lagomorph', 'lynx', 'marmot', 'micromammal', 'moose',
  'mouflon', 'muskrat', 'mustelid', 'nutria', 'otter', 'porcupine', 'raccoon',
  'raccoon_dog', 'red_deer', 'reindeer', 'roe_deer', 'sheep', 'squirrel',
  'wild_boar', 'wolf', 'wolverine'
].sort();

export const NotificationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { user } = useAuth();
  const { selectedProject } = useProject();

  // Telegram species state
  const [telegramNotifySpecies, setTelegramNotifySpecies] = useState<Option[]>([]);

  // Telegram linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  // Email reports state
  const [emailReportsEnabled, setEmailReportsEnabled] = useState(false);
  const [reportFrequency, setReportFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  // Excessive image alerts state
  const [excessiveImagesEnabled, setExcessiveImagesEnabled] = useState(false);
  const [excessiveImagesThreshold, setExcessiveImagesThreshold] = useState(50);

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

  // Use project's included species if configured, otherwise show all species
  // Always include person/vehicle as they are detection-level categories
  const availableSpecies = useMemo(() => {
    const baseSpecies = selectedProject?.included_species ?? DEEPFAUNE_SPECIES;
    return [...new Set([...baseSpecies, 'person', 'vehicle'])];
  }, [selectedProject?.included_species]);
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
        setEmailReportsEnabled(emailReportConfig.enabled || false);
        setReportFrequency(emailReportConfig.frequency || 'weekly');

        // Excessive image alerts configuration
        const excessiveConfig = notificationChannels.excessive_images || {};
        setExcessiveImagesEnabled(excessiveConfig.enabled || false);
        setExcessiveImagesThreshold(excessiveConfig.threshold || 50);

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
      alert('Notification preferences updated successfully!');
    },
    onError: (error: any) => {
      alert(`Failed to update preferences: ${error.response?.data?.detail || error.message}`);
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
      alert(`Failed to generate link: ${error.response?.data?.detail || error.message}`);
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
      alert('Telegram account unlinked successfully!');
    },
    onError: (error: any) => {
      alert(`Failed to unlink Telegram: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleUnlink = () => {
    if (confirm('Are you sure you want to unlink your Telegram account? You will need to link it again to receive notifications.')) {
      unlinkMutation.mutate();
    }
  };

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
          ? (telegramNotifySpecies.length > 0 ? telegramNotifySpecies.map(opt => opt.value) : null)
          : null
      },
      email_report: {
        enabled: emailReportsEnabled,
        frequency: reportFrequency
      },
      excessive_images: {
        enabled: excessiveImagesEnabled,
        threshold: excessiveImagesThreshold
      }
    };

    updateMutation.mutate({
      // Legacy fields (for backward compatibility)
      enabled: isTelegramLinked,
      signal_phone: null,
      telegram_chat_id: isTelegramLinked ? (linkStatus?.chat_id || null) : null,
      notify_species: legacySpeciesValues.length > 0 ? legacySpeciesValues : null,
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
      <p className="text-sm text-gray-600 mt-1 mb-6">Configure alerts for species detections and system events</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardContent className="pt-6">

              {/* Telegram section */}
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Telegram</h3>

              {/* Telegram status message */}
              <p className="text-sm text-muted-foreground mt-3">
                {isTelegramLinked ? (
                  <>
                    Your Telegram account is connected and ready to receive notifications.{' '}
                    {unlinkMutation.isPending ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin inline" />
                        <span className="text-primary">Unlinking...</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUnlink}
                        className="text-primary hover:underline font-medium"
                      >
                        Click here to unlink
                      </button>
                    )}.
                  </>
                ) : isTelegramConfigured ? (
                  <>
                    Telegram not linked to your account.{' '}
                    {generateTokenMutation.isPending ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin inline" />
                        <span className="text-primary">Generating link...</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleGenerateLink}
                        className="text-primary hover:underline font-medium"
                      >
                        Click here to link
                      </button>
                    )}.
                  </>
                ) : (
                  <>
                    A Telegram bot has not been configured yet.{' '}
                    {user?.is_superuser ? (
                      <Link to="/server/settings" className="text-primary hover:underline font-medium">
                        Click here to configure it
                      </Link>
                    ) : adminEmail ? (
                      <a href={`mailto:${adminEmail}`} className="text-primary hover:underline font-medium">
                        Click here to contact your server admin
                      </a>
                    ) : (
                      <span>Contact your server admin to set it up</span>
                    )}.
                  </>
                )}
              </p>

              {/* Species alerts row */}
              <div className={`flex items-center gap-8 mt-4 ${!isTelegramUsable ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Species alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {telegramNotifySpecies.length === 0
                      ? 'Leave empty to receive notifications for all species'
                      : `Notifications enabled for ${telegramNotifySpecies.length} species`}
                  </p>
                </div>
                <div className="flex-1">
                  <MultiSelect
                    options={speciesOptions}
                    value={telegramNotifySpecies}
                    onChange={setTelegramNotifySpecies}
                    placeholder="Select species to notify about..."
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Email section */}
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Email</h3>

              {/* Email reports row */}
              <div className="flex items-center gap-8 mt-4">
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Email reports</label>
                  <p className="text-sm text-muted-foreground mt-1">Scheduled summaries with project statistics and insights</p>
                </div>
                <div className="flex-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emailReportsEnabled}
                    onClick={() => setEmailReportsEnabled(!emailReportsEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      emailReportsEnabled ? 'bg-[#0f6064]' : 'bg-gray-300'
                    } cursor-pointer`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      emailReportsEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>

              {/* Report frequency row */}
              <div className={`flex items-center gap-8 mt-4 ${!emailReportsEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Report frequency</label>
                  <p className="text-sm text-muted-foreground mt-1">How often to send email reports</p>
                </div>
                <div className="flex-1">
                  <select
                    value={reportFrequency}
                    onChange={(e) => setReportFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="daily">Daily (sent at 06:00 UTC)</option>
                    <option value="weekly">Weekly (sent every Monday)</option>
                    <option value="monthly">Monthly (sent on the 1st)</option>
                  </select>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Excessive image alerts row */}
              <div className="flex items-center gap-8">
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Excessive image alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">Get notified when a camera sends too many images in a day</p>
                </div>
                <div className="flex-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={excessiveImagesEnabled}
                    onClick={() => setExcessiveImagesEnabled(!excessiveImagesEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      excessiveImagesEnabled ? 'bg-[#0f6064]' : 'bg-gray-300'
                    } cursor-pointer`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      excessiveImagesEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>

              {/* Image threshold row */}
              <div className={`flex items-center gap-8 mt-4 ${!excessiveImagesEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Image threshold</label>
                  <p className="text-sm text-muted-foreground mt-1">Alert when a camera exceeds this many images per day</p>
                </div>
                <div className="flex-1">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={excessiveImagesThreshold}
                    onChange={(e) => setExcessiveImagesThreshold(Math.max(1, Math.min(1000, Number(e.target.value) || 50)))}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
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
      {showLinkModal && deepLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Link your Telegram account</h2>
                <button
                  onClick={() => setShowLinkModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* QR code */}
                <div className="flex justify-center bg-white p-4 rounded-lg">
                  <QRCode value={deepLink} size={200} />
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
