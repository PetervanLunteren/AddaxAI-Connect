/**
 * Notifications page for project-level notification preferences
 *
 * Allows users to configure their personal notification settings for this specific project
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Bell, Loader2, Save, Send, Check, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { notificationsApi } from '../api/notifications';
import { adminApi } from '../api/admin';

export const NotificationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [signalPhone, setSignalPhone] = useState('');
  const [notifySpecies, setNotifySpecies] = useState<string[]>([]);
  const [notifyLowBattery, setNotifyLowBattery] = useState(true);
  const [batteryThreshold, setBatteryThreshold] = useState(30);
  const [notifySystemHealth, setNotifySystemHealth] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // Query preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notification-preferences', projectIdNum],
    queryFn: () => notificationsApi.getPreferences(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      setEnabled(preferences.enabled);
      setSignalPhone(preferences.signal_phone || '');
      setNotifySpecies(preferences.notify_species || []);
      setNotifyLowBattery(preferences.notify_low_battery);
      setBatteryThreshold(preferences.battery_threshold);
      setNotifySystemHealth(preferences.notify_system_health);
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

  // Test message mutation
  const testMessageMutation = useMutation({
    mutationFn: () => adminApi.sendTestSignalMessage(signalPhone.trim().replace(/\s/g, ''), 'This is a test message from AddaxAI Connect!'),
    onSuccess: () => {
      setTestStatus('success');
      setTestMessage('Test message sent successfully!');
      setTimeout(() => {
        setTestStatus('idle');
        setTestMessage('');
      }, 5000);
    },
    onError: (error: any) => {
      setTestStatus('error');
      setTestMessage(error.response?.data?.detail || error.message || 'Failed to send test message');
      setTimeout(() => {
        setTestStatus('idle');
        setTestMessage('');
      }, 5000);
    },
  });

  const handleTestMessage = () => {
    if (!signalPhone.trim()) {
      setTestStatus('error');
      setTestMessage('Please enter a phone number first');
      setTimeout(() => {
        setTestStatus('idle');
        setTestMessage('');
      }, 3000);
      return;
    }
    testMessageMutation.mutate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate phone number if notifications are enabled
    if (enabled && !signalPhone.trim()) {
      setPhoneError('Phone number is required when notifications are enabled');
      return;
    }

    // Clear any previous errors
    setPhoneError('');

    // Clean phone number: trim and remove all spaces
    const cleanedPhone = signalPhone.trim().replace(/\s/g, '');

    updateMutation.mutate({
      enabled,
      signal_phone: cleanedPhone || null,
      notify_species: notifySpecies.length > 0 ? notifySpecies : null,
      notify_low_battery: notifyLowBattery,
      battery_threshold: batteryThreshold,
      notify_system_health: notifySystemHealth,
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
          {/* Signal Notifications */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <CardTitle>Signal notifications</CardTitle>
              </div>
              <CardDescription>
                Receive notifications via Signal messenger
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Checkbox
                id="enabled"
                checked={enabled}
                onChange={setEnabled}
                label="Enable Signal notifications"
              />

              {enabled && (
                <div className="bg-muted rounded-lg p-4 space-y-6">
                  {/* Phone Number */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Your phone number <span className="text-destructive">*</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={signalPhone}
                        onChange={(e) => {
                          setSignalPhone(e.target.value);
                          setPhoneError('');
                          setTestStatus('idle');
                          setTestMessage('');
                        }}
                        placeholder="+31612345678"
                        className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors ${
                          phoneError ? 'border-destructive' : 'border-border'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleTestMessage}
                        disabled={!signalPhone.trim() || testMessageMutation.isPending}
                        className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                      >
                        {testMessageMutation.isPending ? (
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
                    {phoneError && (
                      <p className="text-sm text-destructive mt-1">{phoneError}</p>
                    )}
                    {testStatus === 'success' && (
                      <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
                        <Check className="h-4 w-4" />
                        {testMessage}
                      </div>
                    )}
                    {testStatus === 'error' && (
                      <div className="flex items-center gap-2 text-sm text-destructive mt-1">
                        <X className="h-4 w-4" />
                        {testMessage}
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">
                      Include country code, e.g., +1 for USA, +31 for Netherlands, +32 for Belgium. This phone number must have Signal installed and registered.
                    </p>
                  </div>

                  {/* Species Alerts */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Species alerts
                    </label>
                    <input
                      type="text"
                      value={notifySpecies.join(', ')}
                      onChange={(e) => setNotifySpecies(
                        e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      )}
                      placeholder="e.g., Lion, Elephant, Leopard"
                      className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Leave empty to receive notifications for all species
                    </p>
                  </div>

                  {/* Battery Warnings */}
                  <div>
                    <Checkbox
                      id="notifyLowBattery"
                      checked={notifyLowBattery}
                      onChange={setNotifyLowBattery}
                      label="Battery warnings"
                      className="mb-3"
                    />

                    {notifyLowBattery && (
                      <div className="pl-8">
                        <label className="block text-sm font-medium mb-2">
                          Battery threshold (%)
                        </label>
                        <div className="flex items-center gap-4">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={batteryThreshold}
                            onChange={(e) => setBatteryThreshold(Number(e.target.value))}
                            className="flex-1 accent-primary"
                          />
                          <span className="font-medium w-12 text-right">{batteryThreshold}%</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Notify when battery drops below this level
                        </p>
                      </div>
                    )}
                  </div>

                  {/* System Health */}
                  <Checkbox
                    id="notifySystemHealth"
                    checked={notifySystemHealth}
                    onChange={setNotifySystemHealth}
                    label="System health alerts"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email Notifications - Coming Soon */}
          <Card className="opacity-60">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <CardTitle>Email notifications</CardTitle>
              </div>
              <CardDescription>
                Coming soon
              </CardDescription>
            </CardHeader>
          </Card>

          {/* EarthRanger Notifications - Coming Soon */}
          <Card className="opacity-60">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <CardTitle>EarthRanger notifications</CardTitle>
              </div>
              <CardDescription>
                Coming soon
              </CardDescription>
            </CardHeader>
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
                  Save preferences
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
