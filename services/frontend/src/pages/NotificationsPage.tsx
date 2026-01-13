/**
 * Notifications page for project-level notification preferences
 *
 * Multi-channel notification configuration with separate settings per channel
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2, Save, Send, Check, X, MessageCircle, XCircle, Copy, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { adminApi } from '../api/admin';

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

  // Telegram channel state
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramNotifySpecies, setTelegramNotifySpecies] = useState<Option[]>([]);
  const [telegramNotifyLowBattery, setTelegramNotifyLowBattery] = useState(true);
  const [telegramBatteryThreshold, setTelegramBatteryThreshold] = useState(30);
  const [telegramNotifySystemHealth, setTelegramNotifySystemHealth] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [telegramTestMessage, setTelegramTestMessage] = useState('');

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
    label: species.replace(/_/g, ' ').replace(/\b\w/, l => l.toUpperCase()), // Sentence case: "Red deer"
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
          label: species.replace(/_/g, ' ').replace(/\b\w/, l => l.toUpperCase()),
          value: species
        })));

        setTelegramNotifyLowBattery(telegramInBattery);
        setTelegramBatteryThreshold(batteryConfig.battery_threshold || 30);
        setTelegramNotifySystemHealth(telegramInHealth);

      } else {
        // Fall back to legacy fields if notification_channels doesn't exist
        const speciesOptions = (preferences.notify_species || []).map(species => ({
          label: species.replace(/_/g, ' ').replace(/\b\w/, l => l.toUpperCase()),
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
              {/* Warning Banner - When Telegram Not Configured */}
              {!isTelegramConfigured && (
                <div className="mb-4 p-4 border-2 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 rounded-md">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 mt-1">
                      <XCircle className="h-8 w-8 text-red-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-2 text-red-900 dark:text-red-100">Telegram not configured</h3>
                      <p className="text-sm text-red-800 dark:text-red-200 mb-3">
                        Telegram bot has not been set up by your administrator. Contact your admin to enable Telegram notifications.
                      </p>
                      <button
                        type="button"
                        disabled
                        className="px-4 py-2 bg-gray-300 text-gray-500 rounded-md cursor-not-allowed opacity-60"
                        title="Only administrators can configure Telegram"
                      >
                        Configure Telegram
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <Checkbox
                id="telegram-enabled"
                checked={telegramEnabled}
                onChange={setTelegramEnabled}
                label="Enable Telegram notifications"
                disabled={!isTelegramConfigured}
              />

              {telegramEnabled && (
                <>
                  {/* Telegram Chat ID */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Telegram Chat ID
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value)}
                        placeholder="123456789"
                        disabled={!isTelegramConfigured}
                        className="flex-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={handleTestTelegram}
                        disabled={!isTelegramConfigured || !telegramChatId.trim() || testTelegramMutation.isPending}
                        className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                      >
                        {testTelegramMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="hidden sm:inline">Sending...</span>
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            <span className="hidden sm:inline">Test</span>
                          </>
                        )}
                      </button>
                    </div>
                    {telegramTestStatus === 'success' && (
                      <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
                        <Check className="h-4 w-4" />
                        {telegramTestMessage}
                      </div>
                    )}
                    {telegramTestStatus === 'error' && (
                      <div className="flex items-center gap-2 text-sm text-destructive mt-1">
                        <X className="h-4 w-4" />
                        {telegramTestMessage}
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">
                      {botUsername ? (
                        <>
                          To get your chat ID: search for{' '}
                          <code className="px-1.5 py-0.5 bg-muted rounded inline-flex items-center">
                            @{botUsername}
                            <CopyButton text={`@${botUsername}`} />
                          </code>
                          {' '}on Telegram, send{' '}
                          <code className="px-1.5 py-0.5 bg-muted rounded inline-flex items-center">
                            /start
                            <CopyButton text="/start" />
                          </code>
                          , and copy the chat ID from the bot's reply.
                        </>
                      ) : (
                        'To get your chat ID: search for your bot on Telegram, send /start, and copy the chat ID from the bot\'s reply.'
                      )}
                    </p>
                  </div>

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
    </div>
  );
};
