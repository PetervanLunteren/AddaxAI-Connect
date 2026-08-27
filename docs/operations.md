# Operations and monitoring

Once your server is running, here is how to check that everything is healthy and diagnose issues.

## System health page

The web interface has a built-in health page at `Server settings > System health` (server admins only). It checks connectivity to all infrastructure services (PostgreSQL, Redis, MinIO), verifies that the API and frontend are responding, and shows queue depth for each worker. It also reports whether the processing pipeline has pending images.

![System health page](https://github.com/user-attachments/assets/c244fc1e-7419-4d83-bb69-e44578f2b79b)

If a service shows as unhealthy, check its logs (see below).

## Viewing logs

All services write structured JSON to stdout, captured by Docker. Use `docker compose logs` on the server to inspect them.

```bash
# View recent logs for a specific service
docker compose logs api --tail 50
docker compose logs ingestion --tail 50
docker compose logs detection --tail 50

# Follow logs in real time
docker compose logs -f api

# Follow all services at once
docker compose logs -f --tail 20
```

Each log entry includes a timestamp, service name, and log level. Most entries also carry correlation IDs (`image_id`, `request_id`, `user_id`) so you can trace a single image or request across services.

## Checking service status

```bash
# See which containers are running
docker compose ps

# Check if any container is restarting (sign of a crash loop)
docker compose ps | grep -i restarting
```

All services should show `Up` or `running`. If a container shows `Restarting` or `Exit`, check its logs.

## Monitoring the pipeline

Images flow through the pipeline in order: ingestion, detection, classification, notifications. If images are uploading but not appearing in the web interface, you can narrow down where they are stuck.

**Check queue depths** from the System health page, or from the command line:

```bash
# Check how many messages are waiting in each queue
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN image-ingested
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN detection-complete
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN notification-events
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN failed-jobs
```

A growing `image-ingested` queue means detection is falling behind or stuck. A growing `detection-complete` queue means classification is the bottleneck. The `failed-jobs` queue collects messages that could not be processed after repeated failures.

## File management

The `File management` page (hamburger menu, server admins only) shows rejected files and their rejection reasons. Common reasons: no matching camera profile, missing GPS or timestamp metadata, wrong file format, or file too large. You can delete rejected files or move them back for reprocessing from this page. Reprocessing puts a file back on the path the camera uploaded it to, so it goes through ingestion exactly like a fresh upload.

When the server can read the camera ID from a rejected file (missing or invalid GPS, missing date), the file also counts against that camera. The Cameras page shows a `Rejected files` column, a `cameras with rejected files` chip in the needs attention strip, and a `Rejected` tab in the camera panel with the files and their reasons. Every project member sees this; the pictures are blurred when the project hides people or vehicles. Files without a readable camera ID (no metadata, unknown camera model) only show on `File management`.

Rejected files are kept for 30 days and then deleted, from disk and from the count.

To get a message when a camera starts rejecting files, add a camera alert rule of type `Rejected files per day` on the notifications page. It is checked once a day together with the battery, SD card and silence rules.

![File management page](https://github.com/user-attachments/assets/e1651680-7fce-4a27-8a21-10cb59e21408)

## Disk and storage

```bash
# Check disk usage on the server
df -h

# Check MinIO bucket sizes (from inside the container)
docker compose exec minio mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
docker compose exec minio mc du local/raw-images
docker compose exec minio mc du local/crops
docker compose exec minio mc du local/thumbnails
```

## Cold storage tier

Older raw images can transition from local MinIO to a remote S3-compatible cold tier (Wasabi recommended) once on-disk `raw-images` exceeds a configurable budget. Reads stay on the same `raw-images` bucket; MinIO transparently fetches cold objects, so no application code changes. Thumbnails, crops, project documents, and models always stay hot.

Tiering is enabled when `COLD_TIER_ENABLED=true` in `.env`. Configure the cold-tier vars in `ansible/host_vars/<server>.yml` and re-run the playbook. Leave `cold_tier_enabled: false` to keep everything local.

Confirm the tier is registered and the ILM rule is installed:

```bash
docker compose exec minio mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
docker compose exec minio mc admin tier ls local
docker compose exec minio mc ilm rule ls local/raw-images
```

Inspect a single object's tier. Look at the `Storage class` field; `STANDARD` is hot and the tier name (e.g. `WASABI_COLD`) is cold.

```bash
docker compose exec minio mc stat local/raw-images/<key>
```

Read the watchdog log. Each tick reports `hot=X GB, budget=Y GB` and, if over budget, how many objects were tagged for transition.

```bash
docker compose logs minio-tier-watchdog --tail 50
```

Change the budget by editing `cold_tier_hot_budget_gb` in `ansible/host_vars/<server>.yml`, re-running the playbook, and restarting the watchdog (`docker compose restart minio-tier-watchdog`).

Pause tiering with `docker compose stop minio-tier-watchdog`. Already-cold objects stay readable through the MinIO tier rule.

One-time Wasabi setup: create an account, create a bucket in your chosen region (e.g. Amsterdam is `eu-central-1`, endpoint `s3.eu-central-1.wasabisys.com`), create a bucket-scoped IAM key, fill the cold-tier vars.

## Automated backups

A host-side cron runs `scripts/backup.sh` daily at 02:00 UTC. The script dumps postgres, mirrors every authoritative MinIO bucket, and mirrors the host-side `data/project-images/` and `data/reference-images/` directories into a dedicated Wasabi bucket. Together with your ansible files on your local machine, this is everything needed to cold-start a replacement server.

Explicitly not backed up: `.env` (regenerated by ansible on restore), `data/redis/` (transient queue state), `models/` (re-downloaded on first worker boot), `uploads/` (FTPS staging), TLS certs (certbot regenerates).

### One-time Wasabi setup

1. Create a **new** Wasabi bucket in the same region as your cold-tier bucket (e.g. `addaxai-connect-backups-prod` in `eu-central-1`). Keep this separate from the cold-tier bucket so a compromise of one doesn't touch the other.
2. Create one IAM user per server with a policy locked to that server's prefix (`<domain_name>/`). One key per server means a leaked key exposes one server's data, not everyone's. Needed:
   - An explicit `Deny` for `s3:PutObject`, `s3:DeleteObject`, `s3:DeleteObjectVersion` and the tagging, ACL and restore actions with `NotResource` set to the server's own prefix in both buckets. Wasabi can let a key that may read an object also create a delete marker on it, and a Deny always wins, so this closes that regardless of what the Allow statements say.
   - `s3:ListBucket` and `s3:ListBucketVersions` on the bucket, with a condition `s3:prefix` like `<domain_name>/*` (and `<domain_name>`), so listing another server's folder is refused.
   - `s3:GetBucketLocation`, `s3:GetBucketVersioning`, `s3:GetLifecycleConfiguration`, `s3:ListBucketMultipartUploads` on the bucket. The script reads the lifecycle rule every night to decide whether setup is done.
   - `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` on `<bucket>/<domain_name>/*`. `DeleteObject` is what `mc mirror --remove` uses; with versioning on it only writes a delete marker. Leave out `s3:DeleteObjectVersion` on purpose, so a stolen key cannot erase the 90-day history.
   - Only the very first run against a fresh bucket also needs `s3:PutBucketVersioning` and `s3:PutLifecycleConfiguration` on the bucket, to enable versioning and install the retention rule. Do that first run with a bucket-wide key, or set both up by hand in the Wasabi console, and keep the per-server keys without them.

   The cold-tier key gets the same shape on the cold-tier bucket, without the lifecycle actions.
3. Fill these ansible vars in `host_vars/<server>.yml`:
   ```
   backup_enabled: true
   backup_endpoint: "https://s3.eu-central-1.wasabisys.com"
   backup_bucket: "addaxai-connect-backups-prod"
   backup_region: "eu-central-1"
   backup_access_key: "..."
   backup_secret_key: "..."
   ```
4. Run `ansible-playbook -i inventory.yml playbook.yml --limit <server> --tags env-refresh`. This writes the new `BACKUP_*` lines to `.env` on the server, installs the daily cron, and recreates the affected containers.

Versioning and the 90-day retention lifecycle rule on the Wasabi bucket are applied automatically by `scripts/backup.sh` on its first run (and reconciled on every subsequent run). No manual `mc` commands needed.

### Verify the cron

Crontab entry: `crontab -l` should show `0 2 * * * cd /opt/addaxai-connect && bash scripts/backup.sh >> ...`.

System health page will show a `backup` row that flips to unhealthy if no successful run is recorded within 3 days.

### Manual test

```
ssh <server>
cd /opt/addaxai-connect
bash scripts/backup.sh
tail /opt/addaxai-connect/logs/backup.log
```

Then verify the bucket contents from the `minio` container:
```
docker compose exec minio mc ls backup-target/$BACKUP_BUCKET/<domain_name>/postgres/
docker compose exec minio mc du backup-target/$BACKUP_BUCKET/<domain_name>/minio/raw-images
```

### Restore from a backup

To spin up a new server from one of these backups, see the [restore guide](restore-guide.md). The restore script self-guards the 02:00 UTC cron via a lock file, so no manual toggling of `backup_enabled` is needed.

## Restarting services

```bash
# Restart a single service
docker compose restart detection

# Restart everything
docker compose down && docker compose up -d
```

Restarting a worker is safe. It will pick up where it left off since messages stay in the Redis queue until a worker acknowledges them.

## Common issues

**Images uploading but not showing up:** check the ingestion logs and the File management page. Most likely a missing camera profile or missing metadata.

**Detection is slow or stuck:** check `docker compose logs detection --tail 20`. The detection worker processes one image at a time. If the queue is growing, the worker may have crashed. Restart it with `docker compose restart detection`.

**Emails not sending:** check `docker compose logs notifications-email --tail 20`. Verify SMTP settings in `.env`. Some cloud providers block outbound SMTP ports by default (see the email tip at the end of the [deployment guide](deployment.md)).

**Telegram not working:** check `docker compose logs notifications-telegram --tail 20`. The bot token must be configured in Server settings, and each user must link their account from the Notifications page.
