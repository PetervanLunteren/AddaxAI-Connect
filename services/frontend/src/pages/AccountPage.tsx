/**
 * Account page
 *
 * Everything about the account that is logged in: the email address, the
 * password and two-factor login. Reached from the account menu in the top
 * bar. The two dialogs are the same ones the menu used to open, this page
 * only gives them a place that can be linked to.
 */
import React, { useState } from 'react';
import { ServerPageLayout } from '../components/layout/ServerPageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SettingRow, SettingRowDivider } from '../components/ui/SettingRow';
import { StatusPill } from '../components/ui/StatusPill';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { TwoFactorModal } from '../components/TwoFactorModal';
import { useAuth } from '../hooks/useAuth';

export const AccountPage: React.FC = () => {
  const { user } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showTwoFactor, setShowTwoFactor] = useState(false);

  if (!user) return null;

  return (
    <ServerPageLayout title="Account" description="Your own login, the same in every project">
      <Card>
        <CardContent className="pt-6">
          <SettingRow title="Email address" description="You log in with this address.">
            <span className="text-sm break-all">{user.email}</span>
          </SettingRow>

          <SettingRowDivider />

          <SettingRow
            title="Password"
            description="Changing your password logs you out everywhere else."
          >
            <Button variant="outline" size="sm" onClick={() => setShowChangePassword(true)}>
              Change password
            </Button>
          </SettingRow>

          <SettingRowDivider />

          <SettingRow
            title="Two-factor login"
            description="After your password you type a code from an authenticator app on your phone."
          >
            <div className="flex items-center gap-3">
              <StatusPill tone={user.two_factor_enabled ? 'neutral' : 'muted'}>
                {user.two_factor_enabled ? 'On' : 'Off'}
              </StatusPill>
              <Button variant="outline" size="sm" onClick={() => setShowTwoFactor(true)}>
                {user.two_factor_enabled ? 'Manage' : 'Set up'}
              </Button>
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
      <TwoFactorModal
        open={showTwoFactor}
        onClose={() => setShowTwoFactor(false)}
      />
    </ServerPageLayout>
  );
};
