# Testing an update

Run an update against a copy of your production data first, on a dev server.
About three minutes per server. Demo data does not have the shapes real data
has, so this catches what unit tests cannot.

## The dev server

You need one server that holds a copy of production data and can never reach
your users.

Build it like a lost server, with the [restore guide](restore-guide.md), and set
three things differently in its `host_vars`:

```yaml
domain_name: "dev.example.com"    # must start with dev
app_environment: development      # makes it a dev server
git_version: main                 # follows main, production runs releases
```

Development mode sends email and Telegram only to the addresses in
`dev_notify_emails`, which is `admin_email` unless you set it. After a restore
it also clears the restored Telegram bot, the integrations and two-factor login,
so the copy cannot act as the real server.

Keep `backup_enabled: false`. The dev server shares the backup bucket with
production, and with backups on it could write over a real server's backup. It
does need the bucket keys, to read the backups it restores.

Change its settings in `host_vars` and run the playbook with
`--tags sync-config`. Never edit `.env` on the server by hand: several values
come from the domain name, and a hand edit once made a dev server write into a
production server's backup.

## One server

*(on the dev server)*

```bash
cd /opt/addaxai-connect
git pull origin main
bash scripts/test-update.sh <production-domain>
```

It restores that server's latest backup, applies the migrations, and verifies
the result. `PASS` or `FAIL`.

A dev server follows `main`, which is why `git pull` is right here. Production
servers sit on a tagged release instead.

You do not say which version to start from. The backup carries the schema
production is on, so restoring it already puts the dev server at that point.

## Every server

```bash
bash scripts/test-update-sweep.sh site-a.example.com site-b.example.com
```

```
  dataset             result    time    images   cams
  ------------------  ------  ------  --------  -----
  site-a.example.com  pass      193s     2,510      5
  site-b.example.com  pass      212s     2,999     30

  2/2 passed
```

A failure does not stop the sweep, so you always get the full picture. Results
land in `/tmp/sweep-<date>/`.

## Images

Only the database is restored, because the images are nearly all the bytes. A
sample of about ten pictures is fetched anyway, chosen to hit different code
paths, so image serving is still checked. Add `--full` to restore everything,
which takes hours and is rarely worth it.

## When it fails

The JSON beside the log names the failing check.

```bash
grep -o '"name": "[a-z]*", "status": "fail"' /tmp/sweep-<date>/site-a.json
```

- **migrations** crashed on real data. The restore log path is in the failure line.
- **api** a query broke on a data shape this server has. The endpoint is named.
- **images** pictures did not serve. Objects missing from the backup only warn,
  so a failure here is a code problem.

## Warnings

Every run wipes the dev server's database. Whatever you restored last stays on
it.

Never point these at a production server. They refuse unless
`ENVIRONMENT=development`, but do not lean on that alone.
