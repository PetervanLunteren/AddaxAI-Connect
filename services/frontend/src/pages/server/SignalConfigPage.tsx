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
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showTestModal, setShowTestModal] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);
  const [challengeToken, setChallengeToken] = useState('');
  const [rateLimitCaptcha, setRateLimitCaptcha] = useState('');
  const [triggerDummyMessage, setTriggerDummyMessage] = useState(false);
  const [step4Recipient, setStep4Recipient] = useState('');
  const [hasSentDummy, setHasSentDummy] = useState(false);

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
      setWizardStep(4);
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
      if (wizardStep === 4) {
        // Wizard mode step 4 - complete and close after test message sent
        // Reset all wizard state
        setShowWizard(false);
        setWizardStep(1);
        setStep4Recipient('');
        setHasSentDummy(false);
        setChallengeToken('');
        setRateLimitCaptcha('');
        alert('Signal setup completed successfully! Test message sent.');
      } else if (wizardStep === 0 || !wizardStep) {
        // Standalone mode
        alert('Test message sent successfully!');
        setShowTestModal(false);
        setTestRecipient('');
      }
    },
    onError: (error: any) => {
      const errorDetail = error.response?.data?.detail || error.message;

      // Check if this is a rate limit error with challenge token
      // Match UUID pattern after "challenge token"
      const challengeMatch = errorDetail.match(/challenge token["\s\\]+([a-f0-9-]{36})["\s\\]/i);
      if (challengeMatch) {
        const token = challengeMatch[1];
        console.log('Auto-detected challenge token:', token);
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
      // Clear challenge state
      setChallengeToken('');
      setRateLimitCaptcha('');

      if (wizardStep === 4) {
        // Wizard mode - auto-send test message after CAPTCHA solved
        const message = 'This is a test message from AddaxAI Connect!';
        sendTestMutation.mutate({ recipient: step4Recipient, message });
      } else {
        // Standalone mode
        alert('Rate limit challenge completed! You can now send messages.');
        setShowRateLimitModal(false);
      }
    },
    onError: (error: any) => {
      alert(`Failed to submit challenge: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Handle sending dummy message to trigger rate limit
  const handleSendDummy = () => {
    if (!step4Recipient) {
      alert('Please enter a recipient phone number');
      return;
    }
    setHasSentDummy(true);
    sendTestMutation.mutate({
      recipient: step4Recipient,
      message: 'Test message to trigger rate limit verification'
    });
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      alert('Please enter a phone number');
      return;
    }
    registerMutation.mutate({ phone_number: phoneNumber, device_name: 'AddaxAI-Connect' });
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
    // Use hardcoded test message
    const message = 'This is a test message from AddaxAI Connect!';
    sendTestMutation.mutate({ recipient: testRecipient, message });
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
            <CardTitle>Signal status</CardTitle>
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

                <div className="pt-4 flex gap-3">
                  {isRegistered && (
                    <>
                      <button
                        onClick={() => setShowTestModal(true)}
                        className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        Send test message
                      </button>
                      <button
                        onClick={() => setShowRateLimitModal(true)}
                        className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        Solve rate limit challenge
                      </button>
                    </>
                  )}
                  {isPending && (
                    <button
                      onClick={() => {
                        setShowWizard(true);
                        setWizardStep(2);
                      }}
                      className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      Continue registration
                    </button>
                  )}
                  <button
                    onClick={handleUnregister}
                    disabled={unregisterMutation.isPending}
                    className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
                  >
                    {unregisterMutation.isPending ? (
                      <>
                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                        Removing...
                      </>
                    ) : isPending ? (
                      'Start over with new number'
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
                  className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  Register Signal number
                </button>
              </div>
            )}
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
                <h2 className="text-xl font-semibold">Signal Setup Wizard</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Step {wizardStep} of 5
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
              <div className="flex items-center">
                {[
                  { num: 1, label: 'Phone' },
                  { num: 2, label: 'CAPTCHA' },
                  { num: 3, label: 'SMS' },
                  { num: 4, label: 'Test' }
                ].map((step, index) => (
                  <React.Fragment key={step.num}>
                    <div className="flex flex-col items-center">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${
                        step.num < wizardStep ? 'bg-primary text-primary-foreground' :
                        step.num === wizardStep ? 'bg-primary text-primary-foreground' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {step.num < wizardStep ? '✓' : step.num}
                      </div>
                      <span className="text-xs text-muted-foreground mt-2 whitespace-nowrap">{step.label}</span>
                    </div>
                    {index < 3 && (
                      <div className={`flex-1 h-1 mx-2 ${
                        step.num < wizardStep ? 'bg-primary' : 'bg-muted'
                      }`} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Modal Content */}
            <div className="px-6 py-6">
              {/* Step 1: Phone Number */}
              {wizardStep === 1 && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Enter phone number</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Enter the phone number you want to use for Signal notifications
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Phone number (E.164 format)
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

                  <div className="bg-muted border border-border p-3 rounded-md">
                    <div className="flex gap-2">
                      <AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        <strong>Important:</strong> This number must NOT already be registered with Signal on another device
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowWizard(false)}
                      className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={registerMutation.isPending}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      {registerMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          Next: get CAPTCHA
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
                    <h3 className="text-lg font-semibold mb-4">Solve CAPTCHA challenge</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Complete the CAPTCHA to verify you're human
                    </p>
                  </div>

                  <div className="bg-accent/50 border border-border p-4 rounded-md space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="font-bold text-foreground mt-0.5">1.</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm mb-2">Open the CAPTCHA page:</p>
                        <a
                          href="https://signalcaptchas.org/registration/generate.html"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                        >
                          signalcaptchas.org/registration/generate.html
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="font-bold text-foreground">2.</div>
                      <div className="text-sm">
                        <p>Solve the CAPTCHA puzzle</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="font-bold text-foreground">3.</div>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      CAPTCHA tokens expire quickly - submit immediately after copying!
                    </p>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitCaptchaMutation.isPending}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      {submitCaptchaMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          Next: enter SMS code
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
                    <h3 className="text-lg font-semibold mb-4">Enter SMS verification code</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      You should have received a text message with a 6-digit code
                    </p>
                  </div>

                  <div className="bg-accent/50 border border-border p-4 rounded-md">
                    <p className="text-sm">
                      Check your phone for an SMS from Signal with a 6-digit verification code
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      6-digit verification code
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
                      className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={verifyCodeMutation.isPending}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                    >
                      {verifyCodeMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          Next: rate limit challenge
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Step 4: Test Message */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Send test message</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Enter a recipient to send a test message
                    </p>
                  </div>

                  <div className="bg-muted border border-border p-4 rounded-md">
                    <p className="text-sm text-muted-foreground">
                      <strong>Note:</strong> The recipient must have Signal installed on their phone.
                    </p>
                  </div>

                  {!hasSentDummy && !challengeToken && (
                    <form onSubmit={(e) => { e.preventDefault(); handleSendDummy(); }} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          Recipient phone number
                        </label>
                        <input
                          type="text"
                          value={step4Recipient}
                          onChange={(e) => setStep4Recipient(e.target.value)}
                          placeholder="+31657459823"
                          className="w-full px-3 py-2 border rounded-md"
                          required
                          autoFocus
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Enter phone number in E.164 format (e.g., +31657459823)
                        </p>
                      </div>

                      <div className="flex justify-end gap-3 pt-4">
                        <button
                          type="button"
                          onClick={() => setWizardStep(3)}
                          className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          disabled={sendTestMutation.isPending}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                        >
                          {sendTestMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            'Continue'
                          )}
                        </button>
                      </div>
                    </form>
                  )}

                  {sendTestMutation.isPending && !challengeToken && (
                    <div className="bg-accent/50 border border-border p-4 rounded-md flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div>
                        <p className="font-medium text-sm">Sending test message...</p>
                        <p className="text-xs text-muted-foreground">This will trigger the rate limit challenge</p>
                      </div>
                    </div>
                  )}

                  {challengeToken && (
                    <form onSubmit={handleSubmitRateLimit} className="space-y-4">
                      <div className="bg-accent/50 border border-border p-4 rounded-md">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                          <div className="flex-1">
                            <p className="font-medium text-sm mb-1">Challenge Token (Auto-detected):</p>
                            <code className="block px-3 py-2 bg-muted rounded text-xs font-mono break-all">
                              {challengeToken}
                            </code>
                          </div>
                        </div>
                      </div>

                      <div className="bg-accent/50 border border-border p-4 rounded-md space-y-3">
                        <div className="flex items-start gap-2">
                          <div className="font-bold text-foreground mt-0.5">1.</div>
                          <div className="flex-1">
                            <p className="font-medium text-sm mb-2">Solve the CAPTCHA:</p>
                            <a
                              href="https://signalcaptchas.org/challenge/generate.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                            >
                              signalcaptchas.org/challenge/generate.html
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <div className="font-bold text-foreground">2.</div>
                          <div className="text-sm">
                            <p className="font-medium mb-1">Copy the CAPTCHA token:</p>
                            <p className="text-muted-foreground">
                              Right-click "Open Signal" → "Copy link address"
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <div className="font-bold text-foreground">3.</div>
                          <p className="text-sm">Paste the token below</p>
                        </div>
                      </div>

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
                          type="submit"
                          disabled={submitRateLimitMutation.isPending}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                        >
                          {submitRateLimitMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Verifying...
                            </>
                          ) : (
                            <>
                              Complete setup
                              <CheckCircle2 className="h-4 w-4" />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}

                  {submitRateLimitMutation.isSuccess && sendTestMutation.isPending && (
                    <div className="bg-accent/50 border border-border p-4 rounded-md flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div>
                        <p className="font-medium text-sm">Sending test message to {step4Recipient}...</p>
                        <p className="text-xs text-muted-foreground">Almost done!</p>
                      </div>
                    </div>
                  )}
                </div>
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
                <h2 className="text-xl font-bold">Send test message</h2>
                <button
                  onClick={() => setShowTestModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSendTest} className="space-y-4">
                <div className="bg-muted border border-border p-4 rounded-md mb-4">
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> The recipient must have Signal installed on their phone.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Recipient phone number
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

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowTestModal(false)}
                    className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sendTestMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {sendTestMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Send test message'
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
                <h2 className="text-xl font-bold">Rate limit challenge required</h2>
                <button
                  onClick={() => setShowRateLimitModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-4">
                <div className="bg-muted border border-border p-4 rounded-md mb-4">
                  <div className="flex gap-2">
                    <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold mb-1">
                        Signal has rate-limited your number
                      </p>
                      <p className="text-muted-foreground">
                        New Signal numbers need to complete a CAPTCHA challenge before sending messages.
                        This is a one-time verification to prevent spam.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-accent/50 border border-border p-4 rounded-md space-y-3 mb-4">
                  {challengeToken ? (
                    <>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium text-sm mb-1">Challenge Token (Auto-detected):</p>
                          <code className="block px-3 py-2 bg-muted rounded text-xs font-mono break-all">
                            {challengeToken}
                          </code>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground mt-0.5">1.</div>
                        <div className="flex-1">
                          <p className="font-medium text-sm mb-2">Solve the CAPTCHA:</p>
                          <a
                            href="https://signalcaptchas.org/challenge/generate.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                          >
                            signalcaptchas.org/challenge/generate.html
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground">2.</div>
                        <div className="text-sm">
                          <p className="font-medium mb-1">Copy the CAPTCHA token:</p>
                          <p className="text-muted-foreground">
                            Right-click the "Open Signal" button → "Copy link address"
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground">3.</div>
                        <div className="text-sm">
                          <p className="font-medium mb-1">Paste CAPTCHA token below and submit</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground mt-0.5">1.</div>
                        <div className="flex-1">
                          <p className="font-medium text-sm mb-2">Enter the Challenge Token:</p>
                          <p className="text-sm text-muted-foreground">
                            Copy it from the error message (looks like: "78467a1e-d225-4105-8026-de219bd250d9")
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground mt-0.5">2.</div>
                        <div className="flex-1">
                          <p className="font-medium text-sm mb-2">Solve the CAPTCHA:</p>
                          <a
                            href="https://signalcaptchas.org/challenge/generate.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                          >
                            signalcaptchas.org/challenge/generate.html
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground">3.</div>
                        <div className="text-sm">
                          <p className="font-medium mb-1">Copy the CAPTCHA token:</p>
                          <p className="text-muted-foreground">
                            Right-click the "Open Signal" button → "Copy link address"
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <div className="font-bold text-foreground">4.</div>
                        <div className="text-sm">
                          <p className="font-medium mb-1">Paste both tokens below and submit</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmitRateLimit} className="space-y-4">
                {!challengeToken && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Challenge Token
                    </label>
                    <input
                      type="text"
                      value={challengeToken}
                      onChange={(e) => setChallengeToken(e.target.value)}
                      placeholder="78467a1e-d225-4105-8026-de219bd250d9"
                      className="w-full px-3 py-2 border rounded-md font-mono text-sm"
                      required
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Found in the error message "challenge token..."
                    </p>
                  </div>
                )}

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
                  <p className="text-xs text-muted-foreground mt-1">
                    From signalcaptchas.org after solving puzzle
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRateLimitModal(false)}
                    className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitRateLimitMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
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
