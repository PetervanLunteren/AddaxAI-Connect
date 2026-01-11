/**
 * Notifications page for project-level notification preferences
 *
 * Multi-channel notification configuration with separate settings per channel
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Bell, Loader2, Save, Send, Check, X, MessageCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { adminApi } from '../api/admin';
import { imagesApi } from '../api/images';

export const NotificationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);

  // Signal channel state
  const [signalEnabled, setSignalEnabled] = useState(false);
  const [signalPhone, setSignalPhone] = useState('');
  const [signalNotifySpecies, setSignalNotifySpecies] = useState<Option[]>([]);
  const [signalNotifyLowBattery, setSignalNotifyLowBattery] = useState(true);
  const [signalBatteryThreshold, setSignalBatteryThreshold] = useState(30);
  const [signalNotifySystemHealth, setSignalNotifySystemHealth] = useState(false);
  const [signalTestStatus, setSignalTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [signalTestMessage, setSignalTestMessage] = useState('');

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

  // Query available species
  const { data: availableSpecies = [] } = useQuery({
    queryKey: ['species', projectIdNum],
    queryFn: () => imagesApi.getSpecies(),
    enabled: !!projectIdNum && projectIdNum > 0,
  });

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      // Check which channels have contact info configured
      const hasSignal = !!preferences.signal_phone;
      const hasTelegram = !!(preferences as any).telegram_chat_id;

      // Convert species strings to Option objects
      const speciesOptions = (preferences.notify_species || []).map(species => ({
        label: species.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: species
      }));

      // Signal - only mark as enabled if both enabled flag is true AND phone exists
      setSignalEnabled(preferences.enabled && hasSignal);
      setSignalPhone(preferences.signal_phone || '');
      setSignalNotifySpecies(speciesOptions);
      setSignalNotifyLowBattery(preferences.notify_low_battery);
      setSignalBatteryThreshold(preferences.battery_threshold);
      setSignalNotifySystemHealth(preferences.notify_system_health);

      // Telegram - mark as enabled if chat ID exists and either:
      // - enabled flag is true, OR
      // - enabled flag is true but no signal phone (meaning only telegram is configured)
      setTelegramEnabled(hasTelegram && (preferences.enabled || !hasSignal));
      setTelegramChatId((preferences as any).telegram_chat_id || '');
      setTelegramNotifySpecies(speciesOptions);
      setTelegramNotifyLowBattery(preferences.notify_low_battery);
      setTelegramBatteryThreshold(preferences.battery_threshold);
      setTelegramNotifySystemHealth(preferences.notify_system_health);
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

  // Test Signal message mutation
  const testSignalMutation = useMutation({
    mutationFn: () => adminApi.sendTestSignalMessage(signalPhone.trim().replace(/\s/g, ''), 'Test from AddaxAI Connect!'),
    onSuccess: () => {
      setSignalTestStatus('success');
      setSignalTestMessage('Test message sent!');
      setTimeout(() => { setSignalTestStatus('idle'); setSignalTestMessage(''); }, 5000);
    },
    onError: (error: any) => {
      setSignalTestStatus('error');
      setSignalTestMessage(error.response?.data?.detail || 'Failed to send');
      setTimeout(() => { setSignalTestStatus('idle'); setSignalTestMessage(''); }, 5000);
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

  const handleTestSignal = () => {
    if (!signalPhone.trim()) {
      setSignalTestStatus('error');
      setSignalTestMessage('Enter phone number first');
      setTimeout(() => { setSignalTestStatus('idle'); setSignalTestMessage(''); }, 3000);
      return;
    }
    testSignalMutation.mutate();
  };

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
    const cleanedPhone = signalPhone.trim().replace(/\s/g, '');
    const cleanedChatId = telegramChatId.trim();

    // Determine which channel's settings to use as "master"
    // Priority: Signal if enabled, otherwise Telegram, otherwise disabled
    let speciesValues: string[] = [];
    let lowBattery = false;
    let batteryThreshold = 30;
    let systemHealth = false;

    if (signalEnabled) {
      // Use Signal settings
      speciesValues = signalNotifySpecies.map(opt => opt.value);
      lowBattery = signalNotifyLowBattery;
      batteryThreshold = signalBatteryThreshold;
      systemHealth = signalNotifySystemHealth;
    } else if (telegramEnabled) {
      // Use Telegram settings
      speciesValues = telegramNotifySpecies.map(opt => opt.value);
      lowBattery = telegramNotifyLowBattery;
      batteryThreshold = telegramBatteryThreshold;
      systemHealth = telegramNotifySystemHealth;
    }

    updateMutation.mutate({
      enabled: signalEnabled || telegramEnabled,
      signal_phone: signalEnabled ? (cleanedPhone || null) : null,
      telegram_chat_id: telegramEnabled ? (cleanedChatId || null) : null,
      notify_species: speciesValues.length > 0 ? speciesValues : null,
      notify_low_battery: lowBattery,
      battery_threshold: batteryThreshold,
      notify_system_health: systemHealth,
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
          {/* Signal Notifications Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <CardTitle>Signal Notifications</CardTitle>
              </div>
              <CardDescription>
                Receive notifications via Signal messenger
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Checkbox
                id="signal-enabled"
                checked={signalEnabled}
                onChange={setSignalEnabled}
                label="Enable Signal notifications"
              />

              {signalEnabled && (
                <>
                  {/* Signal Phone */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Signal Phone Number
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={signalPhone}
                        onChange={(e) => setSignalPhone(e.target.value)}
                        placeholder="+31612345678"
                        className="flex-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
                      />
                      <button
                        type="button"
                        onClick={handleTestSignal}
                        disabled={!signalPhone.trim() || testSignalMutation.isPending}
                        className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                      >
                        {testSignalMutation.isPending ? (
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
                    {signalTestStatus === 'success' && (
                      <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
                        <Check className="h-4 w-4" />
                        {signalTestMessage}
                      </div>
                    )}
                    {signalTestStatus === 'error' && (
                      <div className="flex items-center gap-2 text-sm text-destructive mt-1">
                        <X className="h-4 w-4" />
                        {signalTestMessage}
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">
                      Include country code (e.g., +31 for Netherlands, +1 for USA). Must have Signal installed.
                    </p>
                  </div>

                  {/* Species Alerts */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Species Alerts
                    </label>
                    <MultiSelect
                      options={availableSpecies}
                      value={signalNotifySpecies}
                      onChange={setSignalNotifySpecies}
                      placeholder="Select species to notify about..."
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      {signalNotifySpecies.length === 0
                        ? 'Leave empty to receive notifications for all species'
                        : `Notifications enabled for ${signalNotifySpecies.length} ${signalNotifySpecies.length === 1 ? 'species' : 'species'}`}
                    </p>
                  </div>

                  {/* Battery Warnings */}
                  <div>
                    <Checkbox
                      id="signal-battery"
                      checked={signalNotifyLowBattery}
                      onChange={setSignalNotifyLowBattery}
                      label="Battery Warnings"
                      className="mb-3"
                    />

                    {signalNotifyLowBattery && (
                      <div className="pl-8">
                        <label className="block text-sm font-medium mb-2">
                          Battery Threshold (%)
                        </label>
                        <div className="flex items-center gap-4">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={signalBatteryThreshold}
                            onChange={(e) => setSignalBatteryThreshold(Number(e.target.value))}
                            className="flex-1 accent-primary"
                          />
                          <span className="font-medium w-12 text-right">{signalBatteryThreshold}%</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Notify when battery drops below this level
                        </p>
                      </div>
                    )}
                  </div>

                  {/* System Health */}
                  <Checkbox
                    id="signal-health"
                    checked={signalNotifySystemHealth}
                    onChange={setSignalNotifySystemHealth}
                    label="System Health Alerts"
                  />
                </>
              )}
            </CardContent>
          </Card>

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
                        className="flex-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
                      />
                      <button
                        type="button"
                        onClick={handleTestTelegram}
                        disabled={!telegramChatId.trim() || testTelegramMutation.isPending}
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
                      To get your chat ID: search for your bot on Telegram, send /start, and copy the chat ID from the bot's reply.
                    </p>
                  </div>

                  {/* Species Alerts */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Species Alerts
                    </label>
                    <MultiSelect
                      options={availableSpecies}
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
