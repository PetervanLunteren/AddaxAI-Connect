/**
 * User Notification Preferences Page
 *
 * Allows users to configure their personal notification settings
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { ServerPageLayout } from '../components/layout/ServerPageLayout';
import { notificationsApi } from '../api/notifications';

export const UserNotificationPreferencesPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [signalPhone, setSignalPhone] = useState('');
  const [notifySpecies, setNotifySpecies] = useState<string[]>([]);
  const [notifyLowBattery, setNotifyLowBattery] = useState(true);
  const [batteryThreshold, setBatteryThreshold] = useState(30);
  const [notifySystemHealth, setNotifySystemHealth] = useState(false);

  // Query preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationsApi.getPreferences,
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
    mutationFn: notificationsApi.updatePreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      alert('Notification preferences updated successfully!');
    },
    onError: (error: any) => {
      alert(`Failed to update preferences: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    updateMutation.mutate({
      enabled,
      signal_phone: signalPhone || null,
      notify_species: notifySpecies.length > 0 ? notifySpecies : null,
      notify_low_battery: notifyLowBattery,
      battery_threshold: batteryThreshold,
      notify_system_health: notifySystemHealth,
    });
  };

  return (
    <ServerPageLayout
      title="My Notification Preferences"
      description="Configure your personal notification settings"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Enable/Disable Notifications */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                <CardTitle>Notification Settings</CardTitle>
              </div>
              <CardDescription>
                Control when and how you receive notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="enabled" className="font-medium">
                  Enable notifications
                </label>
              </div>

              {enabled && (
                <div className="space-y-4 pl-7 border-l-2 border-border">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Signal Phone Number (E.164 format)
                    </label>
                    <input
                      type="text"
                      value={signalPhone}
                      onChange={(e) => setSignalPhone(e.target.value)}
                      placeholder="+12345678900"
                      className="w-full px-3 py-2 border rounded-md"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Include country code, e.g., +1 for USA
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Species Notifications */}
          {enabled && (
            <Card>
              <CardHeader>
                <CardTitle>Species Alerts</CardTitle>
                <CardDescription>
                  Choose which species detections trigger notifications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Notify me about these species (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={notifySpecies.join(', ')}
                      onChange={(e) => setNotifySpecies(
                        e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      )}
                      placeholder="e.g., Lion, Elephant, Leopard"
                      className="w-full px-3 py-2 border rounded-md"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Leave empty to receive notifications for all species
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Battery Warnings */}
          {enabled && (
            <Card>
              <CardHeader>
                <CardTitle>Battery Warnings</CardTitle>
                <CardDescription>
                  Get notified when camera batteries are running low
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyLowBattery"
                    checked={notifyLowBattery}
                    onChange={(e) => setNotifyLowBattery(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="notifyLowBattery" className="font-medium">
                    Notify me when camera battery is low
                  </label>
                </div>

                {notifyLowBattery && (
                  <div className="pl-7">
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
                        className="flex-1"
                      />
                      <span className="font-medium w-12 text-right">{batteryThreshold}%</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Notify when battery drops below this level
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* System Health */}
          {enabled && (
            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
                <CardDescription>
                  Receive notifications about system issues
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifySystemHealth"
                    checked={notifySystemHealth}
                    onChange={(e) => setNotifySystemHealth(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="notifySystemHealth" className="font-medium">
                    Notify me about system health issues
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
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
    </ServerPageLayout>
  );
};
