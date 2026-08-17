# Update guide

How to update a production server.

Test it first on a dev server with a copy of this server's data. See
[testing an update](test-update.md). Three minutes, and it catches most
problems before production sees them.

## 1. Check the backup

*(on the production server)*

The nightly backup is your rollback. Make sure it ran.

```bash
cd /opt/addaxai-connect && tail -3 logs/backup.log
```

Look for `Backup complete`, today or yesterday. If it is older, run
`bash scripts/backup.sh` and wait.

## 2. Sync the config

*(on your laptop)*

Writes `.env` from your `host_vars` and installs any new cron jobs.

```bash
ansible-playbook -i ansible/inventory.yml ansible/playbook.yml \
  --limit <server> --tags sync-config
```

Do this **before** the rebuild. New code sometimes reads a new setting.

## 3. Pull and rebuild

*(on the production server)*

```bash
cd /opt/addaxai-connect
git pull origin main
docker compose up -d --build --force-recreate
```

The code is baked into the images, so the rebuild is not optional.

## 4. Migrate

*(on the production server)*

```bash
bash scripts/update-database.sh
```

Watch the output. Most update problems show up here.

## 5. Verify

*(on the production server)*

```bash
bash scripts/verify-server.sh
```

Checks containers, migrations, health, read-only endpoints against your real
data, a sample of images, and the logs. Prints `PASS` or `FAIL`.

Then open the site and log in.

## If it goes wrong

Migrations do not roll back safely, so restore the database instead.

```bash
cd /opt/addaxai-connect
git checkout <previous-tag>
docker compose up -d --build --force-recreate
bash scripts/restore.sh <this-server-domain> --force
```

Check out the old code first, so it matches the schema in the backup. List
tags with `git tag --sort=-creatordate | head -5`.

If the server is broken rather than the data, build a new one from the backup.
See the [restore guide](restore-guide.md).
