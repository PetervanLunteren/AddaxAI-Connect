# Two-factor login

With two-factor login you log in with your password and a code from an app on your phone. Someone who has your password still cannot get in.

It is optional for every account. A project can require it for everyone who can open that project.

## Switch it on

1. Click the circle with your letter in the top right and choose Account.
2. Next to "Two-factor login", click "Set up". The dialog has three steps.
3. Install an authenticator app on your phone, for example Google Authenticator or Microsoft Authenticator. Both are free in the App Store and on Google Play.
4. Scan the QR code with the app. On the phone itself, tap "Open in your authenticator app".
5. Type the six-digit code the app shows.
6. Save the recovery codes that appear, with the download or the copy button. They are shown once.

From now on the login page asks for a code after your password.

## Recovery codes

You get ten recovery codes when you switch it on. Each code logs you in once when you do not have your phone. Type it in the same field as the code from the app. After a login with a recovery code, the app says how many you have left.

The codes have no 0, 1, I or O, so you cannot mix those up when you type one.

Keep them somewhere safe that is not your phone, for example in a password manager. To get ten new codes, switch two-factor login off and on again. When one of your projects requires two-factor login you cannot switch it off, so ask an admin to reset it. You then set it up again at your next login.

## Remember this browser

Tick "Remember this browser for 30 days" when you type the code. On that browser the login then asks for your password only, for 30 days. Use it on your own computer, not on a shared one.

Every remembered browser is forgotten when you change your password, or when two-factor login is switched off or reset.

## Switch it off

On the Account page, click "Manage" next to "Two-factor login" and type a code from the app or a recovery code. This does not work while a project you can open requires two-factor login.

## You lost your phone

Log in with a recovery code. Then switch two-factor login off and set it up again with your new phone. When one of your projects requires two-factor login you cannot switch it off, so ask an admin to reset it.

No recovery codes either? Ask a project admin or a server admin to reset your two-factor login. You then log in with your password only and can set it up again.

## For project admins

### Require it for a project

Open Project settings and switch on "Require two-factor login". Everyone who can open the project then needs two-factor login. That includes the server admins, because they can open every project.

Nobody is logged out. Who has not set it up yet gets the setup screen at their next login, and cannot open anything before it is done. That goes for all their projects, because two-factor login belongs to the account and not to one project.

### Reset it for a user

On the Users page, the "Two-factor" column shows who has it on. Open the three-dot menu at the end of the row and choose "Reset two-factor login". A reset switches it off for that account. The user gets an email about it.

Make sure the request really comes from the user. Someone who stole a password could ask for a reset to get past the code.

A project admin cannot reset a server admin, and cannot reset a user who is also in a project they do not manage. Those users ask a server admin. A server admin can reset every user, on the Users page of a project or on the Server admins page. Nobody can reset their own account, that goes with a code, see [switch it off](#switch-it-off).

## For server admins

A server admin who is locked out, with no other server admin to do the reset, uses the script on the server:

```bash
cd /opt/addaxai-connect
docker compose exec -T api python /app/scripts/reset_two_factor.py someone@example.org
```

The secret of every authenticator app is stored encrypted. The key is derived from `JWT_SECRET` in `.env`. When that value changes, for example because the server is rebuilt with a new one, no code from an app is accepted any more. Recovery codes still work. To switch two-factor login off for every account so everyone can set it up again:

```bash
docker compose exec -T api python /app/scripts/reset_two_factor.py --all
```

## How it is protected

- The app accepts a code once, so a code that was seen cannot be used again.
- After five wrong codes the account has to wait 15 minutes.
- Recovery codes are stored as a hash, so nobody can read them.
- You get an email when two-factor login is switched on, switched off or reset.

See [security](security.md) for the rest.
