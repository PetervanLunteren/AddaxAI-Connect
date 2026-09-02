/**
 * EarthRanger integration page (project admins).
 *
 * EarthRanger is a notification channel for the project: when one of the
 * rules on this page fires, one event with the photo is posted to the
 * ranger map through Gundi. The page holds the Gundi API key and what the
 * delivery worker recorded about the connection, and opens the three rule
 * sheets in their EarthRanger mode. Sent events are never changed again;
 * the record stays here in Connect.
 */
import React, { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SettingRow, SettingRowDivider } from '../../components/ui/SettingRow';
import { PillTone } from '../../components/ui/StatusPill';
import { ApiKeyConnectionRow } from '../../components/ApiKeyConnectionRow';
import { useToast } from '../../components/ui/Toaster';
import { DetectionAlertRulesSheet } from '../../components/DetectionAlertRulesSheet';
import { CameraAlertRulesSheet } from '../../components/CameraAlertRulesSheet';
import { TheftWatchSheet } from '../../components/TheftWatchSheet';
import { useProject } from '../../contexts/ProjectContext';
import { useRuleOptions } from '../../hooks/useRuleOptions';
import { integrationsApi } from '../../api/integrations';
import { detectionAlertRulesApi } from '../../api/detectionAlertRules';
import { cameraAlertRulesApi } from '../../api/cameraAlertRules';
import { theftWatchApi } from '../../api/theftWatch';

const DOCS_URL = 'https://connect.addaxai.com/integrations/earthranger/';
const CHANNEL = 'earthranger' as const;

const errorDetail = (error: any): string =>
  error?.response?.data?.detail || error?.message || 'Unknown error';

const formatWhen = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : 'never';

export const EarthRangerPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = projectId ? Number(projectId) : 0;
  const { selectedProject, canAdminCurrentProject } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showDetectionSheet, setShowDetectionSheet] = useState(false);
  const [showCameraSheet, setShowCameraSheet] = useState(false);
  const [showTheftSheet, setShowTheftSheet] = useState(false);

  const { siteOptions, speciesOptions, defaultCooldownMinutes } = useRuleOptions(
    projectIdNum, selectedProject,
  );

  const { data: status, isLoading } = useQuery({
    queryKey: ['integration-earthranger', projectIdNum],
    queryFn: () => integrationsApi.getEarthRanger(projectIdNum),
    enabled: projectIdNum > 0 && canAdminCurrentProject,
  });
  const isConfigured = status?.is_configured ?? false;

  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: ['integration-earthranger', projectIdNum] });

  // Rule counts for the three rows. Same keys as the sheets in their
  // EarthRanger mode, so edits there refresh these badges.
  const { data: detectionRules } = useQuery({
    queryKey: ['detection-alert-rules', projectIdNum, CHANNEL],
    queryFn: () => detectionAlertRulesApi.list(projectIdNum, CHANNEL),
    enabled: projectIdNum > 0 && canAdminCurrentProject,
  });
  const { data: cameraRules } = useQuery({
    queryKey: ['camera-alert-rules', projectIdNum, CHANNEL],
    queryFn: () => cameraAlertRulesApi.list(projectIdNum, CHANNEL),
    enabled: projectIdNum > 0 && canAdminCurrentProject,
  });
  const { data: theftRules } = useQuery({
    queryKey: ['theft-watch-rules', projectIdNum, CHANNEL],
    queryFn: () => theftWatchApi.list(projectIdNum, CHANNEL),
    enabled: projectIdNum > 0 && canAdminCurrentProject,
  });
  const activeCount = (rules: { is_active: boolean }[] | undefined) =>
    (rules || []).filter((r) => r.is_active).length;

  const configureMutation = useMutation({
    mutationFn: (apiKey: string) => integrationsApi.configureEarthRanger(projectIdNum, apiKey),
    onSuccess: () => {
      invalidateStatus();
      toast.success('API key saved. Send a test event to check the connection.');
    },
    onError: (error: any) => toast.error(`Could not save the key: ${errorDetail(error)}`),
  });

  const testMutation = useMutation({
    mutationFn: () => integrationsApi.testEarthRanger(projectIdNum),
    onSuccess: () => {
      invalidateStatus();
      toast.success('Test passed. The event should appear on your EarthRanger map within a minute.');
    },
    onError: (error: any) => {
      invalidateStatus();
      toast.error(`Test event failed: ${errorDetail(error)}`);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => integrationsApi.removeEarthRanger(projectIdNum),
    onSuccess: () => {
      invalidateStatus();
      setConfirmRemove(false);
      toast.success('EarthRanger disconnected');
    },
    onError: (error: any) => {
      setConfirmRemove(false);
      toast.error(`Could not disconnect: ${errorDetail(error)}`);
    },
  });

  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  // Connection status shown on the row: a pill plus a one-line detail.
  const health = status?.health_status;
  const pill: { tone: PillTone; label: string } =
    health === 'healthy' ? { tone: 'success', label: 'Connected' }
    : health === 'error' ? { tone: 'error', label: 'Error' }
    : { tone: 'muted', label: 'Untested' };

  const statusDetail = (() => {
    if (!status) return null;
    const hint = status.api_key_hint ? `Key ending ${status.api_key_hint}. ` : '';
    if (health === 'error') {
      return `${hint}Last attempt failed${status.last_health_check ? ` on ${formatWhen(status.last_health_check)}` : ''}.${status.last_error ? ` ${status.last_error}` : ''}`;
    }
    if (health === 'healthy') {
      const events = status.events_sent > 0
        ? ` Last event sent ${formatWhen(status.last_sent_at)}, ${status.events_sent} event${status.events_sent !== 1 ? 's' : ''} in total.`
        : '';
      return `${hint}Last confirmed ${formatWhen(status.last_health_check)}.${events}`;
    }
    return `${hint}Not tested yet. Send a test event to check the key and the route.`;
  })();

  const emptyDescription = (
    <>
      Set this up in the Gundi portal, then paste the connection's API key here. The{' '}
      <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">setup guide</a>{' '}
      walks you through it, including the EarthRanger event types your site needs.
    </>
  );

  const ruleRow = (
    label: string,
    description: string,
    count: number,
    buttonLabel: string,
    onOpen: () => void,
  ) => (
    <SettingRow title={label} description={description}>
      <Button type="button" variant="outline" size="sm" onClick={onOpen}>
        {buttonLabel}
        {count > 0 && (
          <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
            {count}
          </span>
        )}
      </Button>
    </SettingRow>
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-0">EarthRanger</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">
        Send detections and camera alerts to an EarthRanger site as events on the ranger map.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 mb-6 rounded-lg border bg-muted/30 px-6 py-5">
        <img
          src="/integrations/earthranger-logo.svg"
          alt="EarthRanger, a product of Ai2"
          className="h-14 w-auto shrink-0 self-start sm:self-center"
        />
        <div className="flex-1 space-y-2 text-sm text-muted-foreground">
          <p>
            EarthRanger is a free operations platform for protected areas, used by hundreds of
            parks and reserves worldwide. It gives ranger teams one live map of their area, with
            tracked animals, patrols, vehicles, and reported incidents, so they can see what is
            happening and decide where to act.
          </p>
          <p>
            This integration makes the project one of those report sources. When a rule on this
            page fires, the alert lands on the ranger map as an event with the annotated photo,
            placed at the camera's location, within seconds of the image arriving. Rangers handle
            it there like any other incident, while the full image record stays here in AddaxAI
            Connect.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ApiKeyConnectionRow
              title="Connection"
              isConfigured={isConfigured}
              pill={isConfigured ? pill : null}
              statusDetail={statusDetail}
              emptyDescription={emptyDescription}
              disconnectedNote="No API key is saved, so nothing is sent. The rules below stay as they are and start working again when a key is saved."
              onSaveKey={(key) => configureMutation.mutateAsync(key)}
              onDisconnect={() => setConfirmRemove(true)}
              onTest={() => testMutation.mutate()}
              testing={testMutation.isPending}
              modalTitle="Connect EarthRanger"
              keyLabel="Gundi API key"
              keyPlaceholder="Gundi API key"
              modalHelp={<>Paste the API key from your Gundi connection. Copy it with the copy button in the portal so no spaces sneak in.</>}
            />
            {isConfigured && (
              <p className="text-xs text-muted-foreground mt-2">
                A test event is a real event on the ranger map, titled "Test from AddaxAI
                Connect". Resolve it there afterwards. See the{' '}
                <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">
                  setup and troubleshooting guide
                </a>.
              </p>
            )}

            <SettingRowDivider />

            {ruleRow(
              'Detection events',
              'Post an event when a selected label is detected. Narrow by site, time of day, or group size, and use the cooldown so one visit gives one event.',
              activeCount(detectionRules),
              'Manage detection rules',
              () => setShowDetectionSheet(true),
            )}

            <SettingRowDivider />

            {ruleRow(
              'Camera condition events',
              'Post an event at the camera\'s site when its battery drops, its SD card fills up, it goes silent, or it sends rejected files. Once per incident.',
              activeCount(cameraRules),
              'Manage camera rules',
              () => setShowCameraSheet(true),
            )}

            <SettingRowDivider />

            {ruleRow(
              'Theft watch events',
              'Post an event when a person is unusually close to a camera, or a camera stays silent for longer than its own rhythm. Beta, can raise false alarms.',
              activeCount(theftRules),
              'Manage theft watch rules',
              () => setShowTheftSheet(true),
            )}
          </CardContent>
        </Card>
      )}

      <DetectionAlertRulesSheet
        open={showDetectionSheet}
        onClose={() => setShowDetectionSheet(false)}
        projectId={projectIdNum}
        telegramLinked={false}
        speciesOptions={speciesOptions}
        siteOptions={siteOptions}
        defaultCooldownMinutes={defaultCooldownMinutes}
        channel={CHANNEL}
      />
      <CameraAlertRulesSheet
        open={showCameraSheet}
        onClose={() => setShowCameraSheet(false)}
        projectId={projectIdNum}
        telegramLinked={false}
        channel={CHANNEL}
      />
      <TheftWatchSheet
        open={showTheftSheet}
        onClose={() => setShowTheftSheet(false)}
        projectId={projectIdNum}
        telegramLinked={false}
        siteOptions={siteOptions}
        channel={CHANNEL}
      />

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => removeMutation.mutate()}
        title="Disconnect EarthRanger?"
        body="The API key is forgotten and no more events are sent. The rules stay and start working again when a key is saved."
        confirmLabel="Disconnect"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={removeMutation.isPending}
      />
    </div>
  );
};
