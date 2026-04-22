#!/bin/bash
# Daily backup to Wasabi.
#
# Dumps postgres, mirrors every authoritative MinIO bucket, and mirrors the
# host-side project-images + reference-images directories. No .env, no Redis,
# no model weights (those are regenerable). Retention is handled by a Wasabi
# bucket lifecycle rule, not by this script.
#
# Scheduled by ansible at 02:00 UTC. Run manually for testing.

set -euo pipefail

APP_DIR="/opt/addaxai-connect"
LOG_PREFIX() { date -u +'%Y-%m-%d %H:%M:%S UTC'; }
log()  { echo "[$(LOG_PREFIX)] $*"; }

cd "$APP_DIR"

# Self-guard: restore.sh drops a .restore-in-progress file while it runs. Skip
# this backup if it's there (and fresh) so we don't mirror a half-restored
# state over the good remote backup. Ignore the lock if it's stale (>6 h),
# which means restore.sh probably died without cleaning up.
LOCK_FILE="$APP_DIR/.restore-in-progress"
if [ -f "$LOCK_FILE" ]; then
  lock_age_s=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE") ))
  if [ "$lock_age_s" -lt 21600 ]; then
    log "restore in progress (lock ${lock_age_s}s old); skipping backup"
    exit 0
  fi
  log "WARNING: ignoring stale restore lock at $LOCK_FILE (${lock_age_s}s old)"
fi

# Load the vars we need from .env without using `source`. `source .env` breaks
# on values with unquoted spaces (e.g. Gmail app passwords like
# "pguc htvu fawt bfxo" on MAIL_PASSWORD), which is valid for docker-compose
# but not for bash.
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

BACKUP_ENABLED="$(env_get BACKUP_ENABLED)"
BACKUP_ENDPOINT="$(env_get BACKUP_ENDPOINT)"
BACKUP_BUCKET="$(env_get BACKUP_BUCKET)"
BACKUP_ACCESS_KEY="$(env_get BACKUP_ACCESS_KEY)"
BACKUP_SECRET_KEY="$(env_get BACKUP_SECRET_KEY)"
BACKUP_HOST_PREFIX="$(env_get BACKUP_HOST_PREFIX)"
POSTGRES_USER="$(env_get POSTGRES_USER)"
POSTGRES_DB="$(env_get POSTGRES_DB)"
MINIO_ROOT_USER="$(env_get MINIO_ROOT_USER)"
MINIO_ROOT_PASSWORD="$(env_get MINIO_ROOT_PASSWORD)"
REDIS_PASSWORD="$(env_get REDIS_PASSWORD)"

if [ "${BACKUP_ENABLED:-false}" != "true" ]; then
  log "BACKUP_ENABLED is not true; skipping"
  exit 0
fi

HOST="${BACKUP_HOST_PREFIX:-$(hostname)}"
DATE="$(date -u +%F)"
BUCKET="$BACKUP_BUCKET"
START_EPOCH="$(date +%s)"

redis_set_status() {
  # Write status to Redis so /api/health/services can surface it.
  local status="$1"
  local error_msg="${2:-}"
  local now_iso duration payload
  now_iso="$(date -u +'%Y-%m-%dT%H:%M:%S+00:00')"
  duration="$(( $(date +%s) - START_EPOCH ))"
  if [ -n "$error_msg" ]; then
    payload=$(printf '{"status":"%s","timestamp":"%s","duration_s":%d,"error":"%s"}' \
      "$status" "$now_iso" "$duration" "${error_msg//\"/\\\"}")
  else
    payload=$(printf '{"status":"%s","timestamp":"%s","duration_s":%d}' \
      "$status" "$now_iso" "$duration")
  fi
  # 3-day TTL: if no backup runs for 3 days, key disappears and health flips.
  docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" \
    SET backup:last_run "$payload" EX 259200 > /dev/null 2>&1 || true
}

on_error() {
  local line=$1
  local msg="backup failed at line $line"
  log "ERROR: $msg"
  redis_set_status "error" "$msg"
  exit 1
}
trap 'on_error $LINENO' ERR

log "Starting backup to wasabi://$BUCKET/$HOST/ (date=$DATE)"

# Register the backup-side Wasabi alias inside the minio container. Use a
# unique alias name so we don't collide with the existing cold-tier alias.
docker compose exec -T minio mc alias set backup-target \
  "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" > /dev/null

# Register the local MinIO alias so we can read from buckets.
docker compose exec -T minio mc alias set local \
  "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null

# Idempotent bucket setup. On a freshly provisioned server, first backup run
# enables versioning and installs the 90-day retention rule. On subsequent
# runs everything is a no-op. Any Wasabi-side drift (e.g. console edits) gets
# reconciled back. This is the same remove-all + re-add pattern the cold-tier
# minio-init uses for its ILM rule.
# TEMP: stdout redirects to /dev/null are removed in this block so every mc
# call prints what it does (per-object uploads, retention rule output, alias
# confirmation). Revert by re-adding `> /dev/null` after every mc invocation
# once cold-tier and backup verification is done. See TODO.md.
log "Ensuring backup bucket has versioning + 90-day retention rule"
docker compose exec -T minio mc version enable "backup-target/$BUCKET"
# `rule remove --all --force` errors on a truly fresh bucket that has no
# lifecycle config yet. That's not a failure, it's first-run state. Tolerate.
docker compose exec -T minio mc ilm rule remove --all --force "backup-target/$BUCKET" || true
docker compose exec -T minio mc ilm rule add \
  --noncurrentversion-expiration-days 90 \
  --expired-object-delete-marker \
  "backup-target/$BUCKET"

log "Dumping postgres"
# --clean --if-exists makes the dump self-cleaning: DROP IF EXISTS before every
# CREATE, so `restore.sh` can pipe it into any state (empty or populated) without
# dropping the DB first. --no-owner and --no-privileges make the dump portable
# across DB users (e.g. restore runs with different password after a rebuild).
docker compose exec -T postgres pg_dump \
  --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip \
  | docker compose exec -T minio mc pipe "backup-target/$BUCKET/$HOST/postgres/$DATE.sql.gz"
log "Postgres dump uploaded"

# MinIO buckets. Live mirror into a single prefix; Wasabi versioning + the
# lifecycle rule (noncurrent-version-expiration 90 days) handles history.
for MINIO_BUCKET in raw-images crops thumbnails project-images project-documents models; do
  log "Mirroring minio/$MINIO_BUCKET"
  # TEMP: verbose mirror (no `> /dev/null`). See TODO.md.
  docker compose exec -T minio mc mirror --overwrite --remove \
    "local/$MINIO_BUCKET" "backup-target/$BUCKET/$HOST/minio/$MINIO_BUCKET"
done
log "All MinIO buckets mirrored"

# Host image dirs, bind-mounted into the minio container read-only at /host/*.
for HOST_DIR in project-images reference-images; do
  log "Mirroring host/$HOST_DIR"
  # TEMP: verbose mirror (no `> /dev/null`). See TODO.md.
  docker compose exec -T minio mc mirror --overwrite --remove \
    "/host/$HOST_DIR" "backup-target/$BUCKET/$HOST/$HOST_DIR"
done
log "Host image dirs mirrored"

redis_set_status "ok"
log "Backup complete in $(( $(date +%s) - START_EPOCH ))s"
