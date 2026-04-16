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
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN classification-complete
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN notification-events
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LLEN failed-jobs
```

A growing `image-ingested` queue means detection is falling behind or stuck. A growing `detection-complete` queue means classification is the bottleneck. The `failed-jobs` queue collects messages that could not be processed after repeated failures.

## File management

The `File management` page (hamburger menu, server admins only) shows rejected files and their rejection reasons. Common reasons: no matching camera profile, missing GPS or timestamp metadata, wrong file format, or file too large. You can delete rejected files or move them back for reprocessing from this page.

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

Tiering is enabled when `COLD_TIER_ENDPOINT` is set in `.env`. Configure the cold-tier vars in `ansible/group_vars/dev.yml` (vault-encrypt the access keys) and re-run the playbook. Leave `cold_tier_endpoint` blank to keep everything local.

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

Change the budget by editing `cold_tier_hot_budget_gb` in `ansible/group_vars/dev.yml`, re-running the playbook, and restarting the watchdog (`docker compose restart minio-tier-watchdog`).

Pause tiering with `docker compose stop minio-tier-watchdog`. Already-cold objects stay readable through the MinIO tier rule.

One-time Wasabi setup: create an account, create a bucket in your chosen region (e.g. `eu-central-2`, `s3.eu-central-2.wasabisys.com`), create a bucket-scoped IAM key, fill the cold-tier vars.

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

**Emails not sending:** check `docker compose logs notifications-email --tail 20`. Verify SMTP settings in `.env`. Some cloud providers block outbound SMTP ports by default (see the [deployment troubleshooting](deployment.md#troubleshooting) section).

**Telegram not working:** check `docker compose logs notifications-telegram --tail 20`. The bot token must be configured in Server settings, and each user must link their account from the Notifications page.
