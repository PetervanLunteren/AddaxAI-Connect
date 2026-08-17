#!/bin/bash
# Cold-start disaster recovery: restore this server from a Wasabi backup.
#
# Usage:   bash scripts/restore.sh <source-domain> [date] [--force] [--db-only]
# Example: bash scripts/restore.sh prod.addaxai.com
# Example: bash scripts/restore.sh prod.addaxai.com 2026-04-17
# Example: bash scripts/restore.sh prod.addaxai.com --force --db-only
#
# Pulls the postgres dump and every MinIO bucket + host image dir that was
# captured by scripts/backup.sh and loads them into the current server. Refuses
# to run when the users table has any active rows unless --force is passed.
# (The ansible deploy seeds an inactive system@addaxai.com bookkeeping user;
# that one does not count as "populated".)
#
# --db-only restores the database and skips every image mirror. Minutes instead
# of hours, because the images are almost all of the bytes. Use it to test an
# update against real production data, which is what scripts/test-update.sh
# does: migrations and the queries that break on real data shapes only need the
# database. The result is a server whose image rows point at objects that are
# not there, so pictures will not load. That is expected, not a failed restore.
# Never use it for a real recovery.
#
# Pre-reqs (already true after ansible-playbook on a fresh VM):
#   - .env has BACKUP_ENDPOINT, BACKUP_BUCKET, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY set
#   - docker compose up is running
#
# Self-guard: creates .restore-in-progress in APP_DIR at start and removes it
# on exit. scripts/backup.sh skips when that file exists (fresh), so the 02:00
# UTC cron cannot overwrite the good backup with a half-restored state.

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

LOCK_FILE="$APP_DIR/.restore-in-progress"
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ---- argument parsing ----
SRC_DOMAIN=""
BACKUP_DATE=""
FORCE="false"
DB_ONLY="false"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE="true" ;;
    --db-only) DB_ONLY="true" ;;
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
# Count active users only. ansible app-deploy seeds one inactive system user
# (system@addaxai.com, is_active=false) that is bookkeeping, not real usage.
USER_COUNT="$(docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT COUNT(*) FROM users WHERE is_active = true' \
  2>/dev/null || echo 0)"
USER_COUNT="$(echo "$USER_COUNT" | tr -d '[:space:]')"

if [ "$USER_COUNT" -gt 0 ] && [ "$FORCE" != "true" ]; then
  die "refusing to restore onto a populated server ($USER_COUNT active users). Pass --force to override."
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
if [ "$DB_ONLY" = "true" ]; then
  log "  scope     : DATABASE ONLY, images are not restored and will not load"
  log "  this WILL overwrite the current DB. MinIO and host image dirs are left alone."
else
  log "  this WILL overwrite the current DB, MinIO contents, and host image dirs."
fi
log "  force mode: $FORCE"
log ""
log "Starting in 5 seconds. Ctrl-C to abort."
sleep 5

START_EPOCH="$(date +%s)"

# ---- postgres ----
# The dump uses --clean --if-exists, which is not enough on a freshly-deployed
# box: ansible app-deploy has already run the migrations and built the schema,
# and DROP CONSTRAINT chokes when other FKs depend on a primary key. Wipe the
# public schema first so the dump lands on a blank slate.
log "Wiping public schema before restore"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q \
  -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

log "Restoring postgres dump $BACKUP_DATE.sql.gz"
# ON_ERROR_STOP=1 plus --single-transaction means any real failure stops the
# load loudly and rolls back. Without it, the first error aborts the
# transaction and every following command is silently ignored, which makes the
# script claim success on a totally empty DB.
docker compose exec -T minio mc cat "$POSTGRES_PREFIX/$BACKUP_DATE.sql.gz" \
  | gunzip \
  | docker compose exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --quiet -v ON_ERROR_STOP=1 > /dev/null
log "Postgres dump loaded"

log "Applying any pending Alembic migrations"
bash scripts/update-database.sh > /dev/null
log "Schema is at HEAD"

# On a dev box, drop the restored Telegram bot config. A prod backup carries
# the production bot token, and two servers long-polling one token steal each
# other's /start messages (a real incident on 2026-08-12). Clearing it forces
# whoever tests on dev to configure a separate dev bot. A real prod-to-prod
# disaster recovery keeps the config, that server IS the one bot owner.
ENVIRONMENT="$(env_get ENVIRONMENT)"
if [ "$ENVIRONMENT" = "development" ]; then
  log "Dev server: clearing restored Telegram bot config so it cannot fight the source bot"
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q \
    -c 'DELETE FROM telegram_config;' > /dev/null
fi

# Whole-mirror retries, on top of mc's own per-object --retry. Pulling tens of
# thousands of objects over the public internet will hit the occasional dropped
# connection, and one dropped object used to abort the entire restore and leave
# a half-populated server behind. Mirror is idempotent, it skips objects that
# already match, so a second attempt is cheap and only moves what is missing.
MIRROR_ATTEMPTS=4
MIRROR_BACKOFF_S=10

# Mirror a bucket or host dir from the backup. An empty source prefix holds no
# object, so mc mirror fails with "does not exist"; that is the dev/demo case
# (crops, models, project-* stay empty until real activity) and is a safe skip.
# The earlier `mc ls | grep` pre-check could not tell a transient list error
# from "empty" and once silently dropped the whole thumbnails bucket, so it is
# gone.
#
# Deliberately no --skip-errors here, unlike backup.sh. A backup that is missing
# one object is still worth keeping; a restore that is missing one image is a
# server with a hole in it, and we want to hear about that rather than discover
# it months later. So: retry hard, then fail loudly.
mirror_if_present() {
  local label="$1"
  local src="$2"
  local dst="$3"
  local attempt=1
  local out

  while :; do
    if out="$(docker compose exec -T minio mc mirror --overwrite --remove --retry "$src" "$dst" 2>&1)"; then
      log "Mirrored $label"
      return 0
    fi

    if echo "$out" | grep -qi 'does not exist'; then
      log "Skipped $label, the backup holds nothing under this prefix"
      return 0
    fi

    # mc prints one line per object, so only the error lines are worth showing.
    local errors
    errors="$(echo "$out" | grep -i '<ERROR>' | tail -3)"
    [ -n "$errors" ] || errors="$(echo "$out" | tail -3)"

    if [ "$attempt" -ge "$MIRROR_ATTEMPTS" ]; then
      die "mirror of $label failed after $MIRROR_ATTEMPTS attempts: $errors"
    fi

    log "Mirror of $label failed on attempt $attempt of $MIRROR_ATTEMPTS, retrying in ${MIRROR_BACKOFF_S}s"
    log "  last error: $(echo "$errors" | tail -1)"
    attempt=$((attempt + 1))
    sleep "$MIRROR_BACKOFF_S"
  done
}

if [ "$DB_ONLY" = "true" ]; then
  log "Skipping every image mirror (--db-only)"

  # Fetch a small stratified sample anyway, so the serve paths can still be
  # exercised. scripts/lib/sample-images.sql picks one image per interesting
  # case: a person box, a vehicle box, a plain classified frame, a pending or
  # failed one, a bulk import, one per camera, the oldest and the newest.
  # Around a dozen files instead of tens of thousands.
  #
  # verify-server.sh reads the same file to decide what to ask for, and the
  # query is deterministic, so the two always agree on the sample.
  SAMPLE_SQL="$APP_DIR/scripts/lib/sample-images.sql"
  if [ -f "$SAMPLE_SQL" ]; then
    # `|| true` because grep exits 1 on no match, which under set -e failed the
    # whole restore on a server that simply has no images yet. npuh is empty
    # and every run of it died here.
    SAMPLE="$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
              -F'|' -A -t -f /dev/stdin < "$SAMPLE_SQL" 2>/dev/null | grep '|' || true)"
    n_ok=0
    n_miss=0
    # Every `docker compose exec -T` in here reads stdin, which would swallow
    # the rest of the loop's input. Without the redirects this fetched exactly
    # one image and reported success.
    while IFS='|' read -r reason uuid raw thumb; do
      [ -n "$raw" ] || continue
      if docker compose exec -T minio mc cp --quiet \
           "$SRC_PREFIX/minio/raw-images/$raw" "local/raw-images/$raw" \
           > /dev/null 2>&1 < /dev/null; then
        n_ok=$((n_ok + 1))
      else
        n_miss=$((n_miss + 1))
      fi
      if [ -n "$thumb" ]; then
        docker compose exec -T minio mc cp --quiet \
          "$SRC_PREFIX/minio/thumbnails/$thumb" "local/thumbnails/$thumb" \
          > /dev/null 2>&1 < /dev/null || true
      fi
    done <<< "$SAMPLE"
    log "Sample images fetched: $n_ok present, $n_miss missing from the backup"
  else
    log "No $SAMPLE_SQL, skipping the image sample"
  fi
else
  # ---- MinIO buckets ----
  for BUCKET in raw-images crops thumbnails project-images project-documents models; do
    mirror_if_present "minio/$BUCKET" "$SRC_PREFIX/minio/$BUCKET" "local/$BUCKET"
  done
  log "All MinIO buckets restored"

  # ---- Host image dirs ----
  for HOST_DIR in project-images reference-images; do
    mirror_if_present "host/$HOST_DIR" "$SRC_PREFIX/$HOST_DIR" "/host/$HOST_DIR"
  done
  log "Host image dirs restored"
fi

# ---- final ----
log "Restarting api to pick up the fresh DB state"
docker compose restart api > /dev/null

log "Restore complete in $(( $(date +%s) - START_EPOCH ))s"
log ""
log "Next steps:"
if [ "$DB_ONLY" = "true" ]; then
  log "  1. Database only. Images will not load, that is expected here."
  log "  2. Run: bash scripts/verify-server.sh"
else
  log "  1. Open the UI and log in with a user from the restored DB."
  log "  2. Spot-check: open a project, a camera, a recent image."
fi
log ""
log "The nightly backup cron resumes automatically once the .fresh-server"
log "marker turns 24 h old. No manual toggle needed."
