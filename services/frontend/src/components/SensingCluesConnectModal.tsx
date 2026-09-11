/**
 * The Sensing Clues connect flow, in two steps, rendered inside the shared
 * ConnectionRow modal. Step 1 signs in with the posting account (username +
 * password); on success the account's groups are listed and step 2 lets the
 * user pick one and save. The address is a server setting, so it is not asked
 * here. Changing an existing connection reopens at step 1 with the username
 * pre-filled, because the password is never sent back to the browser.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { integrationsApi, SensingCluesGroup } from '../api/integrations';
import { errorDetail } from '../utils/integrationStatus';

interface Props {
  projectId: number;
  /** Pre-filled on a change, empty on a first connect. */
  initialUsername: string;
  /** Close the modal. */
  onDone: () => void;
  /** After a successful save, so the page can refresh and toast. */
  onSaved: () => void;
}

const inputClass = 'w-full px-3 py-2 border rounded-md text-sm';

export const SensingCluesConnectModal: React.FC<Props> = ({
  projectId, initialUsername, onDone, onSaved,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [groups, setGroups] = useState<SensingCluesGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLogin = username.trim() !== '' && password !== '';

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canLogin) return;
    setBusy(true);
    setError(null);
    try {
      const found = await integrationsApi.listSensingCluesGroups(projectId, {
        username: username.trim(), password,
      });
      setGroups(found);
      setGroupId(found.length === 1 ? String(found[0].id) : '');
      setStep(2);
    } catch (err) {
      setError(errorDetail(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!groupId) return;
    setBusy(true);
    setError(null);
    try {
      const name = groups.find((g) => String(g.id) === groupId)?.name;
      await integrationsApi.configureSensingClues(projectId, {
        username: username.trim(), password, group_id: Number(groupId), group_name: name,
      });
      onSaved();
      onDone();
    } catch (err) {
      setError(errorDetail(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === 1) {
    return (
      <form onSubmit={logIn} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Step 1 of 2. Sign in with the Sensing Clues account that posts for this
          project. A separate account for AddaxAI Connect is safer than your own login.
        </p>
        {error && <Callout variant="error">{error}</Callout>}
        <div>
          <label className="block text-sm font-medium mb-2">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your Sensing Clues account"
            autoComplete="off"
            autoFocus={initialUsername === ''}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            autoFocus={initialUsername !== ''}
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Kept on this server so it can post for you.
          </p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
          <Button type="submit" size="sm" disabled={busy || !canLogin}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Log in
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Step 2 of 2. Signed in as {username.trim()}. Pick the group these
        observations go to.
      </p>
      {error && <Callout variant="error">{error}</Callout>}
      {groups.length === 0 ? (
        <Callout variant="info">
          This account is not a member of any group yet. Invite it into a group in
          Central, then log in again.
        </Callout>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-2">Group</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            autoFocus
            className={`${inputClass} bg-background`}
          >
            <option value="">Choose a group</option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>{g.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Everyone in this group sees the observations.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={() => { setStep(1); setError(null); }}>
          Back
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={busy || !groupId}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
};
