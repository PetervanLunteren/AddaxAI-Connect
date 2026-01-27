/**
 * Notifications page for project-level notification preferences
 *
 * Multi-channel notification configuration with separate settings per channel
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Save, Check, X, MessageCircle, XCircle, Copy, Settings } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { adminApi } from '../api/admin';
import QRCode from 'react-qr-code';
import { useAuth } from '../hooks/useAuth';
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

  // Telegram channel state
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramNotifySpecies, setTelegramNotifySpecies] = useState<Option[]>([]);
  const [telegramNotifyLowBattery, setTelegramNotifyLowBattery] = useState(true);
  const [telegramBatteryThreshold, setTelegramBatteryThreshold] = useState(30);
  const [telegramNotifySystemHealth, setTelegramNotifySystemHealth] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [telegramTestMessage, setTelegramTestMessage] = useState('');

  // Telegram linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  // Query preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notification-preferences', projectIdNum],
    queryFn: () => notificationsApi.getPreferences(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });

  // Query Telegram configuration (to check if bot is set up)
  const { data: telegramConfig } = useQuery({
    queryKey: ['telegram-config'],
    queryFn: adminApi.getTelegramConfig,
    retry: false,
  });

  const isTelegramConfigured = telegramConfig?.is_configured ?? false;
  const botUsername = telegramConfig?.bot_username ?? null;

  // Create species options from hardcoded list with sentence case formatting
  const speciesOptions: Option[] = DEEPFAUNE_SPECIES.map(species => ({
    label: normalizeLabel(species),
    value: species
  }));

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      const notificationChannels = (preferences as any).notification_channels;

      // Check which channels have contact info configured
      const hasTelegramChatId = !!(preferences as any).telegram_chat_id;

      // If notification_channels JSON exists, use it (new multi-channel format)
      if (notificationChannels) {
        const speciesConfig = notificationChannels.species_detection || {};
        const batteryConfig = notificationChannels.battery_digest || {};
        const healthConfig = notificationChannels.system_health || {};

        const speciesChannels = speciesConfig.channels || [];
        const batteryChannels = batteryConfig.channels || [];
        const healthChannels = healthConfig.channels || [];

        // Telegram configuration
        const telegramInSpecies = speciesChannels.includes('telegram');
        const telegramInBattery = batteryChannels.includes('telegram');
        const telegramInHealth = healthChannels.includes('telegram');
        const telegramEnabledAny = telegramInSpecies || telegramInBattery || telegramInHealth;

        setTelegramEnabled(telegramEnabledAny && hasTelegramChatId);
        setTelegramChatId((preferences as any).telegram_chat_id || '');

        // Convert species to options
        const telegramSpeciesValues = speciesConfig.notify_species || [];
        setTelegramNotifySpecies(telegramSpeciesValues.map((species: string) => ({
          label: normalizeLabel(species),
          value: species
        })));

        setTelegramNotifyLowBattery(telegramInBattery);
        setTelegramBatteryThreshold(batteryConfig.battery_threshold || 30);
        setTelegramNotifySystemHealth(telegramInHealth);

      } else {
        // Fall back to legacy fields if notification_channels doesn't exist
        const speciesOptions = (preferences.notify_species || []).map(species => ({
          label: normalizeLabel(species),
          value: species
        }));

        // Telegram - mark as enabled if chat ID exists and enabled
        setTelegramEnabled(hasTelegramChatId && preferences.enabled);
        setTelegramChatId((preferences as any).telegram_chat_id || '');
        setTelegramNotifySpecies(speciesOptions);
        setTelegramNotifyLowBattery(preferences.notify_low_battery);
        setTelegramBatteryThreshold(preferences.battery_threshold);
        setTelegramNotifySystemHealth(preferences.notify_system_health);
      }
    }
  }, [preferences]);

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
    const legacyLowBattery = telegramEnabled && telegramNotifyLowBattery;
    const legacyBatteryThreshold = telegramBatteryThreshold;
    const legacySystemHealth = telegramEnabled && telegramNotifySystemHealth;

    // Build notification_channels JSON with per-channel configuration
    const notificationChannels = {
      species_detection: {
        enabled: telegramEnabled,
        channels: channels,
        notify_species: telegramEnabled
          ? (telegramNotifySpecies.length > 0 ? telegramNotifySpecies.map(opt => opt.value) : null)
          : null
      },
      battery_digest: {
        enabled: telegramEnabled && telegramNotifyLowBattery,
        channels: telegramNotifyLowBattery ? channels : [],
        battery_threshold: telegramBatteryThreshold
      },
      system_health: {
        enabled: telegramEnabled && telegramNotifySystemHealth,
        channels: telegramNotifySystemHealth ? channels : []
      }
    };

    updateMutation.mutate({
      // Legacy fields (for backward compatibility)
      enabled: telegramEnabled,
      signal_phone: null,
      telegram_chat_id: telegramEnabled ? (cleanedChatId || null) : null,
      notify_species: legacySpeciesValues.length > 0 ? legacySpeciesValues : null,
      notify_low_battery: legacyLowBattery,
      battery_threshold: legacyBatteryThreshold,
      notify_system_health: legacySystemHealth,
      // New multi-channel configuration
      notification_channels: notificationChannels,
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Notifications</h1>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Telegram Notifications Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                <CardTitle>Telegram Notifications</CardTitle>
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

              {/* Link Status and Button - When Telegram Configured AND Enabled */}
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

              {/* Warning Banner - When Telegram Not Configured and User Wants to Enable */}
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
                          to="/server/telegram-config"
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

              {/* Notification Options - Only show if enabled AND linked */}
              {telegramEnabled && linkStatus?.linked && (
                <>
                  {/* Species Alerts */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Species Alerts
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

                  {/* Battery Warnings */}
                  <div>
                    <Checkbox
                      id="telegram-battery"
                      checked={telegramNotifyLowBattery}
                      onChange={setTelegramNotifyLowBattery}
                      label="Battery Warnings"
                      className="mb-3"
                    />

                    {telegramNotifyLowBattery && (
                      <div className="pl-8">
                        <label className="block text-sm font-medium mb-2">
                          Battery Threshold (%)
                        </label>
                        <div className="flex items-center gap-4">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={telegramBatteryThreshold}
                            onChange={(e) => setTelegramBatteryThreshold(Number(e.target.value))}
                            className="flex-1 accent-primary"
                          />
                          <span className="font-medium w-12 text-right">{telegramBatteryThreshold}%</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Notify when battery drops below this level
                        </p>
                      </div>
                    )}
                  </div>

                  {/* System Health */}
                  <Checkbox
                    id="telegram-health"
                    checked={telegramNotifySystemHealth}
                    onChange={setTelegramNotifySystemHealth}
                    label="System Health Alerts"
                  />
                </>
              )}
            </CardContent>
          </Card>

          {/* Save Button */}
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
                  Save Preferences
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Telegram Linking Modal */}
      {showLinkModal && deepLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Link Your Telegram Account</h2>
                <button
                  onClick={() => setShowLinkModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* QR Code */}
                <div className="flex justify-center bg-white p-4 rounded-lg">
                  <QRCode value={deepLink} size={200} />
                </div>

                {/* Open Telegram Button */}
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

                {/* Check Status Button */}
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
