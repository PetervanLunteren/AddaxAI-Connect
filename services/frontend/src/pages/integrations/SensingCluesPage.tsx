/**
 * Sensing Clues integration page (project admins).
 *
 * Sensing Clues is a notification channel for the project: when one of the
 * rules on this page fires, one observation with the photo is posted into
 * the project's Cluey group. The page holds the Cluey account that posts,
 * the group it posts into and what the delivery worker recorded about the
 * connection, and opens the three rule sheets in their Sensing Clues mode.
 * Sent observations are never changed again; the record stays here in
 * Connect.
 *
 * The setup modal fills itself in. As soon as the address, the username
 * and the password are there it asks Sensing Clues which groups that
 * account belongs to, and the group becomes a dropdown of their names. So
 * nobody looks a group number up in Central, and a group that would be
 * refused is never offered. That lookup leaves the account refused for
 * about a second, which is why it happens here while someone is typing
 * and never while alerts are going out.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button, buttonVariants } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SettingRow, SettingRowDivider } from '../../components/ui/SettingRow';
import { ConnectionRow } from '../../components/ConnectionRow';
import { useToast } from '../../components/ui/Toaster';
import { DetectionAlertRulesSheet } from '../../components/DetectionAlertRulesSheet';
import { CameraAlertRulesSheet } from '../../components/CameraAlertRulesSheet';
import { TheftWatchSheet } from '../../components/TheftWatchSheet';
import { useProject } from '../../contexts/ProjectContext';
import { useRuleOptions } from '../../hooks/useRuleOptions';
import { integrationsApi, SensingCluesAccount, SensingCluesGroup } from '../../api/integrations';
import { detectionAlertRulesApi } from '../../api/detectionAlertRules';
import { cameraAlertRulesApi } from '../../api/cameraAlertRules';
import { theftWatchApi } from '../../api/theftWatch';
import { connectionDetail, connectionPill, errorDetail } from '../../utils/integrationStatus';

const DOCS_URL = 'https://connect.addaxai.com/integrations/sensingclues/';
const CENTRAL_URL = 'https://central.sensingclues.org/';
// Their production API, the same service as the test host one version back.
// A test deployment overrides it in the field with central-test.
const DEFAULT_BASE_URL = 'https://central.sensingclues.org/v1/';
const CHANNEL = 'sensingclues' as const;

export const SensingCluesPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = projectId ? Number(projectId) : 0;
  const { selectedProject, canAdminCurrentProject } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [confirmRemove, setConfirmRemove] = useState(false);
  // What the setup modal has found out about the account being typed.
  const [groups, setGroups] = useState<SensingCluesGroup[] | null>(null);
  const [groupsPending, setGroupsPending] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  // The account the last lookup was for, so the same three values are not
  // asked twice, and so a late answer for an account the user has already
  // typed past is thrown away.
  const askedFor = useRef<string>('');
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

  // Ask which groups an account can post into, once the three account
  // fields are filled. Debounced, because this runs on every keystroke and
  // it signs in to Sensing Clues.
  const [pendingAccount, setPendingAccount] = useState<SensingCluesAccount | null>(null);

  const onValuesChange = (values: Record<string, string>) => {
    const account = {
      base_url: (values.base_url || '').trim(),
      username: (values.username || '').trim(),
      password: values.password || '',
    };
    if (!account.base_url || !account.username || !account.password) {
      // Nothing to ask with yet. Clear an older list so a half typed
      // account can never leave a group from another one selectable.
      askedFor.current = '';
      setPendingAccount(null);
      setGroups(null);
      setGroupsError(null);
      return;
    }
    setPendingAccount(account);
  };

  useEffect(() => {
    if (!pendingAccount) return;
    const key = JSON.stringify(pendingAccount);
    if (key === askedFor.current) return;
    const timer = setTimeout(async () => {
      askedFor.current = key;
      setGroupsPending(true);
      setGroupsError(null);
      try {
        const found = await integrationsApi.listSensingCluesGroups(projectIdNum, pendingAccount);
        // Someone typed on while this was in flight; their answer wins.
        if (askedFor.current !== key) return;
        setGroups(found);
      } catch (error: any) {
        if (askedFor.current !== key) return;
        setGroups(null);
        setGroupsError(errorDetail(error));
      } finally {
        setGroupsPending(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [pendingAccount, projectIdNum]);

  const forgetGroups = (open: boolean) => {
    if (open) return;
    askedFor.current = '';
    setPendingAccount(null);
    setGroups(null);
    setGroupsError(null);
    setGroupsPending(false);
  };

  const configureMutation = useMutation({
    mutationFn: (values: Record<string, string>) => {
      const groupId = Number(values.group_id);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error('Pick the group this project posts into.');
      }
      return integrationsApi.configureSensingClues(projectIdNum, {
        base_url: values.base_url,
        username: values.username,
        password: values.password,
        group_id: groupId,
        group_name: groups?.find((g) => g.id === groupId)?.name,
      });
    },
    onSuccess: () => {
      invalidateStatus();
      toast.success('Connected. Send a test observation to see one arrive in your group.');
    },
    onError: (error: any) => toast.error(`Could not connect. ${errorDetail(error)}`),
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
        status.group_id != null
          ? `${status.group_name || `Group ${status.group_id}`} as ${status.username}. `
          : '',
        'observation',
        'Not checked yet. Send a test observation to see one land in your group.',
      )
    : null;

  // The note under the Connection row covers the two idle states the pill
  // does not: nothing connected, or connected but no active rule. A paused
  // rule sends nothing either, so this counts active rules. Waits for the
  // three rule lists so it does not flash on every page open.
  const rulesLoaded = detectionRules && cameraRules && theftRules;
  const activeRules = activeCount(detectionRules) + activeCount(cameraRules) + activeCount(theftRules);
  const note = !isConfigured
    ? 'No account is connected, so nothing is sent. The rules below stay as they are and start working again when one is connected.'
    : rulesLoaded && activeRules === 0
      ? 'The account is connected, but no rules are active, so nothing is sent yet. Add a detection, camera or theft watch rule below to start posting observations.'
      : null;

  const savedGroupOption = status?.group_id != null
    ? [{ value: String(status.group_id), label: status.group_name || `Group ${status.group_id}` }]
    : [];

  // One line under the group dropdown saying what is happening, so an
  // empty list is never a mystery.
  const groupStatus = groupsPending
    ? 'Checking the account with Sensing Clues...'
    : groupsError
      ? groupsError
      : groups === null
        ? (isConfigured
            // The change modal already shows the saved group by name, so
            // saying the groups still have to appear would read as a
            // contradiction.
            ? 'Type the password to see the other groups this account can post into.'
            : 'The groups appear once the address, the username and the password are filled in.')
        : groups.length === 0
          ? 'This account is not a member of any group yet. Invite it into a group in Central, then try again.'
          : null;

  const emptyDescription = (
    <>
      Make a group in Cluey or{' '}
      <a href={CENTRAL_URL} target="_blank" rel="noreferrer" className="underline">Central</a>,
      then connect a Sensing Clues account that is a member of that group. The{' '}
      <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline">setup guide</a>{' '}
      walks you through it.
    </>
  );

  const fields = [
    {
      name: 'base_url',
      label: 'Sensing Clues address',
      defaultValue: status?.base_url || DEFAULT_BASE_URL,
      help: 'Leave this as it is unless Sensing Clues told you otherwise.',
    },
    {
      name: 'username',
      label: 'Username',
      placeholder: 'your Sensing Clues account',
      defaultValue: status?.username || '',
    },
    {
      name: 'password',
      label: 'Password',
      secret: true,
      help: 'Kept on this server so it can post for you. A separate account for AddaxAI Connect is safer than your own login.',
    },
    {
      name: 'group_id',
      label: 'Group',
      placeholder: groups === null ? 'Fill in the account first' : 'Choose a group',
      defaultValue: status?.group_id != null ? String(status.group_id) : '',
      // Always an array, so the field is a dropdown from the start and
      // never turns from a text box into one under the user's hands.
      // Before a list arrives, the group already saved stands in for it,
      // so changing the connection shows the current group rather than an
      // empty box.
      options: groups
        ? groups.map((group) => ({ value: String(group.id), label: group.name }))
        : savedGroupOption,
      disabled: groupsPending,
      status: groupStatus,
      help: groups && groups.length > 0
        ? 'Everyone in this group sees the observations.'
        : undefined,
    },
  ];

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
            <ConnectionRow
              title="Connection"
              isConfigured={isConfigured}
              pill={isConfigured ? pill : null}
              statusDetail={statusDetail}
              emptyDescription={emptyDescription}
              note={note}
              fields={fields}
              onValuesChange={onValuesChange}
              onModalOpenChange={forgetGroups}
              onSave={(values) => configureMutation.mutateAsync(values)}
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
              testExplanation={<>This posts a real observation to your Sensing Clues group, titled "Test from AddaxAI Connect", so you can see one arrive the way a real alert will. It stays in the group like any other observation.</>}
              testSuccessMessage="Test passed. The observation should appear in your Cluey group within a minute."
              docsUrl={DOCS_URL}
              modalTitle="Connect Sensing Clues"
              replaceModalTitle="Change the connection"
              replaceLabel="Change connection"
              modalHelp={<>The account signs in to Sensing Clues for you. Fill it in and the groups it belongs to appear below, so you do not have to look a group number up.</>}
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
        body="The account and the group are forgotten and no more observations are sent. The rules stay and start working again when an account is connected."
        confirmLabel="Disconnect"
        cancelLabel="Keep it"
        variant="destructive"
        isPending={removeMutation.isPending}
      />
    </div>
  );
};
