# Security

!!! note
    This page describes AddaxAI Connect v0.19.0 (November 2026). It is not legal advice and makes no claim of compliance with any law. The organisation that runs a project decides whether its use is lawful.

On a server hosted by Addax Data Science and Smart Parks? See [hosted service](hosted-service.md) for who runs the server.

## How do users log in?

With an email address and a password. Nobody can create an account without an invitation. A password needs at least 15 characters and is stored as a hash (Argon2), so nobody can read it. One address can try to log in at most 20 times in 5 minutes. A login lasts one hour. Changing your password ends all other logins of your account. What each account may see is on the [privacy](privacy.md#who-can-see-the-photos) page.

## How do cameras send their photos?

Over FTPS. A camera must log in over an encrypted connection, a login without encryption is refused. The certificate comes from Let's Encrypt and renews itself. Whether the photo itself is encrypted as well depends on the camera.

## What can be reached from the internet?

The website (ports 80 and 443, where 80 only redirects to the encrypted 443), the camera uploads (port 21 and the range 40000 to 50000), and server access over SSH (port 22). A firewall blocks everything else. The database, the message queue and the photo storage are not reachable from the internet. SSH only accepts keys, no passwords. After five failed SSH logins an address is blocked for an hour. The app pages only run the app's own scripts, so a script injected from somewhere else does not run.

## How is the server kept up to date?

The server installs operating system security updates every day, and restarts at night when an update needs it. A security check runs every night. It emails the server admins when something has changed, for example a port that opened. The server also warns them when the disk fills up, a backup fails or a service stops. There is no separate intrusion detection.

## Is the data encrypted?

The website uses HTTPS, and cameras log in over FTPS. Encryption of stored data is part of the hosting, so it depends on where the server and its storage run. That goes for the server's disk and for the copies in remote storage, the cold storage and the backups.

On a server hosted by Addax Data Science and Smart Parks, the storage provider encrypts all these copies. See [hosted service](hosted-service.md).

## How are backups protected?

Backups are optional and run every night. They go to a separate bucket, with a key that is only for backups. That key cannot erase the backup history. So even someone who takes over the server cannot wipe the backups of the last 90 days. See [operations](operations.md#automated-backups).

## What is planned?

Two-factor login, and encryption of the database backup by the app before it is uploaded.

## How do I report a security problem?

Please do not open a public issue. Report it privately on [GitHub](https://github.com/PetervanLunteren/AddaxAI-Connect/security) or email [peter@addaxdatascience.com](mailto:peter@addaxdatascience.com). See the [security policy](https://github.com/PetervanLunteren/AddaxAI-Connect/security/policy).
