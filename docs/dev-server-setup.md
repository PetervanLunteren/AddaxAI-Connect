# Setting up a dev server

A dev server is a normal deployment holding a copy of production data. Use it
to test an update before it touches a live server, to reproduce a bug against
real data, or to try a change without risk.

Build it the same way you would rebuild a lost server, then mark it as
development so it cannot reach your users.

## 1. Build it

Follow the [restore guide](restore-guide.md). It provisions a fresh VM with the
playbook and loads the data from a backup.

Three things to set differently in `ansible/host_vars/<server>.yml`:

```yaml
domain_name: "dev.example.com"    # a domain starting with dev
app_environment: development      # this is what makes it a dev server
git_version: main                 # follow main, other servers run the newest release
```

Start the domain with `dev`. The data-purge tooling in the app refuses to run
anywhere else, which is a second safety net independent of the settings above.

Never edit `.env` on the server by hand. Several of its values are derived from
`domain_name`, so changing one line by hand leaves the rest pointing at the
server you copied from. That is how a dev server ended up writing its backups
into a production server's prefix. Change `host_vars` and re-run the playbook
instead:

```bash
ansible-playbook -i ansible/inventory.yml ansible/playbook.yml --limit <server> --tags sync-config
```

## 2. What development mode changes

`app_environment: development` turns on three protections. Without it a server
loaded with production data will contact real people.

| Protection | Effect |
|---|---|
| Notification allow-list | Email and Telegram go only to `dev_notify_emails` and `dev_notify_chat_ids`. Everything else is dropped and logged. |
| No Telegram polling | With no chat ids listed, the server does not poll for `/start`. Telegram allows one client per bot token, so a copy would otherwise steal messages from the real server. |
| Bot config cleared on restore | `restore.sh` deletes the restored Telegram bot token, so the copy cannot fight the original over it. |
| EarthRanger keys cleared on restore | `restore.sh` also deletes the restored Gundi API keys, so a copy never posts events to a real ranger map. Paste a key on the dev server on purpose to test. |

`dev_notify_emails` defaults to `admin_email`, so alerts you trigger yourself
still arrive while everyone else is protected. Both workers say what they are
restricting to at startup:

```bash
docker compose logs notifications-email --tail 20 | grep Development
```

## 3. Keep backups off

Leave `backup_enabled: false`. A dev server shares the backup bucket with
production and writes under a prefix taken from its own `domain_name`. Enabling
backups on a server whose prefix is wrong would overwrite a real server's
backup.

## Things to watch

- **Cron jobs.** Check `crontab -l`. A dev server keeps the backup and prune
  entries; the backup one exits immediately while `backup_enabled` is false.
- **Old data.** The restore replaces the database and images, not anything
  written since. Re-run `restore.sh` for a clean slate.
- **Disk.** A production copy is as large as production. Watch `df -h`.
