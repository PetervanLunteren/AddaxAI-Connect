/**
 * Notifications page for project-level notification preferences
 *
 * Two-column layout matching ProjectSettingsPage pattern
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Save, X, MessageCircle, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { MultiSelect, Option } from '../components/ui/MultiSelect';
import { notificationsApi } from '../api/notifications';
import { adminApi } from '../api/admin';
import { speciesApi } from '../api/species';
import QRCode from 'react-qr-code';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { normalizeLabel } from '../utils/labels';

export const NotificationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { user } = useAuth();
  const { selectedProject } = useProject();

  // Telegram species state
  const [telegramNotifySpecies, setTelegramNotifySpecies] = useState<Option[]>([]);

  // Telegram linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  // Email reports state
  const [reportFrequency, setReportFrequency] = useState<'disabled' | 'daily' | 'weekly' | 'monthly'>('disabled');

  // Excessive image alerts state
  const [excessiveImagesThreshold, setExcessiveImagesThreshold] = useState(0);

  // Query preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notification-preferences', projectIdNum],
    queryFn: () => notificationsApi.getPreferences(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0,
  });

  // Query Telegram status (any authenticated user)
  const { data: telegramStatus } = useQuery({
    queryKey: ['telegram-status'],
    queryFn: () => adminApi.getTelegramStatus(),
  });
  const isTelegramConfigured = telegramStatus?.is_configured ?? false;
  const adminEmail = telegramStatus?.admin_email ?? null;

  // Fetch available species from the API (model-dependent)
  const { data: availableSpeciesData } = useQuery({
    queryKey: ['available-species'],
    queryFn: () => speciesApi.getAvailable(),
  });
  const isSpeciesNet = availableSpeciesData?.model === 'speciesnet';

  // For DeepFaune: use project's included_species filter if set, otherwise full model list
  // For SpeciesNet: always use taxonomy_mapping labels (included_species is not used)
  // Always include person/vehicle as they are detection-level categories
  const availableSpecies = useMemo(() => {
    const modelSpecies = availableSpeciesData?.species ?? [];
    const baseSpecies = (!isSpeciesNet && selectedProject?.included_species) || modelSpecies;
    return [...new Set([...baseSpecies, 'person', 'vehicle'])];
  }, [availableSpeciesData?.species, isSpeciesNet, selectedProject?.included_species]);
  const speciesOptions: Option[] = useMemo(() =>
    availableSpecies
      .slice()
      .sort()
      .map(species => ({
        label: normalizeLabel(species),
        value: species
      })),
    [availableSpecies]
  );

  // Update form when preferences load
  useEffect(() => {
    if (preferences) {
      const notificationChannels = (preferences as any).notification_channels;

      if (notificationChannels) {
        const speciesConfig = notificationChannels.species_detection || {};

        // Convert species to options, filtering out species no longer in the project
        const telegramSpeciesValues = (speciesConfig.notify_species || [])
          .filter((species: string) => availableSpecies.includes(species));
        setTelegramNotifySpecies(telegramSpeciesValues.map((species: string) => ({
          label: normalizeLabel(species),
          value: species
        })));

        // Email reports configuration
        const emailReportConfig = notificationChannels.email_report || {};
        setReportFrequency(emailReportConfig.enabled ? (emailReportConfig.frequency || 'weekly') : 'disabled');

        // Excessive image alerts configuration
        const excessiveConfig = notificationChannels.excessive_images || {};
        setExcessiveImagesThreshold(excessiveConfig.enabled ? (excessiveConfig.threshold || 50) : 0);

      } else {
        // Fall back to legacy fields if notification_channels doesn't exist
        const speciesOpts = (preferences.notify_species || [])
          .filter(species => availableSpecies.includes(species))
          .map(species => ({
            label: normalizeLabel(species),
            value: species
          }));
        setTelegramNotifySpecies(speciesOpts);
      }
    }
  }, [preferences, availableSpecies]);

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

  // Query Telegram link status
  const { data: linkStatus, refetch: refetchLinkStatus } = useQuery({
    queryKey: ['telegram-link-status', projectIdNum],
    queryFn: () => notificationsApi.checkTelegramLinkStatus(projectIdNum),
    enabled: !!projectIdNum && projectIdNum > 0 && isTelegramConfigured,
    refetchInterval: false,
  });

  const isTelegramLinked = linkStatus?.linked ?? false;
  const isTelegramUsable = isTelegramConfigured && isTelegramLinked;

  // Generate Telegram link token mutation
  const generateTokenMutation = useMutation({
    mutationFn: () => notificationsApi.generateTelegramLinkToken(projectIdNum),
    onSuccess: (data) => {
      setLinkToken(data.token);
      setDeepLink(data.deep_link);
      setShowLinkModal(true);
    },
    onError: (error: any) => {
      alert(`Failed to generate link: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleGenerateLink = () => {
    generateTokenMutation.mutate();
  };

  // Unlink Telegram mutation
  const unlinkMutation = useMutation({
    mutationFn: () => notificationsApi.unlinkTelegram(projectIdNum),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-link-status', projectIdNum] });
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', projectIdNum] });
      alert('Telegram account unlinked successfully!');
    },
    onError: (error: any) => {
      alert(`Failed to unlink Telegram: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleUnlink = () => {
    if (confirm('Are you sure you want to unlink your Telegram account? You will need to link it again to receive notifications.')) {
      unlinkMutation.mutate();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build notification_channels JSON structure
    const channels: string[] = [];
    if (isTelegramLinked) channels.push('telegram');

    // Use Telegram settings for legacy fields
    const legacySpeciesValues = isTelegramLinked ? telegramNotifySpecies.map(opt => opt.value) : [];

    // Build notification_channels JSON with per-channel configuration
    const notificationChannels = {
      species_detection: {
        enabled: isTelegramLinked,
        channels: channels,
        notify_species: isTelegramLinked
          ? (telegramNotifySpecies.length > 0 ? telegramNotifySpecies.map(opt => opt.value) : null)
          : null
      },
      email_report: {
        enabled: reportFrequency !== 'disabled',
        frequency: reportFrequency !== 'disabled' ? reportFrequency : 'weekly'
      },
      excessive_images: {
        enabled: excessiveImagesThreshold > 0,
        threshold: excessiveImagesThreshold > 0 ? excessiveImagesThreshold : 50
      }
    };

    updateMutation.mutate({
      // Legacy fields (for backward compatibility)
      enabled: isTelegramLinked,
      signal_phone: null,
      telegram_chat_id: isTelegramLinked ? (linkStatus?.chat_id || null) : null,
      notify_species: legacySpeciesValues.length > 0 ? legacySpeciesValues : null,
      notify_low_battery: false,
      battery_threshold: 30,
      notify_system_health: false,
      // New multi-channel configuration
      notification_channels: notificationChannels,
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Notifications</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Configure alerts for species detections and system events</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardContent className="pt-6">

              {/* Species alerts row */}
              <div className={`flex items-center gap-8 ${!isTelegramUsable ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Real-time detection alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isTelegramLinked ? (
                      <>
                        {'Receive an instant Telegram message with a photo each time a species is detected. Leave empty to get alerts for all species. '}
                        {unlinkMutation.isPending ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                            <span>Unlinking...</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleUnlink}
                            className="text-muted-foreground hover:underline"
                          >
                            Unlink Telegram
                          </button>
                        )}
                      </>
                    ) : isTelegramConfigured ? (
                      <>
                        Receive an instant Telegram message with a photo each time a species is detected. Link your Telegram account to get started.{' '}
                        {generateTokenMutation.isPending ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                            <span className="text-primary">Generating link...</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleGenerateLink}
                            className="text-primary hover:underline font-medium pointer-events-auto"
                          >
                            Click here to link
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        Receive an instant Telegram message with a photo each time a species is detected. A Telegram bot has not been configured for this server yet.{' '}
                        {user?.is_superuser ? (
                          <Link to="/server/settings" className="text-primary hover:underline font-medium pointer-events-auto">
                            Click here to configure it
                          </Link>
                        ) : adminEmail ? (
                          <a href={`mailto:${adminEmail}`} className="text-primary hover:underline font-medium pointer-events-auto">
                            Click here to contact your server admin
                          </a>
                        ) : (
                          <span>Contact your server admin to set it up</span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex-1">
                  <MultiSelect
                    options={speciesOptions}
                    value={telegramNotifySpecies}
                    onChange={setTelegramNotifySpecies}
                    placeholder="Select species to notify about..."
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Email reports row */}
              <div className="flex items-center gap-8">
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Project updates</label>
                  <p className="text-sm text-muted-foreground mt-1">Receive a scheduled email with a summary of your project, including the number of new images, species detected, and camera activity since the last report.</p>
                </div>
                <div className="flex-1 relative">
                  <select
                    value={reportFrequency}
                    onChange={(e) => setReportFrequency(e.target.value as 'disabled' | 'daily' | 'weekly' | 'monthly')}
                    className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="disabled">Disabled</option>
                    <option value="daily">Daily (sent at 06:00 UTC)</option>
                    <option value="weekly">Weekly (sent every Monday)</option>
                    <option value="monthly">Monthly (sent on the 1st)</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Excessive image alerts row */}
              <div className="flex items-center gap-8">
                <div className="w-1/2 shrink-0">
                  <label className="text-sm font-medium block">Excessive image alerts</label>
                  <p className="text-sm text-muted-foreground mt-1">Receive an email alert when a camera exceeds a daily image threshold. This usually indicates a problem like waving grass or direct sunlight triggering the sensor repeatedly.</p>
                </div>
                <div className="flex-1 relative">
                  <select
                    value={excessiveImagesThreshold}
                    onChange={(e) => setExcessiveImagesThreshold(Number(e.target.value))}
                    className="w-full h-10 px-3 pr-8 text-sm border border-input rounded-md bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value={0}>Disabled</option>
                    <option value={25}>25 images per day</option>
                    <option value={50}>50 images per day</option>
                    <option value={100}>100 images per day</option>
                    <option value={200}>200 images per day</option>
                    <option value={500}>500 images per day</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-6" />

              {/* Save button */}
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

            </CardContent>
          </Card>
        </form>
      )}

      {/* Telegram linking modal */}
      {showLinkModal && deepLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Link your Telegram account</h2>
                <button
                  onClick={() => setShowLinkModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* QR code */}
                <div className="flex justify-center bg-white p-4 rounded-lg">
                  <QRCode value={deepLink} size={200} />
                </div>

                {/* Open Telegram button */}
                <div className="flex justify-center">
                  <a
                    href={deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-center font-medium flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Open in Telegram
                  </a>
                </div>

                {/* Instructions */}
                <div className="bg-muted border border-border p-4 rounded-md">
                  <ol className="list-decimal list-outside ml-4 space-y-2 text-sm text-muted-foreground">
                    <li className="pl-2">Scan the QR code above with your phone, or click the button above to open Telegram</li>
                    <li className="pl-2">Press Start in Telegram when it opens</li>
                    <li className="pl-2">Come back here and click "Check status" to confirm</li>
                  </ol>
                </div>

                {/* Check status button */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await refetchLinkStatus();
                      if (result.data?.linked) {
                        setShowLinkModal(false);
                      }
                    }}
                    className="px-6 py-2 border border-border bg-background rounded-md hover:bg-accent transition-colors"
                  >
                    Check status
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
