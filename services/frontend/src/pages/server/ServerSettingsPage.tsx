/**
 * Server Settings Page
 *
 * Unified page for server-wide settings: timezone, Telegram, and
 * SpeciesNet-specific settings (geofencing + taxonomy mapping, shown conditionally).
 * Only accessible by server admins.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Loader2, CheckCircle2, XCircle, AlertCircle, ExternalLink, X, Copy, Check, Trash2, Download, Save, FileSpreadsheet } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { TimezoneSelect } from '../../components/ui/TimezoneSelect';
import { CountrySelect } from '../../components/ui/CountrySelect';
import { StateSelect } from '../../components/ui/StateSelect';
import { Button } from '../../components/ui/Button';
import { adminApi } from '../../api/admin';

// Generate random 5-character hash for bot username
const generateBotUsername = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let hash = '';
  for (let i = 0; i < 5; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `addaxai_connect_${hash}_bot`;
};

// Copy button component for inline code examples
const CopyButton: React.FC<{ text: string; id: string }> = ({ text, id }) => {
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

// Download button component for logo
const DownloadButton: React.FC<{ fileName: string }> = ({ fileName }) => {
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = '/logo-square-no-text.png';
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="inline-flex items-center justify-center p-1 ml-1 hover:bg-accent rounded transition-colors"
      title="Download logo"
    >
      {downloaded ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Download className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
};

export const ServerSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();

  // --- Timezone state ---
  const [timezone, setTimezone] = useState('');
  const [tzSaveStatus, setTzSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [tzError, setTzError] = useState<string | null>(null);

  // --- Telegram state ---
  const [showProfilePicModal, setShowProfilePicModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState(generateBotUsername());
  const [showTestModal, setShowTestModal] = useState(false);
  const [testChatId, setTestChatId] = useState('');

  // --- Geofencing state ---
  const [countryCode, setCountryCode] = useState('');
  const [admin1Region, setAdmin1Region] = useState('');
  const [geoSaveStatus, setGeoSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);

  // --- Taxonomy state ---
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [uploadModal, setUploadModal] = useState<{
    open: boolean;
    status: 'uploading' | 'done' | 'error';
    count?: number;
    reprocessedCount?: number;
    error?: string;
  }>({ open: false, status: 'uploading' });

  // Query server settings
  const { data: serverSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['server-settings'],
    queryFn: adminApi.getServerSettings,
    retry: false,
  });

  // Check setup status (for classification model type)
  const { data: setupStatus } = useQuery({
    queryKey: ['setup-status'],
    queryFn: adminApi.getSetupStatus,
  });

  const isSpeciesNet = setupStatus?.model === 'speciesnet';

  // Sync state when server settings load
  useEffect(() => {
    if (serverSettings?.timezone) {
      setTimezone(serverSettings.timezone);
    }
    if (serverSettings?.speciesnet_country_code) {
      setCountryCode(serverSettings.speciesnet_country_code);
    }
    if (serverSettings?.speciesnet_admin1_region) {
      setAdmin1Region(serverSettings.speciesnet_admin1_region);
    }
  }, [serverSettings]);

  const hasTimezoneChanges = timezone !== (serverSettings?.timezone ?? '') && timezone !== '';

  // --- Geofencing logic ---
  const hasGeoChanges = countryCode !== (serverSettings?.speciesnet_country_code ?? '')
    || admin1Region !== (serverSettings?.speciesnet_admin1_region ?? '');

  const updateGeoMutation = useMutation({
    mutationFn: (data: { speciesnet_country_code: string; speciesnet_admin1_region: string }) =>
      adminApi.updateServerSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-settings'] });
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
      setGeoSaveStatus('success');
      setTimeout(() => setGeoSaveStatus('idle'), 2000);
    },
    onError: (error: any) => {
      setGeoError(error.response?.data?.detail || error.message || 'Failed to save');
      setGeoSaveStatus('error');
      setTimeout(() => setGeoSaveStatus('idle'), 3000);
    },
  });

  const handleSaveGeo = () => {
    if (!countryCode) return;
    setGeoSaveStatus('saving');
    setGeoError(null);
    updateGeoMutation.mutate({
      speciesnet_country_code: countryCode,
      speciesnet_admin1_region: admin1Region,
    });
  };

  // --- Taxonomy logic ---
  const { data: taxonomyData, isLoading: taxonomyLoading } = useQuery({
    queryKey: ['taxonomy-mapping'],
    queryFn: adminApi.getTaxonomyMapping,
    enabled: isSpeciesNet,
  });

  const uploadMutation = useMutation({
    mutationFn: adminApi.uploadTaxonomyMapping,
    onSuccess: (result) => {
      setUploadModal({
        open: true,
        status: 'done',
        count: result.count,
        reprocessedCount: result.reprocessed_count,
      });
      queryClient.invalidateQueries({ queryKey: ['taxonomy-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['available-species'] });
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      queryClient.invalidateQueries({ queryKey: ['species'] });
      setTimeout(() => setUploadModal({ open: false, status: 'uploading' }), 3000);
    },
    onError: (error: any) => {
      setUploadModal({
        open: true,
        status: 'error',
        error: error.response?.data?.detail || error.message || 'Upload failed',
      });
    },
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setPendingFile(acceptedFiles[0]);
      }
    },
    []
  );

  const handleUploadPending = () => {
    if (!pendingFile) return;
    setUploadModal({ open: true, status: 'uploading' });
    uploadMutation.mutate(pendingFile, {
      onSettled: () => setPendingFile(null),
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  });

  const entries = taxonomyData?.entries || [];

  // Update timezone mutation
  const updateTimezoneMutation = useMutation({
    mutationFn: (tz: string) => adminApi.updateServerSettings({ timezone: tz }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-settings'] });
      queryClient.invalidateQueries({ queryKey: ['timezone-configured'] });
      setTzSaveStatus('success');
      setTimeout(() => setTzSaveStatus('idle'), 2000);
    },
    onError: (error: any) => {
      setTzError(error.response?.data?.detail || error.message || 'Failed to save timezone');
      setTzSaveStatus('error');
      setTimeout(() => setTzSaveStatus('idle'), 3000);
    },
  });

  const handleSaveTimezone = () => {
    if (!timezone) return;
    setTzSaveStatus('saving');
    setTzError(null);
    updateTimezoneMutation.mutate(timezone);
  };

  // Query Telegram configuration
  const { data: telegramConfig, isLoading: telegramLoading, error: telegramError } = useQuery({
    queryKey: ['telegram-config'],
    queryFn: adminApi.getTelegramConfig,
    retry: false,
  });

  // Configure Telegram mutation
  const configureMutation = useMutation({
    mutationFn: adminApi.configureTelegram,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-config'] });
      setShowConfigModal(false);
      setBotToken('');
      setBotUsername(generateBotUsername());
      alert('Telegram bot configured successfully!');
    },
    onError: (error: any) => {
      alert(`Failed to configure Telegram: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Unconfigure Telegram mutation
  const unconfigureMutation = useMutation({
    mutationFn: adminApi.unconfigureTelegram,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-config'] });
      alert('Telegram bot removed successfully');
    },
    onError: (error: any) => {
      alert(`Failed to remove Telegram: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Send test message mutation
  const sendTestMutation = useMutation({
    mutationFn: ({ chatId, message }: { chatId: string; message: string }) =>
      adminApi.sendTestTelegramMessage(chatId, message),
    onSuccess: () => {
      alert('Test message sent successfully!');
      setShowTestModal(false);
      setTestChatId('');
    },
    onError: (error: any) => {
      alert(`Failed to send test message: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleConfigure = (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken) {
      alert('Please enter the bot token');
      return;
    }
    configureMutation.mutate({ bot_token: botToken, bot_username: botUsername });
  };

  const handleUnconfigure = () => {
    if (confirm('Are you sure you want to remove Telegram configuration? This will disable all Telegram notifications.')) {
      unconfigureMutation.mutate();
    }
  };

  const handleSendTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testChatId) {
      alert('Please enter a chat ID');
      return;
    }
    const message = 'This is a test message from AddaxAI Connect!';
    sendTestMutation.mutate({ chatId: testChatId, message });
  };

  const isTelegramConfigured = !telegramError && telegramConfig?.is_configured;

  return (
    <ServerPageLayout
      title="Server settings"
      description="Configure server-wide settings for timezone and notifications"
    >
      <Card>
        <CardContent className="pt-6">
          {/* Camera timezone */}
          <div className="flex items-center gap-8">
            <div className="w-1/2 shrink-0">
              <label className="text-sm font-medium block">Camera timezone</label>
              <p className="text-sm text-muted-foreground mt-1">
                Timezone the cameras are set to. Used for exports and activity charts.
              </p>
            </div>
            <div className="flex-1">
              {settingsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <TimezoneSelect
                  value={timezone}
                  onChange={setTimezone}
                  disabled={tzSaveStatus === 'saving'}
                />
              )}
            </div>
          </div>

          <div className="border-t my-6" />

          {/* Telegram notifications */}
          <div className="flex items-center gap-8">
            <div className="w-1/2 shrink-0">
              <label className="text-sm font-medium block">Telegram notifications</label>
              <p className="text-sm text-muted-foreground mt-1">
                {isTelegramConfigured && telegramConfig
                  ? <>Bot <code className="text-xs bg-muted px-1 py-0.5 rounded">@{telegramConfig.bot_username}</code> is active. Users can configure Telegram notifications in their project settings. <button onClick={() => setShowProfilePicModal(true)} className="text-primary hover:underline">Add a profile picture</button>.</>
                  : 'Configure a Telegram bot to enable instant notifications.'}
              </p>
            </div>
            <div className="flex-1">
              {telegramLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : isTelegramConfigured ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUnconfigure}
                  disabled={unconfigureMutation.isPending}
                >
                  {unconfigureMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Removing...</>
                  ) : (
                    'Remove bot'
                  )}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfigModal(true)}
                >
                  Configure bot
                </Button>
              )}
            </div>
          </div>

          {/* Save button */}
          {tzError && (
            <>
              <div className="border-t my-6" />
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {tzError}
              </div>
            </>
          )}

          {hasTimezoneChanges && (
            <>
              <div className="border-t my-6" />
              <div className="flex justify-end">
                <Button
                  onClick={handleSaveTimezone}
                  disabled={tzSaveStatus === 'saving'}
                >
                  {tzSaveStatus === 'saving' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save changes'
                  )}
                </Button>
              </div>
            </>
          )}

          {tzSaveStatus === 'success' && !hasTimezoneChanges && (
            <>
              <div className="border-t my-6" />
              <div className="flex justify-end">
                <p className="text-sm text-[#0f6064]">Timezone saved</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* SpeciesNet settings (conditional) */}
      {isSpeciesNet && (
        <>
          {/* Geofencing card */}
          <Card className="mt-6 mb-6">
            <CardContent className="pt-6">
              {/* Country */}
              <div className="flex items-center gap-8">
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Country</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select the country where cameras are deployed. Filters out species that do not occur in this country. Only applies to new analyses, not retroactively.
                  </p>
                </div>
                <div className="flex-1">
                  {settingsLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <CountrySelect
                      value={countryCode}
                      onChange={(code) => {
                        setCountryCode(code);
                        if (code !== 'USA') setAdmin1Region('');
                      }}
                      disabled={geoSaveStatus === 'saving'}
                    />
                  )}
                </div>
              </div>

              {/* State (conditional) */}
              {countryCode === 'USA' && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex items-center gap-8">
                    <div className="w-1/2 shrink-0">
                      <label className="text-sm font-medium block">State</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Optionally narrow geofencing to a specific US state.
                      </p>
                    </div>
                    <div className="flex-1">
                      <StateSelect
                        value={admin1Region}
                        onChange={setAdmin1Region}
                        disabled={geoSaveStatus === 'saving'}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Error */}
              {geoError && (
                <>
                  <div className="border-t my-6" />
                  <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {geoError}
                  </div>
                </>
              )}

              {/* Save button */}
              {hasGeoChanges && countryCode && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex justify-end">
                    <Button
                      onClick={handleSaveGeo}
                      disabled={geoSaveStatus === 'saving'}
                    >
                      {geoSaveStatus === 'saving' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                      )}
                    </Button>
                  </div>
                </>
              )}

              {geoSaveStatus === 'success' && !hasGeoChanges && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex justify-end">
                    <p className="text-sm text-[#0f6064]">Geofencing settings saved</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Taxonomy mapping card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-8">
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Taxonomy mapping</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Upload a CSV with <code className="text-xs bg-muted px-1 py-0.5 rounded">latin</code> and <code className="text-xs bg-muted px-1 py-0.5 rounded">common</code> columns. You can generate one with Dan Morris's <a href="https://dmorris.net/speciesnet-taxonomy-mapper/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">taxonomy mapper tool</a>. Saving a new file replaces the existing mapping and reprocesses unverified classifications.
                    {entries.length > 0 && (
                      <>{' '}<button onClick={() => setShowMapping(true)} className="text-primary hover:underline">View current mapping ({entries.length} labels)</button>.</>
                    )}
                  </p>
                </div>
                <div className="flex-1">
                  <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                      isDragActive
                        ? 'border-primary bg-primary/5'
                        : pendingFile
                          ? 'border-primary/50 bg-accent/30'
                          : 'border-border hover:border-primary/50 hover:bg-accent/50'
                    }`}
                  >
                    <input {...getInputProps()} />
                    <div className="flex flex-col items-center space-y-2">
                      <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
                      <p className="text-sm font-medium">
                        {isDragActive
                          ? 'Drop CSV here...'
                          : pendingFile
                            ? (
                              <span className="inline-flex items-center gap-1">
                                {pendingFile.name}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setPendingFile(null); }}
                                  className="p-0.5 hover:bg-accent rounded"
                                  title="Remove file"
                                >
                                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </span>
                            )
                            : 'Drop CSV here, or click to select'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>


              {/* Save button */}
              {pendingFile && (
                <>
                  <div className="border-t my-6" />
                  <div className="flex justify-end">
                    <Button onClick={handleUploadPending}>
                      <Save className="h-4 w-4 mr-2" />
                      Save and reprocess
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Upload progress modal */}
      {uploadModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              {uploadModal.status === 'error' ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    <h3 className="text-lg font-semibold">Upload failed</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{uploadModal.error}</p>
                  <div className="flex justify-end">
                    <Button onClick={() => setUploadModal({ open: false, status: 'uploading' })}>
                      Close
                    </Button>
                  </div>
                </>
              ) : uploadModal.status === 'done' ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    <h3 className="text-lg font-semibold">Upload complete</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Uploaded {uploadModal.count} taxonomy entries.
                  </p>
                  {(uploadModal.reprocessedCount ?? 0) > 0 && (
                    <p className="text-sm text-muted-foreground mb-1">
                      {uploadModal.reprocessedCount} classifications reprocessed.
                    </p>
                  )}
                  <div className="flex justify-end mt-6">
                    <Button onClick={() => setUploadModal({ open: false, status: 'uploading' })}>
                      Close
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  <h3 className="text-lg font-semibold">Uploading and reprocessing...</h3>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Configure Telegram Bot</h2>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleConfigure} className="space-y-4">
                <div className="bg-muted border border-border p-4 rounded-md mb-4">
                  <div className="flex gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        <strong>Follow these steps to create your Telegram bot:</strong>
                      </p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Make sure you have a Telegram account on your phone and the app installed</li>
                        <li>
                          Go to:{' '}
                          <a
                            href="https://web.telegram.org/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            https://web.telegram.org/
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                        <li>Follow the steps to link Telegram to your phone</li>
                        <li>
                          Search for{' '}
                          <code className="px-1.5 py-0.5 bg-background rounded inline-flex items-center">
                            @BotFather
                            <CopyButton text="@BotFather" id="copy-botfather" />
                          </code>
                        </li>
                        <li>
                          Send the command{' '}
                          <code className="px-1.5 py-0.5 bg-background rounded inline-flex items-center">
                            /newbot
                            <CopyButton text="/newbot" id="copy-newbot" />
                          </code>
                        </li>
                        <li>
                          Name your bot{' '}
                          <code className="px-1.5 py-0.5 bg-background rounded inline-flex items-center">
                            AddaxAI Connect
                            <CopyButton text="AddaxAI Connect" id="copy-botname" />
                          </code>
                          {' '}(use this exact name)
                        </li>
                        <li>
                          Choose username{' '}
                          <code className="px-1.5 py-0.5 bg-background rounded inline-flex items-center">
                            {botUsername}
                            <CopyButton text={botUsername} id="copy-username" />
                          </code>
                          {' '}(use this exact username, you can change it later via @BotFather)
                        </li>
                        <li>Copy the bot token (looks like: <em>123456789:ABCdefGHIjklMNOpqrs-TUVwxyz_A1</em>)</li>
                      </ol>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Bot Token
                  </label>
                  <input
                    type="text"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456789:ABCdefGHIjklMNOpqrs-TUVwxyz_A1"
                    className="w-full px-3 py-2 border rounded-md font-mono text-sm"
                    required
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The token provided by @BotFather. Use the bot name and username shown above.
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowConfigModal(false)}
                    className="px-4 py-2 border border-border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={configureMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {configureMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Configuring...
                      </>
                    ) : (
                      'Configure Bot'
                    )}
                  </button>
                </div>
              </form>
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
                <div className="bg-muted border border-border p-4 rounded-md mb-4">
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> The recipient must have started a conversation with the bot by sending /start
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Chat ID
                  </label>
                  <input
                    type="text"
                    value={testChatId}
                    onChange={(e) => setTestChatId(e.target.value)}
                    placeholder="123456789"
                    className="w-full px-3 py-2 border rounded-md"
                    required
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The chat ID obtained from the bot's /start command response
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
                      'Send Test Message'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Profile Picture Modal */}
      {showProfilePicModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Add a profile picture</h2>
                <button
                  onClick={() => setShowProfilePicModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>
                  Download the{' '}
                  <code className="px-1.5 py-0.5 bg-muted rounded inline-flex items-center">
                    logo
                    <DownloadButton fileName="addaxai-logo.png" />
                  </code>
                </li>
                <li>
                  Open{' '}
                  <code className="px-1.5 py-0.5 bg-muted rounded inline-flex items-center">
                    @BotFather
                    <CopyButton text="@BotFather" id="copy-botfather-pic" />
                  </code>
                  {' '}in Telegram
                </li>
                <li>
                  Click{' '}
                  <code className="px-1.5 py-0.5 bg-muted rounded">
                    Open
                  </code>
                  {' '}next to the message input
                </li>
                <li>Select your bot, then Edit info, then Set New Photo</li>
              </ol>
              <div className="flex justify-end mt-6">
                <Button variant="outline" onClick={() => setShowProfilePicModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Taxonomy Mapping Modal */}
      {showMapping && entries.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="p-6 pb-0 flex items-center justify-between">
              <h2 className="text-xl font-bold">Taxonomy mapping ({entries.length} labels)</h2>
              <button
                onClick={() => setShowMapping(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 pt-4">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-4 py-2">Latin</th>
                    <th className="text-left px-4 py-2">Common name</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div className="px-6 pb-6 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-t">
                      <td className="px-4 py-2 font-mono text-xs">{entry.latin}</td>
                      <td className="px-4 py-2">{entry.common}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </ServerPageLayout>
  );
};
