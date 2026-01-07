/**
 * Signal Configuration Page
 *
 * Allows superusers to configure Signal messaging for notifications
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';

export const SignalConfigPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [deviceName, setDeviceName] = useState('AddaxAI-Connect');

  // Query Signal configuration
  const { data: config, isLoading, error } = useQuery({
    queryKey: ['signal-config'],
    queryFn: adminApi.getSignalConfig,
    retry: false,
  });

  // Register Signal mutation
  const registerMutation = useMutation({
    mutationFn: adminApi.registerSignal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-config'] });
      setPhoneNumber('');
    },
    onError: (error: any) => {
      alert(`Failed to register Signal: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Unregister Signal mutation
  const unregisterMutation = useMutation({
    mutationFn: adminApi.unregisterSignal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-config'] });
    },
    onError: (error: any) => {
      alert(`Failed to unregister Signal: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      alert('Please enter a phone number');
      return;
    }
    registerMutation.mutate({ phone_number: phoneNumber, device_name: deviceName });
  };

  const handleUnregister = () => {
    if (confirm('Are you sure you want to unregister Signal? This will disable all Signal notifications.')) {
      unregisterMutation.mutate();
    }
  };

  const isConfigured = !error;
  const isRegistered = config?.is_registered;

  return (
    <ServerPageLayout
      title="Signal Notifications"
      description="Configure Signal messenger for sending notifications to users"
    >
      <div className="space-y-6">
        {/* Status Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <CardTitle>Signal Status</CardTitle>
            </div>
            <CardDescription>
              Current Signal configuration and registration status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isConfigured && config ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {isRegistered ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <div>
                        <p className="font-medium">Signal is registered and ready</p>
                        <p className="text-sm text-muted-foreground">
                          Phone: {config.phone_number}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-5 w-5 text-yellow-500" />
                      <div>
                        <p className="font-medium">Signal registration pending</p>
                        <p className="text-sm text-muted-foreground">
                          Complete verification via signal-cli-rest-api
                        </p>
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <p className="text-sm text-muted-foreground">Device Name</p>
                    <p className="font-medium">{config.device_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Health Status</p>
                    <p className="font-medium">{config.health_status || 'Unknown'}</p>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleUnregister}
                    disabled={unregisterMutation.isPending}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {unregisterMutation.isPending ? (
                      <>
                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                        Unregistering...
                      </>
                    ) : (
                      'Unregister Signal'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-muted-foreground">
                <XCircle className="h-5 w-5" />
                <p>Signal is not configured</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Registration Card */}
        {!isConfigured && (
          <Card>
            <CardHeader>
              <CardTitle>Register Signal</CardTitle>
              <CardDescription>
                Set up a Signal phone number for sending notifications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Phone Number (E.164 format)
                  </label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+12345678900"
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Include country code, e.g., +1 for USA
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Device Name
                  </label>
                  <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>

                <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-md">
                  <p className="text-sm font-medium mb-2">Next Steps:</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Click "Register Signal" below</li>
                    <li>You'll receive an SMS verification code</li>
                    <li>Access signal-cli-rest-api at port 8090</li>
                    <li>Complete verification with the SMS code</li>
                  </ol>
                </div>

                <button
                  type="submit"
                  disabled={registerMutation.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {registerMutation.isPending ? (
                    <>
                      <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                      Registering...
                    </>
                  ) : (
                    'Register Signal'
                  )}
                </button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Information Card */}
        <Card>
          <CardHeader>
            <CardTitle>About Signal Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Signal notifications allow users to receive real-time alerts about:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Species detections (user-configurable)</li>
              <li>Low battery warnings from cameras</li>
              <li>System health issues</li>
            </ul>
            <p className="pt-2">
              Users can configure their individual notification preferences in their profile settings.
            </p>
          </CardContent>
        </Card>
      </div>
    </ServerPageLayout>
  );
};
