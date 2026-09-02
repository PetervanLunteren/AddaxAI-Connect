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
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
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

  const [apiKeyInput, setApiKeyInput] = useState('');
  // null = follow the default (open until a key is saved), boolean = user's choice
  const [setupToggled, setSetupToggled] = useState<boolean | null>(null);
  const [replacingKey, setReplacingKey] = useState(false);
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
      setApiKeyInput('');
      setReplacingKey(false);
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

  const keyForm = (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (apiKeyInput.trim()) configureMutation.mutate(apiKeyInput.trim());
      }}
    >
      <input
        type="password"
        value={apiKeyInput}
        onChange={(e) => setApiKeyInput(e.target.value)}
        placeholder="Gundi API key"
        autoComplete="off"
        className="flex-1 px-3 py-2 border rounded-md text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={configureMutation.isPending || !apiKeyInput.trim()}>
          {configureMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save key
        </Button>
        {replacingKey && (
          <Button type="button" size="sm" variant="outline" onClick={() => { setReplacingKey(false); setApiKeyInput(''); }}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  const healthLine = (() => {
    if (!status) return null;
    if (status.health_status === 'error') {
      return (
        <Callout variant="error" className="mt-3">
          Last attempt failed{status.last_health_check ? ` on ${formatWhen(status.last_health_check)}` : ''}.
          {status.last_error ? ` ${status.last_error}` : ''}
        </Callout>
      );
    }
    if (status.health_status === 'healthy') {
      return (
        <Callout variant="success" className="mt-3">
          Connection working. Last confirmed {formatWhen(status.last_health_check)}.
          {status.events_sent > 0 && (
            <>
              {' '}Last event sent {formatWhen(status.last_sent_at)}, {status.events_sent} event
              {status.events_sent !== 1 ? 's' : ''} in total.
            </>
          )}
        </Callout>
      );
    }
    return (
      <p className="text-sm text-muted-foreground mt-3">
        Not tested yet. Send a test event to check the key and the route.
      </p>
    );
  })();

  const ruleRow = (
    label: string,
    description: string,
    count: number,
    buttonLabel: string,
    onOpen: () => void,
  ) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
      <div className="w-full sm:w-1/2 sm:shrink-0">
        <label className="text-sm font-medium block">{label}</label>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <div className="flex-1">
        <Button type="button" variant="outline" size="sm" onClick={onOpen}>
          {buttonLabel}
          {count > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary">
              {count}
            </span>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-0">EarthRanger</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">
        Send detections and camera alerts to an EarthRanger site as events on the ranger map.
      </p>

      <div className="mb-6">
        <img
          src="/integrations/earthranger-logo.svg"
          alt="EarthRanger, a product of Ai2"
          className="h-14 w-auto mb-3"
        />
        <div className="space-y-2 text-sm text-muted-foreground">
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
        <>
          <Card className="mb-6">
            <CardContent className="pt-6">
              {(() => {
                const showSetup = setupToggled ?? !isConfigured;
                const Chevron = showSetup ? ChevronDown : ChevronRight;
                return (
                  <>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-sm font-medium w-full text-left"
                      onClick={() => setSetupToggled(!showSetup)}
                    >
                      <Chevron className="h-4 w-4 text-muted-foreground" />
                      Setting it up
                    </button>
                    {showSetup && (
                      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                        <p>
                          Events travel through Gundi, EarthRanger's integration hub. You create
                          a connection in the Gundi portal that points at your EarthRanger site
                          and paste its API key here. AddaxAI Connect only ever talks to Gundi,
                          it never sees your EarthRanger address or login, and sent events are
                          never changed afterwards.
                        </p>
                        <ol className="list-decimal ml-5 space-y-1">
                          <li>
                            Ask your EarthRanger admin to add the AddaxAI Connect event types to
                            your site.
                          </li>
                          <li>
                            Create a connection in the Gundi portal, with an API provider and
                            your EarthRanger site as its destination.
                          </li>
                          <li>Copy the connection's API key and save it below.</li>
                          <li>
                            Send a test event and look for it on your EarthRanger map, then set
                            up rules for what to send.
                          </li>
                        </ol>
                        <p>
                          The{' '}
                          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">
                            setup guide
                          </a>{' '}
                          covers each step in detail, with the event type definitions and
                          troubleshooting.
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <label className="text-sm font-medium block">Connection</label>
              {!isConfigured ? (
                <>
                  <p className="text-sm text-muted-foreground mt-1 mb-3">
                    Paste the API key of your Gundi connection here, step 3 above. The{' '}
                    <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">
                      setup guide
                    </a>{' '}
                    shows where to find it.
                  </p>
                  {keyForm}
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mt-1">
                    API key ending in {status?.api_key_hint ?? '…'}.
                  </p>
                  {healthLine}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => testMutation.mutate()}
                      disabled={testMutation.isPending}
                    >
                      {testMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Send test event
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReplacingKey(true)}>
                      Replace key
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRemove(true)}>
                      Disconnect
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    A test event is a real event on the ranger map, titled "Test from AddaxAI
                    Connect". Resolve it there afterwards.
                  </p>
                  {replacingKey && <div className="mt-4">{keyForm}</div>}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardContent className="pt-6">
              {!isConfigured && (
                <Callout variant="info" className="mb-6">
                  No API key is saved, so nothing is sent. The rules below stay as they
                  are and start working again when a key is saved.
                </Callout>
              )}

              {ruleRow(
                'Detection events',
                'Post an event when a selected label is detected. Narrow by site, time of day, or group size, and use the cooldown so one visit gives one event.',
                activeCount(detectionRules),
                'Manage detection rules',
                () => setShowDetectionSheet(true),
              )}

              <div className="border-t my-6" />

              {ruleRow(
                'Camera condition events',
                'Post an event at the camera\'s site when its battery drops, its SD card fills up, it goes silent, or it sends rejected files. Once per incident.',
                activeCount(cameraRules),
                'Manage camera rules',
                () => setShowCameraSheet(true),
              )}

              <div className="border-t my-6" />

              {ruleRow(
                'Theft watch events',
                'Post an event when a person is unusually close to a camera, or a camera stays silent for longer than its own rhythm. Beta, can raise false alarms.',
                activeCount(theftRules),
                'Manage theft watch rules',
                () => setShowTheftSheet(true),
              )}
            </CardContent>
          </Card>
        </>
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
