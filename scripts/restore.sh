#!/bin/bash
# Cold-start disaster recovery: restore this server from a Wasabi backup.
#
# Usage:   bash scripts/restore.sh <source-domain> [date] [--force]
# Example: bash scripts/restore.sh prod.addaxai.com
# Example: bash scripts/restore.sh prod.addaxai.com 2026-04-17
#
# Pulls the postgres dump and every MinIO bucket + host image dir that was
# captured by scripts/backup.sh and loads them into the current server. Refuses
# to run when the users table has any rows unless --force is passed.
#
# Pre-reqs (already true after ansible-playbook on a fresh VM):
#   - .env has BACKUP_ENDPOINT, BACKUP_BUCKET, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY set
#   - docker compose up is running
#   - Set `backup_enabled: false` in group_vars and redeploy *before* restore,
#     then flip it back after the restore is verified. This prevents the 02:00
#     UTC cron from overwriting the good backup with a half-restored state.

set -euo pipefail

APP_DIR="/opt/addaxai-connect"
LOG_PREFIX() { date -u +'%Y-%m-%d %H:%M:%S UTC'; }
log()  { echo "[$(LOG_PREFIX)] $*"; }
die()  { echo "[$(LOG_PREFIX)] ERROR: $*" >&2; exit 1; }

on_error() {
  local line=$1
  die "restore failed at line $line"
}
trap 'on_error $LINENO' ERR

cd "$APP_DIR"

# ---- argument parsing ----
SRC_DOMAIN=""
BACKUP_DATE=""
FORCE="false"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE="true" ;;
    *)
      if [ -z "$SRC_DOMAIN" ]; then
        SRC_DOMAIN="$arg"
      elif [ -z "$BACKUP_DATE" ]; then
        BACKUP_DATE="$arg"
      fi
      ;;
  esac
done

if [ -z "$SRC_DOMAIN" ]; then
  die "source domain required. Usage: bash scripts/restore.sh <source-domain> [date] [--force]"
fi

# ---- load env vars (grep/cut, not `source`, to tolerate values with spaces) ----
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

BACKUP_ENDPOINT="$(env_get BACKUP_ENDPOINT)"
BACKUP_BUCKET="$(env_get BACKUP_BUCKET)"
BACKUP_ACCESS_KEY="$(env_get BACKUP_ACCESS_KEY)"
BACKUP_SECRET_KEY="$(env_get BACKUP_SECRET_KEY)"
POSTGRES_USER="$(env_get POSTGRES_USER)"
POSTGRES_DB="$(env_get POSTGRES_DB)"
MINIO_ROOT_USER="$(env_get MINIO_ROOT_USER)"
MINIO_ROOT_PASSWORD="$(env_get MINIO_ROOT_PASSWORD)"

for v in BACKUP_ENDPOINT BACKUP_BUCKET BACKUP_ACCESS_KEY BACKUP_SECRET_KEY \
         POSTGRES_USER POSTGRES_DB MINIO_ROOT_USER MINIO_ROOT_PASSWORD; do
  [ -n "${!v}" ] || die "$v is empty in .env; cannot proceed"
done

# ---- safety: refuse to restore onto a populated server ----
USER_COUNT="$(docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT COUNT(*) FROM users' \
  2>/dev/null || echo 0)"
USER_COUNT="$(echo "$USER_COUNT" | tr -d '[:space:]')"

if [ "$USER_COUNT" -gt 0 ] && [ "$FORCE" != "true" ]; then
  die "refusing to restore onto a populated server (users table has $USER_COUNT rows). Pass --force to override."
fi

# ---- mc aliases ----
docker compose exec -T minio mc alias set backup-target \
  "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" > /dev/null
docker compose exec -T minio mc alias set local \
  "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null

# ---- resolve date ----
SRC_PREFIX="backup-target/$BACKUP_BUCKET/$SRC_DOMAIN"
POSTGRES_PREFIX="$SRC_PREFIX/postgres"

AVAILABLE="$(docker compose exec -T minio mc ls "$POSTGRES_PREFIX/" 2>/dev/null \
  | awk '{print $NF}' | grep -E '\.sql\.gz$' || true)"

if [ -z "$AVAILABLE" ]; then
  die "no postgres dumps found under $POSTGRES_PREFIX/. Is the source domain correct?"
fi

if [ -z "$BACKUP_DATE" ]; then
  LATEST="$(echo "$AVAILABLE" | sort | tail -1)"
  BACKUP_DATE="${LATEST%.sql.gz}"
  log "no date given, using latest: $BACKUP_DATE"
else
  if ! echo "$AVAILABLE" | grep -q "^${BACKUP_DATE}\.sql\.gz$"; then
    die "dump ${BACKUP_DATE}.sql.gz not found. Available: $(echo "$AVAILABLE" | tr '\n' ' ')"
  fi
fi

# ---- plan summary + grace window ----
log ""
log "About to restore onto this server:"
log "  source    : $SRC_DOMAIN"
log "  date      : $BACKUP_DATE"
log "  bucket    : $BACKUP_BUCKET"
log "  this WILL overwrite the current DB, MinIO contents, and host image dirs."
log "  force mode: $FORCE"
log ""
log "Starting in 5 seconds. Ctrl-C to abort."
sleep 5

START_EPOCH="$(date +%s)"

# ---- postgres ----
log "Restoring postgres dump $BACKUP_DATE.sql.gz"
docker compose exec -T minio mc cat "$POSTGRES_PREFIX/$BACKUP_DATE.sql.gz" \
  | gunzip \
  | docker compose exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --quiet > /dev/null
log "Postgres dump loaded"

log "Applying any pending Alembic migrations"
bash scripts/update-database.sh > /dev/null
log "Schema is at HEAD"

# ---- MinIO buckets ----
for BUCKET in raw-images crops thumbnails project-images project-documents models; do
  log "Mirroring minio/$BUCKET"
  docker compose exec -T minio mc mirror --overwrite --remove \
    "$SRC_PREFIX/minio/$BUCKET" "local/$BUCKET" > /dev/null
done
log "All MinIO buckets restored"

# ---- Host image dirs ----
for HOST_DIR in project-images reference-images; do
  log "Mirroring host/$HOST_DIR"
  docker compose exec -T minio mc mirror --overwrite --remove \
    "$SRC_PREFIX/$HOST_DIR" "/host/$HOST_DIR" > /dev/null
done
log "Host image dirs restored"

# ---- final ----
log "Restarting api to pick up the fresh DB state"
docker compose restart api > /dev/null

log "Restore complete in $(( $(date +%s) - START_EPOCH ))s"
log ""
log "Next steps:"
log "  1. Open the UI and log in with a user from the restored DB."
log "  2. Spot-check: open a project, a camera, a recent image."
log "  3. Flip backup_enabled back to true in group_vars/<host>.yml."
log "  4. ansible-playbook --tags env-refresh."
