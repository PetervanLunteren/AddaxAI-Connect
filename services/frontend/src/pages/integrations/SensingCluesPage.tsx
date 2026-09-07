/**
 * Sensing Clues integration page (project admins).
 *
 * Sensing Clues is a notification channel for the project: when one of the
 * rules on this page fires, one observation with the photo is posted into
 * the project's Cluey group. The account that posts is server level (a
 * service account owned by Addax), so the page only holds the group id and
 * what the delivery worker recorded about the connection, and opens the
 * three rule sheets in their Sensing Clues mode. Sent observations are
 * never changed again; the record stays here in Connect.
 */
import React, { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button, buttonVariants } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SettingRow, SettingRowDivider } from '../../components/ui/SettingRow';
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
import { connectionDetail, connectionPill, errorDetail } from '../../utils/integrationStatus';

const DOCS_URL = 'https://connect.addaxai.com/integrations/sensingclues/';
const CENTRAL_URL = 'https://central.sensingclues.org/';
const CHANNEL = 'sensingclues' as const;

export const SensingCluesPage: React.FC = () => {
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
    queryKey: ['integration-sensingclues', projectIdNum],
    queryFn: () => integrationsApi.getSensingClues(projectIdNum),
    enabled: projectIdNum > 0 && canAdminCurrentProject,
  });
  const isConfigured = status?.is_configured ?? false;
  // True while loading, so the unavailable note never flashes on a server
  // that does offer the integration
  const isAvailable = status?.is_available ?? true;

  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: ['integration-sensingclues', projectIdNum] });

  // Rule counts for the three rows. Same keys as the sheets in their
  // Sensing Clues mode, so edits there refresh these badges.
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
    mutationFn: (value: string) => {
      const groupId = Number(value);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error('The group id is a whole number, for example 3523928.');
      }
      return integrationsApi.configureSensingClues(projectIdNum, groupId);
    },
    onSuccess: () => {
      invalidateStatus();
      toast.success('Group id saved. Send a test observation to check the connection.');
    },
    onError: (error: any) => toast.error(`Could not save the group id. ${errorDetail(error)}`),
  });

  const testMutation = useMutation({
    mutationFn: () => integrationsApi.testSensingClues(projectIdNum),
    // The test modal shows the outcome; refresh the row's health either way.
    onSettled: () => invalidateStatus(),
  });

  const removeMutation = useMutation({
    mutationFn: () => integrationsApi.removeSensingClues(projectIdNum),
    onSuccess: () => {
      invalidateStatus();
      setConfirmRemove(false);
      toast.success('Sensing Clues disconnected');
    },
    onError: (error: any) => {
      setConfirmRemove(false);
      toast.error(`Could not disconnect. ${errorDetail(error)}`);
    },
  });

  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  // Connection status shown on the row: a pill plus a one-line detail.
  const pill = connectionPill(status);
  const statusDetail = status
    ? connectionDetail(
        status,
        status.group_id != null ? `Group ${status.group_id}. ` : '',
        'observation',
        'Not tested yet. Send a test observation to check the group id.',
      )
    : null;

  // The note under the Connection row covers the idle states the pill does
  // not: the server has no account, no group id saved, or a group id but
  // no active rule. A paused rule sends nothing either, so this counts
  // active rules. Waits for the three rule lists so it does not flash on
  // every page open.
  const rulesLoaded = detectionRules && cameraRules && theftRules;
  const activeRules = activeCount(detectionRules) + activeCount(cameraRules) + activeCount(theftRules);
  const note = !isAvailable
    ? (
      <>
        Sensing Clues is not enabled on this server yet. Ask your server admin to switch it on, the{' '}
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">setup guide</a>{' '}
        explains how.
      </>
    )
    : !isConfigured
      ? 'No group id is saved, so nothing is sent. The rules below stay as they are and start working again when a group id is saved.'
      : rulesLoaded && activeRules === 0
        ? 'The group id is saved, but no rules are active, so nothing is sent yet. Add a detection, camera or theft watch rule below to start posting observations.'
        : null;

  const emptyDescription = (
    <>
      Make a group in Cluey or{' '}
      <a href={CENTRAL_URL} target="_blank" rel="noreferrer" className="underline">Central</a>,
      invite the user addax_service into it, then enter the group id here. The{' '}
      <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">setup guide</a>{' '}
      walks you through it.
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
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-0">Sensing Clues</h1>
          <p className="text-sm text-gray-600 mt-1">
            Send detections and camera alerts to a Sensing Clues group as observations in the Cluey app.
          </p>
        </div>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className={`${buttonVariants({ variant: 'outline' })} whitespace-nowrap self-start`}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Documentation
        </a>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 mb-6 rounded-lg border bg-muted/30 px-6 py-5">
        <img
          src="/integrations/sensingclues-logo.svg"
          alt="Sensing Clues"
          className="h-14 w-auto shrink-0 self-start sm:self-center"
        />
        <div className="flex-1 space-y-2 text-sm text-muted-foreground">
          <p>
            Sensing Clues is a conservation technology platform from a non-profit foundation. Its
            field app Cluey lets rangers and researchers record observations into shared groups, so
            a team sees on one map what everyone recorded. Groups and their members are managed in
            Central, the web app.
          </p>
          <p>
            This integration makes the project one of those group members. When a rule on this
            page fires, the alert lands in your group as an observation with the annotated photo,
            placed at the camera's location, within seconds of the image arriving. The team handles
            it in Cluey like any other observation, while the full image record stays here in
            AddaxAI Connect.
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
              note={note}
              connectDisabled={!isAvailable}
              onSaveKey={(value) => configureMutation.mutateAsync(value)}
              onDisconnect={() => setConfirmRemove(true)}
              onTest={async () => {
                try {
                  await testMutation.mutateAsync();
                } catch (e) {
                  throw new Error(errorDetail(e));
                }
              }}
              testLabel="Send test observation"
              testModalTitle="Send a test observation"
              testExplanation={<>This posts a real observation to your Sensing Clues group, titled "Test from AddaxAI Connect", to check that the group id is right and that addax_service is a member. It stays in the group like any other observation.</>}
              testSuccessMessage="Test passed. The observation should appear in your Cluey group within a minute."
              docsUrl={DOCS_URL}
              modalTitle="Connect Sensing Clues"
              replaceModalTitle="Change the group id"
              replaceLabel="Change group id"
              saveLabel="Save"
              keyLabel="Group id"
              keyPlaceholder="3523928"
              secret={false}
              inputMode="numeric"
              modalHelp={<>Open the group in{' '}
                <a href={CENTRAL_URL} target="_blank" rel="noreferrer" className="underline">Central</a>{' '}
                and copy the number shown with its details. The user addax_service must already be
                a member of that group.</>}
            />

            <SettingRowDivider />

            {ruleRow(
              'Detection observations',
              'Post an observation when a selected label is detected. Narrow by site, time of day, or group size, and use the cooldown so one visit gives one observation.',
              activeCount(detectionRules),
              'Manage detection rules',
              () => setShowDetectionSheet(true),
            )}

            <SettingRowDivider />

            {ruleRow(
              'Camera condition observations',
              'Post an observation at the camera\'s site when its battery drops, its SD card fills up, it goes silent, or it sends rejected files. Once per incident.',
              activeCount(cameraRules),
              'Manage camera rules',
              () => setShowCameraSheet(true),
            )}

            <SettingRowDivider />

            {ruleRow(
              'Theft watch observations',
              'Post an observation when a person is unusually close to a camera, or a camera stays silent for longer than its own rhythm. Beta, can raise false alarms.',
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
        title="Disconnect Sensing Clues?"
        body="The group id is forgotten and no more observations are sent. The rules stay and start working again when a group id is saved."
        confirmLabel="Disconnect"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={removeMutation.isPending}
      />
    </div>
  );
};
