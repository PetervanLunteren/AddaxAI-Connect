/**
 * Signal Configuration Page
 *
 * Allows superusers to configure Signal messaging for notifications
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, CheckCircle2, XCircle, AlertCircle, ExternalLink, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';

export const SignalConfigPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [deviceName, setDeviceName] = useState('AddaxAI-Connect');
  const [captchaToken, setCaptchaToken] = useState('');
  const [verificationCode, setVerificationCode] = useState('');

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
    },
    onError: (error: any) => {
      alert(`Failed to register Signal: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Submit CAPTCHA mutation
  const submitCaptchaMutation = useMutation({
    mutationFn: adminApi.submitSignalCaptcha,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-config'] });
      setCaptchaToken('');
      alert('CAPTCHA submitted successfully! You should receive an SMS with a verification code.');
    },
    onError: (error: any) => {
      alert(`Failed to submit CAPTCHA: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Verify code mutation
  const verifyCodeMutation = useMutation({
    mutationFn: adminApi.verifySignalCode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-config'] });
      setVerificationCode('');
      alert('Signal registration completed successfully!');
    },
    onError: (error: any) => {
      alert(`Failed to verify code: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Unregister Signal mutation
  const unregisterMutation = useMutation({
    mutationFn: adminApi.unregisterSignal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signal-config'] });
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

  const handleSubmitCaptcha = (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) {
      alert('Please enter the CAPTCHA token');
      return;
    }
    submitCaptchaMutation.mutate(captchaToken);
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode) {
      alert('Please enter the verification code');
      return;
    }
    verifyCodeMutation.mutate(verificationCode);
  };

  const handleUnregister = () => {
    if (confirm('Are you sure you want to unregister Signal? This will disable all Signal notifications.')) {
      unregisterMutation.mutate();
    }
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
                        <p className="font-medium">Signal registration in progress</p>
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

                {isRegistered && (
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
                )}
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
        {!isRegistered && (
          <>
            {/* Step 1: Enter Phone Number */}
            {!isConfigured && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                      1
                    </div>
                    <CardTitle>Enter Phone Number</CardTitle>
                  </div>
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
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                    >
                      {registerMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Registering...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Step 2: Submit CAPTCHA */}
            {isPending && (
              <>
                <Card className="border-blue-500">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-sm font-bold">
                        2
                      </div>
                      <CardTitle>Solve CAPTCHA</CardTitle>
                    </div>
                    <CardDescription>
                      Complete the CAPTCHA challenge and paste the token below
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-md space-y-3">
                      <div className="flex items-start gap-2">
                        <div className="font-bold text-blue-700 dark:text-blue-300">1.</div>
                        <div className="flex-1">
                          <p className="font-medium text-sm mb-1">Open the CAPTCHA page:</p>
                          <a
                            href="https://signalcaptchas.org/registration/generate.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            signalcaptchas.org/registration/generate.html
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-blue-700 dark:text-blue-300">2.</div>
                        <p className="text-sm">Solve the CAPTCHA puzzle</p>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-blue-700 dark:text-blue-300">3.</div>
                        <div className="text-sm">
                          <p className="font-medium mb-1">Copy the token:</p>
                          <p className="text-muted-foreground">
                            Right-click the "Open Signal" button and select "Copy link address"
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            The link will look like: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">signalcaptcha://signal-hcaptcha.XXXXXXXX...</code>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-blue-700 dark:text-blue-300">4.</div>
                        <p className="text-sm">Paste the token below and click Submit</p>
                      </div>
                    </div>

                    <form onSubmit={handleSubmitCaptcha} className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          CAPTCHA Token
                        </label>
                        <input
                          type="text"
                          value={captchaToken}
                          onChange={(e) => setCaptchaToken(e.target.value)}
                          placeholder="signalcaptcha://signal-hcaptcha..."
                          className="w-full px-3 py-2 border rounded-md font-mono text-sm"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitCaptchaMutation.isPending}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                      >
                        {submitCaptchaMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          <>
                            Submit CAPTCHA
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </form>

                    <p className="text-xs text-yellow-600 dark:text-yellow-500">
                      ⏱️ CAPTCHA tokens expire quickly - submit immediately after copying!
                    </p>
                  </CardContent>
                </Card>

                {/* Step 3: Verify SMS Code */}
                <Card className="border-green-500">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-sm font-bold">
                        3
                      </div>
                      <CardTitle>Enter SMS Verification Code</CardTitle>
                    </div>
                    <CardDescription>
                      After submitting the CAPTCHA, you'll receive an SMS with a 6-digit code
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleVerifyCode} className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          6-Digit Code
                        </label>
                        <input
                          type="text"
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value)}
                          placeholder="123456"
                          maxLength={6}
                          className="w-full px-3 py-2 border rounded-md text-2xl tracking-widest text-center font-mono"
                          pattern="[0-9]{6}"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={verifyCodeMutation.isPending}
                        className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
                      >
                        {verifyCodeMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          <>
                            Complete Registration
                            <CheckCircle2 className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </form>
                  </CardContent>
                </Card>
              </>
            )}
          </>
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

            {!isRegistered && (
              <div className="pt-2 border-t">
                <p className="font-medium mb-1">Troubleshooting:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                  <li>Make sure the phone number is NOT registered on another device</li>
                  <li>CAPTCHA tokens expire within seconds - copy and submit immediately</li>
                  <li>If you get "Authorization failed", the CAPTCHA may have expired - get a new one</li>
                  <li>If verification fails, try the process again with a new CAPTCHA</li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ServerPageLayout>
  );
};
