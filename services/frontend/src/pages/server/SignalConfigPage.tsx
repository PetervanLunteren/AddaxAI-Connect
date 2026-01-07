/**
 * Signal Configuration Page
 *
 * Allows superusers to configure Signal messaging for notifications
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, CheckCircle2, XCircle, AlertCircle, ExternalLink, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';

export const SignalConfigPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [deviceName, setDeviceName] = useState('AddaxAI-Connect');
  const [currentStep, setCurrentStep] = useState<'enter-phone' | 'get-captcha' | 'verification'>('enter-phone');
  const [copiedCaptcha, setCopiedCaptcha] = useState(false);

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
      setCurrentStep('get-captcha');
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
      setCurrentStep('enter-phone');
      setPhoneNumber('');
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

  const handleCopyCaptchaInstructions = () => {
    const instructions = `Follow these steps to complete Signal registration:

1. Open this link in a new tab: https://signalcaptchas.org/registration/generate.html

2. Solve the CAPTCHA puzzle

3. Right-click the "Open Signal" button and select "Copy link address"

4. The link will look like:
   signalcaptcha://signal-hcaptcha.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX...

5. SSH into your server and run:
   ssh addaxai-connect-dev

6. Then run this command (replace YOUR-TOKEN with the copied link):
   curl -X POST -H 'Content-Type: application/json' \\
     -d '{"use_voice": false, "captcha": "YOUR-TOKEN-HERE"}' \\
     'http://localhost:8090/v1/register/${phoneNumber}'

7. You should receive an SMS with a 6-digit verification code

8. Run this command with your verification code:
   curl -X POST -H 'Content-Type: application/json' \\
     -d '{"token": "123456"}' \\
     'http://localhost:8090/v1/register/${phoneNumber}/verify'

9. Refresh this page to see the updated status`;

    navigator.clipboard.writeText(instructions);
    setCopiedCaptcha(true);
    setTimeout(() => setCopiedCaptcha(false), 2000);
  };

  const isConfigured = !error;
  const isRegistered = config?.is_registered;
  const isPending = isConfigured && !isRegistered;

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
                          Phone: {config.phone_number} - Waiting for verification
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

        {/* Registration Wizard */}
        {!isConfigured && (
          <>
            {/* Step 1: Enter Phone Number */}
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Enter Phone Number</CardTitle>
                <CardDescription>
                  Enter the phone number you want to use for Signal notifications
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
                      placeholder="+31612345678"
                      className="w-full px-3 py-2 border rounded-md"
                      required
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Include country code (e.g., +31 for Netherlands, +1 for USA)
                    </p>
                    <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-1">
                      ⚠️ Important: This number must NOT already be registered with Signal on another device
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
                      'Continue to Verification'
                    )}
                  </button>
                </form>
              </CardContent>
            </Card>
          </>
        )}

        {/* Step 2: Complete Verification (shown when pending) */}
        {isPending && (
          <Card className="border-yellow-500">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                Step 2: Complete Signal Verification
              </CardTitle>
              <CardDescription>
                Follow these steps to verify your Signal phone number
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-950/20 p-4 rounded-md space-y-4">
                <div className="space-y-2">
                  <p className="font-medium text-sm">📱 Complete the following steps:</p>

                  <ol className="text-sm space-y-3 list-decimal list-inside ml-2">
                    <li className="space-y-2">
                      <span className="font-medium">Get CAPTCHA token:</span>
                      <div className="ml-6 mt-1">
                        <a
                          href="https://signalcaptchas.org/registration/generate.html"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Open CAPTCHA page
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <p className="text-muted-foreground mt-1">
                          Solve the puzzle, then right-click "Open Signal" and copy the link
                        </p>
                      </div>
                    </li>

                    <li className="space-y-2">
                      <span className="font-medium">SSH into your server and run the verification commands</span>
                      <div className="ml-6 mt-1">
                        <button
                          onClick={handleCopyCaptchaInstructions}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          {copiedCaptcha ? (
                            <>
                              <Check className="h-4 w-4 text-green-500" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              Copy Instructions
                            </>
                          )}
                        </button>
                        <p className="text-muted-foreground mt-1 text-xs">
                          This will copy detailed SSH commands to your clipboard
                        </p>
                      </div>
                    </li>

                    <li className="font-medium">
                      Once verified, refresh this page to see the updated status
                    </li>
                  </ol>
                </div>

                <div className="pt-2 border-t">
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['signal-config'] })}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    🔄 Refresh Status
                  </button>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1 pt-2">
                <p><strong>Troubleshooting:</strong></p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>Make sure the phone number is NOT registered on another device</li>
                  <li>CAPTCHA tokens expire quickly - copy and use them immediately</li>
                  <li>If you get "Authorization failed", the CAPTCHA may have expired - get a new one</li>
                  <li>Contact support if you continue having issues</li>
                </ul>
              </div>
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
