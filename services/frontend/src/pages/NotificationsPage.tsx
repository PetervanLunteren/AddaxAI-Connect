/**
 * Notifications page for project-level notification preferences
 *
 * Multi-channel notification configuration with separate settings per channel
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Save, Check, X, MessageCircle, XCircle, Copy, Settings, Mail } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
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

// Copy button component for inline code examples
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center p-1 ml-1 hover:bg-accent rounded transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
};

export const NotificationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { user } = useAuth();
  const { selectedProject } = useProject();

  // Telegram channel state
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramNotifySpecies, setTelegramNotifySpecies] = useState<Option[]>([]);
  const [telegramTestStatus, setTelegramTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [telegramTestMessage, setTelegramTestMessage] = useState('');

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

  // Query Telegram configuration (to check if bot is set up)
  const { data: telegramConfig } = useQuery({
    queryKey: ['telegram-config'],
    queryFn: async () => {
      try {
        return await adminApi.getTelegramConfig();
      } catch (error: any) {
        // 404 is expected when Telegram is not configured yet
        if (error?.response?.status === 404) {
          return { is_configured: false, bot_username: null };
        }
        throw error;
      }
    },
    retry: false,
  });

  const isTelegramConfigured = telegramConfig?.is_configured ?? false;
  const botUsername = telegramConfig?.bot_username ?? null;

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

      // Check which channels have contact info configured
      const hasTelegramChatId = !!(preferences as any).telegram_chat_id;

      // If notification_channels JSON exists, use it (new multi-channel format)
      if (notificationChannels) {
        const speciesConfig = notificationChannels.species_detection || {};
        const speciesChannels = speciesConfig.channels || [];

        // Telegram configuration
        const telegramInSpecies = speciesChannels.includes('telegram');

        setTelegramEnabled(telegramInSpecies && hasTelegramChatId);
        setTelegramChatId((preferences as any).telegram_chat_id || '');

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
        const speciesOptions = (preferences.notify_species || [])
          .filter(species => availableSpecies.includes(species))
          .map(species => ({
            label: normalizeLabel(species),
            value: species
          }));

        // Telegram - mark as enabled if chat ID exists and enabled
        setTelegramEnabled(hasTelegramChatId && preferences.enabled);
        setTelegramChatId((preferences as any).telegram_chat_id || '');
        setTelegramNotifySpecies(speciesOptions);
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

  // Test Telegram message mutation
  const testTelegramMutation = useMutation({
    mutationFn: () => adminApi.sendTestTelegramMessage(telegramChatId.trim(), 'Test from AddaxAI Connect!'),
    onSuccess: () => {
      setTelegramTestStatus('success');
      setTelegramTestMessage('Test message sent!');
      setTimeout(() => { setTelegramTestStatus('idle'); setTelegramTestMessage(''); }, 5000);
    },
    onError: (error: any) => {
      setTelegramTestStatus('error');
      setTelegramTestMessage(error.response?.data?.detail || 'Failed to send');
      setTimeout(() => { setTelegramTestStatus('idle'); setTelegramTestMessage(''); }, 5000);
    },
  });

  const handleTestTelegram = () => {
    if (!telegramChatId.trim()) {
      setTelegramTestStatus('error');
      setTelegramTestMessage('Enter chat ID first');
      setTimeout(() => { setTelegramTestStatus('idle'); setTelegramTestMessage(''); }, 3000);
      return;
    }
    testTelegramMutation.mutate();
  };

  // Query Telegram link status
  const { data: linkStatus, refetch: refetchLinkStatus } = useQuery({
    queryKey: ['telegram-link-status', projectIdNum],
    queryFn: () => notificationsApi.checkTelegramLinkStatus(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0 && isTelegramConfigured,
    refetchInterval: false,
  });

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

  const handleCheckStatus = () => {
    refetchLinkStatus();
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

    // Clean inputs
    const cleanedChatId = telegramChatId.trim();

    // Build notification_channels JSON structure
    const channels: string[] = [];
    if (telegramEnabled) channels.push('telegram');

    // Use Telegram settings for legacy fields
    const legacySpeciesValues = telegramEnabled ? telegramNotifySpecies.map(opt => opt.value) : [];

    // Build notification_channels JSON with per-channel configuration
    const notificationChannels = {
      species_detection: {
        enabled: telegramEnabled,
        channels: channels,
        notify_species: telegramEnabled
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
      enabled: telegramEnabled,
      signal_phone: null,
      telegram_chat_id: telegramEnabled ? (cleanedChatId || null) : null,
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
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Telegram notifications card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                <CardTitle>Telegram notifications</CardTitle>
              </div>
              <CardDescription>
                Receive notifications via Telegram messenger
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Checkbox
                id="telegram-enabled"
                checked={telegramEnabled}
                onChange={setTelegramEnabled}
                label="Enable Telegram notifications"
                disabled={!isTelegramConfigured}
              />

              {/* Link status - when Telegram configured and enabled */}
              {isTelegramConfigured && telegramEnabled && (
                <div className="mt-3 mb-4">
                  {linkStatus?.linked ? (
                    // Linked - show simple caption with unlink
                    <div className="mt-3">
                      <p className="text-sm text-muted-foreground">
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
                      </p>
                    </div>
                  ) : (
                    // Not linked - show simple caption with link
                    <div className="mt-3">
                      <p className="text-sm text-muted-foreground">
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
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Warning banner - when Telegram not configured */}
              {telegramEnabled && !isTelegramConfigured && (
                <div className="mb-4 p-4 border-2 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 rounded-md">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 mt-1">
                      <XCircle className="h-8 w-8 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-100">Telegram not configured</h3>
                      <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                        Telegram notifications are not available because the bot has not been set up yet.
                      </p>
                      {user?.is_superuser ? (
                        <Link
                          to="/server/settings"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium text-sm"
                        >
                          <Settings className="h-4 w-4" />
                          Configure Telegram
                        </Link>
                      ) : (
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                          Please contact your administrator to set up Telegram notifications.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Notification options - only show if enabled and linked */}
              {telegramEnabled && linkStatus?.linked && (
                <>
                  {/* Species alerts */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Species alerts
                    </label>
                    <MultiSelect
                      options={speciesOptions}
                      value={telegramNotifySpecies}
                      onChange={setTelegramNotifySpecies}
                      placeholder="Select species to notify about..."
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      {telegramNotifySpecies.length === 0
                        ? 'Leave empty to receive notifications for all species'
                        : `Notifications enabled for ${telegramNotifySpecies.length} ${telegramNotifySpecies.length === 1 ? 'species' : 'species'}`}
                    </p>
                  </div>

                </>
              )}
            </CardContent>
          </Card>

          {/* Email reports card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                <CardTitle>Email reports</CardTitle>
              </div>
              <CardDescription>
                Receive scheduled email summaries with project statistics and insights
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Checkbox
                id="email-reports-enabled"
                checked={emailReportsEnabled}
                onChange={setEmailReportsEnabled}
                label="Enable email reports"
              />

              {emailReportsEnabled && (
                <div>
                  <label htmlFor="report-frequency" className="block text-sm font-medium mb-2">
                    Report frequency
                  </label>
                  <select
                    id="report-frequency"
                    value={reportFrequency}
                    onChange={(e) => setReportFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="daily">Daily (sent at 06:00 UTC)</option>
                    <option value="weekly">Weekly (sent every Monday)</option>
                    <option value="monthly">Monthly (sent on the 1st)</option>
                  </select>
                </div>
              )}

              <Checkbox
                id="excessive-images"
                checked={excessiveImagesEnabled}
                onChange={setExcessiveImagesEnabled}
                label="Excessive image alerts"
              />

              {excessiveImagesEnabled && (
                <div className="pl-8">
                  <label htmlFor="excessive-threshold" className="block text-sm font-medium mb-2">
                    Image threshold per camera per day
                  </label>
                  <input
                    id="excessive-threshold"
                    type="number"
                    min={1}
                    max={1000}
                    value={excessiveImagesThreshold}
                    onChange={(e) => setExcessiveImagesThreshold(Math.max(1, Math.min(1000, Number(e.target.value) || 50)))}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Get notified when a camera sends more than this many images in a day
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

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
