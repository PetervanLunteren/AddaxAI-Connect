/**
 * Signal Configuration Page
 *
 * Allows superusers to configure Signal messaging for notifications
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, CheckCircle2, XCircle, AlertCircle, ExternalLink, ArrowRight, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';

export const SignalConfigPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [deviceName, setDeviceName] = useState('AddaxAI-Connect');
  const [captchaToken, setCaptchaToken] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showTestModal, setShowTestModal] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [testMessage, setTestMessage] = useState('This is a test message from AddaxAI Connect!');
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);
  const [challengeToken, setChallengeToken] = useState('');
  const [rateLimitCaptcha, setRateLimitCaptcha] = useState('');

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
      setWizardStep(2);
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
      setWizardStep(3);
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
      setShowWizard(false);
      setWizardStep(1);
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
      setShowWizard(false);
      setWizardStep(1);
    },
    onError: (error: any) => {
      alert(`Failed to unregister Signal: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Send test message mutation
  const sendTestMutation = useMutation({
    mutationFn: ({ recipient, message }: { recipient: string; message: string }) =>
      adminApi.sendTestSignalMessage(recipient, message),
    onSuccess: () => {
      alert('Test message sent successfully!');
      setShowTestModal(false);
      setTestRecipient('');
      setTestMessage('This is a test message from AddaxAI Connect!');
    },
    onError: (error: any) => {
      const errorDetail = error.response?.data?.detail || error.message;

      // Check if this is a rate limit error with challenge token
      const challengeMatch = errorDetail.match(/challenge token "([^"]+)"/);
      if (challengeMatch) {
        const token = challengeMatch[1];
        setChallengeToken(token);
        setShowTestModal(false);
        setShowRateLimitModal(true);
      } else {
        alert(`Failed to send test message: ${errorDetail}`);
      }
    },
  });

  // Submit rate limit challenge mutation
  const submitRateLimitMutation = useMutation({
    mutationFn: ({ challengeToken, captcha }: { challengeToken: string; captcha: string }) =>
      adminApi.submitRateLimitChallenge(challengeToken, captcha),
    onSuccess: () => {
      alert('Rate limit challenge completed! You can now send messages.');
      setShowRateLimitModal(false);
      setChallengeToken('');
      setRateLimitCaptcha('');
    },
    onError: (error: any) => {
      alert(`Failed to submit challenge: ${error.response?.data?.detail || error.message}`);
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

  const handleSendTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient) {
      alert('Please enter a recipient phone number');
      return;
    }
    if (!testMessage) {
      alert('Please enter a message');
      return;
    }
    sendTestMutation.mutate({ recipient: testRecipient, message: testMessage });
  };

  const handleSubmitRateLimit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rateLimitCaptcha) {
      alert('Please enter the CAPTCHA token');
      return;
    }
    submitRateLimitMutation.mutate({ challengeToken, captcha: rateLimitCaptcha });
  };

  const handleStartRegistration = () => {
    setShowWizard(true);
    setWizardStep(1);
    setPhoneNumber('');
    setDeviceName('AddaxAI-Connect');
    setCaptchaToken('');
    setVerificationCode('');
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

                <div className="pt-4 flex gap-3">
                  {isRegistered && (
                    <button
                      onClick={() => setShowTestModal(true)}
                      className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                    >
                      Send Test Message
                    </button>
                  )}
                  {isPending && (
                    <button
                      onClick={() => {
                        setShowWizard(true);
                        setWizardStep(2);
                      }}
                      className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                      Continue Registration
                    </button>
                  )}
                  <button
                    onClick={handleUnregister}
                    disabled={unregisterMutation.isPending}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {unregisterMutation.isPending ? (
                      <>
                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                        Removing...
                      </>
                    ) : isPending ? (
                      'Start Over with New Number'
                    ) : (
                      'Unregister Signal'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <XCircle className="h-5 w-5" />
                  <p>Signal is not configured</p>
                </div>
                <button
                  onClick={handleStartRegistration}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Register Signal Number
                </button>
              </div>
            )}
          </CardContent>
        </Card>

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

      {/* Registration Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Register Signal Number</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Step {wizardStep} of 3
                </p>
              </div>
              <button
                onClick={() => setShowWizard(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Progress Indicator */}
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center flex-1">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${
                      step < wizardStep ? 'bg-green-500 text-white' :
                      step === wizardStep ? 'bg-blue-500 text-white' :
                      'bg-gray-200 dark:bg-gray-700 text-gray-500'
                    }`}>
                      {step < wizardStep ? '✓' : step}
                    </div>
                    {step < 3 && (
                      <div className={`flex-1 h-1 mx-2 ${
                        step < wizardStep ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs text-muted-foreground">Phone Number</span>
                <span className="text-xs text-muted-foreground">CAPTCHA</span>
                <span className="text-xs text-muted-foreground">SMS Code</span>
              </div>
            </div>

            {/* Modal Content */}
            <div className="px-6 py-6">
              {/* Step 1: Phone Number */}
              {wizardStep === 1 && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Enter Phone Number</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Enter the phone number you want to use for Signal notifications
                    </p>
                  </div>

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
                      autoFocus
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Include country code (e.g., +31 for Netherlands, +1 for USA)
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

                  <div className="bg-yellow-50 dark:bg-yellow-950/20 p-3 rounded-md">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      ⚠️ <strong>Important:</strong> This number must NOT already be registered with Signal on another device
                    </p>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowWizard(false)}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={registerMutation.isPending}
                      className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                    >
                      {registerMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          Next: Get CAPTCHA
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Step 2: CAPTCHA */}
              {wizardStep === 2 && (
                <form onSubmit={handleSubmitCaptcha} className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Solve CAPTCHA Challenge</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Complete the CAPTCHA to verify you're human
                    </p>
                  </div>

                  {/* Important Warning */}
                  <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-4 rounded-md">
                    <div className="flex gap-2">
                      <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">Important:</p>
                        <p className="text-yellow-700 dark:text-yellow-300">
                          You must solve the CAPTCHA from a device on the <strong>same IP address</strong> as this server.
                          CAPTCHA tokens expire within minutes - submit immediately after solving!
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-md space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="font-bold text-blue-700 dark:text-blue-300 mt-0.5">1.</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm mb-2">Open one of these CAPTCHA pages:</p>
                        <div className="space-y-2">
                          <div>
                            <a
                              href="https://signalcaptchas.org/registration/generate.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-sm"
                            >
                              signalcaptchas.org/registration/generate.html
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <p className="text-xs text-muted-foreground ml-4">(Try this first)</p>
                          </div>
                          <div>
                            <a
                              href="https://signalcaptchas.org/challenge/generate.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-sm"
                            >
                              signalcaptchas.org/challenge/generate.html
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <p className="text-xs text-muted-foreground ml-4">(Alternative if registration fails)</p>
                          </div>
                        </div>
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
                          Right-click the "Open Signal" button → "Copy link address"
                        </p>
                      </div>
                    </div>
                  </div>

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
                      autoFocus
                    />
                    <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                      ⏱️ CAPTCHA tokens expire quickly - submit immediately after copying!
                    </p>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Back
                    </button>
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
                          Next: Enter SMS Code
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: SMS Verification */}
              {wizardStep === 3 && (
                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Enter SMS Verification Code</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      You should have received a text message with a 6-digit code
                    </p>
                  </div>

                  <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-md">
                    <p className="text-sm text-green-800 dark:text-green-200">
                      📱 Check your phone for an SMS from Signal with a 6-digit verification code
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      6-Digit Verification Code
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
                      autoFocus
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Back
                    </button>
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
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Test Message Modal */}
      {showTestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Send Test Message</h2>
                <button
                  onClick={() => setShowTestModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSendTest} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Recipient Phone Number
                  </label>
                  <input
                    type="text"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                    placeholder="+31657459823"
                    className="w-full px-3 py-2 border rounded-md"
                    required
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter phone number in E.164 format (e.g., +31657459823)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Message
                  </label>
                  <textarea
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder="Test message..."
                    rows={4}
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowTestModal(false)}
                    className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sendTestMutation.isPending}
                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
                  >
                    {sendTestMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Send Test Message'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Rate Limit Challenge Modal */}
      {showRateLimitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Rate Limit Challenge Required</h2>
                <button
                  onClick={() => setShowRateLimitModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-4">
                <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-4 rounded-md mb-4">
                  <div className="flex gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                        Signal has rate-limited your number
                      </p>
                      <p className="text-yellow-700 dark:text-yellow-300">
                        New Signal numbers need to complete a CAPTCHA challenge before sending messages.
                        This is a one-time verification to prevent spam.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-md space-y-3 mb-4">
                  <div className="flex items-start gap-2">
                    <div className="font-bold text-blue-700 dark:text-blue-300 mt-0.5">1.</div>
                    <div className="flex-1">
                      <p className="font-medium text-sm mb-2">Challenge Token (auto-filled):</p>
                      <code className="block px-3 py-2 bg-gray-100 dark:bg-gray-900 rounded text-xs font-mono break-all">
                        {challengeToken}
                      </code>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="font-bold text-blue-700 dark:text-blue-300 mt-0.5">2.</div>
                    <div className="flex-1">
                      <p className="font-medium text-sm mb-2">Solve the CAPTCHA:</p>
                      <a
                        href="https://signalcaptchas.org/challenge/generate.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-sm"
                      >
                        signalcaptchas.org/challenge/generate.html
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="font-bold text-blue-700 dark:text-blue-300">3.</div>
                    <div className="text-sm">
                      <p className="font-medium mb-1">Copy the CAPTCHA token:</p>
                      <p className="text-muted-foreground">
                        Right-click the "Open Signal" button → "Copy link address"
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmitRateLimit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    CAPTCHA Token
                  </label>
                  <input
                    type="text"
                    value={rateLimitCaptcha}
                    onChange={(e) => setRateLimitCaptcha(e.target.value)}
                    placeholder="signalcaptcha://signal-hcaptcha..."
                    className="w-full px-3 py-2 border rounded-md font-mono text-sm"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRateLimitModal(false)}
                    className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitRateLimitMutation.isPending}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                  >
                    {submitRateLimitMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Complete Challenge'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </ServerPageLayout>
  );
};
