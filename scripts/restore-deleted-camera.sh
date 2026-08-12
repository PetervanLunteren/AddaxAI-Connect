#!/bin/bash
# Restore one accidentally deleted camera and all its data from a nightly backup.
#
# When a camera is deleted in the UI, the cascade removes the camera row, its
# deployments, health reports, images, detections, classifications, human
# observations, and feed events, and the object files are removed from local
# storage. The next nightly mirror then also removes the files from the backup
# bucket, but bucket versioning keeps them as noncurrent versions for the
# retention window. This script puts all of it back:
#
#   1. Loads the postgres dump of the given date into a scratch database.
#   2. Extracts every row that belonged to the camera.
#   3. Preflight-checks the live database (schema match, no id collisions,
#      referenced sites/users/project still exist).
#   4. With --apply: inserts all rows in one transaction, re-links nulled
#      rejection rows, fixes sequences, and copies the image files back from
#      their noncurrent versions in the backup bucket.
#
# Without --apply the script is a dry run: it extracts, checks, and prints the
# plan, but writes nothing to the live database or storage. The scratch
# database and CSV exports are left in place for inspection.
#
# Usage:   bash scripts/restore-deleted-camera.sh <source-domain> <dump-date> <device-id> [--apply]
# Example: bash scripts/restore-deleted-camera.sh lab.addaxai.com 2026-08-11 861943070031629
#
# Pre-reqs:
#   - .env has BACKUP_ENDPOINT, BACKUP_BUCKET, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY
#   - docker compose stack is running
#   - the running code version matches the schema of the dump (the script
#     verifies this per table and refuses on mismatch)

set -euo pipefail

APP_DIR="/opt/addaxai-connect"
SCRATCH_DB="camera_restore_scratch"
LOG_PREFIX() { date -u +'%Y-%m-%d %H:%M:%S UTC'; }
log()  { echo "[$(LOG_PREFIX)] $*"; }
die()  { echo "[$(LOG_PREFIX)] ERROR: $*" >&2; exit 1; }

on_error() {
  local line=$1
  die "restore failed at line $line (scratch DB and workdir kept for inspection)"
}
trap 'on_error $LINENO' ERR

cd "$APP_DIR"

# ---- argument parsing ----
SRC_DOMAIN=""
DUMP_DATE=""
DEVICE_ID=""
APPLY="false"
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY="true" ;;
    *)
      if [ -z "$SRC_DOMAIN" ]; then SRC_DOMAIN="$arg"
      elif [ -z "$DUMP_DATE" ]; then DUMP_DATE="$arg"
      elif [ -z "$DEVICE_ID" ]; then DEVICE_ID="$arg"
      fi
      ;;
  esac
done
[ -n "$SRC_DOMAIN" ] && [ -n "$DUMP_DATE" ] && [ -n "$DEVICE_ID" ] \
  || die "usage: bash scripts/restore-deleted-camera.sh <source-domain> <dump-date> <device-id> [--apply]"

WORKDIR="/tmp/camera-restore-$DEVICE_ID"
mkdir -p "$WORKDIR"

# ---- load env vars ----
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

# psql shorthands. Live DB and scratch DB, both inside the postgres container.
psql_live()    { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -v ON_ERROR_STOP=1 "$@"; }
psql_scratch() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$SCRATCH_DB" -tAq -v ON_ERROR_STOP=1 "$@"; }

# ---- mc aliases ----
docker compose exec -T minio mc alias set backup-target \
  "$BACKUP_ENDPOINT" "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY" > /dev/null
docker compose exec -T minio mc alias set local \
  "http://localhost:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null

SRC_PREFIX="backup-target/$BACKUP_BUCKET/$SRC_DOMAIN"

# ---- step 1: load the dump into a scratch database ----
log "Checking dump $DUMP_DATE.sql.gz exists in the backup"
docker compose exec -T minio mc stat "$SRC_PREFIX/postgres/$DUMP_DATE.sql.gz" > /dev/null \
  || die "dump $DUMP_DATE.sql.gz not found under $SRC_PREFIX/postgres/"

log "Loading dump into scratch database $SCRATCH_DB"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" \
  -c "CREATE DATABASE $SCRATCH_DB;"
docker compose exec -T minio mc cat "$SRC_PREFIX/postgres/$DUMP_DATE.sql.gz" \
  | gunzip \
  | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$SCRATCH_DB" \
      --single-transaction --quiet -v ON_ERROR_STOP=1 > /dev/null
log "Scratch database loaded"

# ---- step 2: resolve the camera and extract its rows ----
CAMERA_ID="$(psql_scratch -c "SELECT id FROM cameras WHERE device_id = '$DEVICE_ID'")"
[ -n "$CAMERA_ID" ] || die "no camera with device_id $DEVICE_ID in the $DUMP_DATE dump"
PROJECT_ID="$(psql_scratch -c "SELECT project_id FROM cameras WHERE id = $CAMERA_ID")"
log "Camera found in dump: id=$CAMERA_ID device_id=$DEVICE_ID project_id=$PROJECT_ID"

# Tables in FK insert order, with the WHERE clause that selects the camera's rows.
TABLES=(cameras deployments images camera_health_reports detections classifications human_observations feed_events)
where_clause() {
  case "$1" in
    cameras)               echo "id = $CAMERA_ID" ;;
    deployments)           echo "camera_id = $CAMERA_ID" ;;
    images)                echo "camera_id = $CAMERA_ID" ;;
    camera_health_reports) echo "camera_id = $CAMERA_ID" ;;
    detections)            echo "image_id IN (SELECT id FROM images WHERE camera_id = $CAMERA_ID)" ;;
    classifications)       echo "detection_id IN (SELECT d.id FROM detections d JOIN images i ON i.id = d.image_id WHERE i.camera_id = $CAMERA_ID)" ;;
    human_observations)    echo "image_id IN (SELECT id FROM images WHERE camera_id = $CAMERA_ID)" ;;
    feed_events)           echo "camera_id = $CAMERA_ID" ;;
  esac
}
collist() {
  # Ordered, quoted column list of a table, from the given database.
  local db_fn="$1" table="$2"
  "$db_fn" -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='$table'"
}

log "Extracting rows to $WORKDIR"
for t in "${TABLES[@]}"; do
  COLS="$(collist psql_scratch "$t")"
  echo "$COLS" > "$WORKDIR/$t.cols"
  psql_scratch -c "COPY (SELECT $COLS FROM $t WHERE $(where_clause "$t")) TO STDOUT" > "$WORKDIR/$t.tsv"
  psql_scratch -c "COPY (SELECT id FROM $t WHERE $(where_clause "$t")) TO STDOUT" > "$WORKDIR/$t.ids"
  log "  $t: $(wc -l < "$WORKDIR/$t.tsv") rows"
done

# Object keys the restored rows will reference.
psql_scratch -c "COPY (SELECT storage_path FROM images WHERE camera_id = $CAMERA_ID) TO STDOUT" > "$WORKDIR/raw.keys"
psql_scratch -c "COPY (SELECT thumbnail_path FROM images WHERE camera_id = $CAMERA_ID AND thumbnail_path IS NOT NULL) TO STDOUT" > "$WORKDIR/thumbnails.keys"

# ---- step 3: preflight against the live database ----
log "Preflight checks against the live database"
FAILED="false"
fail() { echo "  FAIL: $*"; FAILED="true"; }
ok()   { echo "  ok:   $*"; }

# Schema of the live DB must match the dump, per table, or the insert is wrong.
for t in "${TABLES[@]}"; do
  LIVE_COLS="$(collist psql_live "$t")"
  if [ "$LIVE_COLS" != "$(cat "$WORKDIR/$t.cols")" ]; then
    fail "live schema of $t differs from the dump (code version mismatch?)"
  fi
done
ok "live schema matches the dump for all ${#TABLES[@]} tables"

# The camera must be gone, and the project still there.
[ "$(psql_live -c "SELECT count(*) FROM cameras WHERE id = $CAMERA_ID OR device_id = '$DEVICE_ID'")" = "0" ] \
  && ok "camera id/device_id free in live DB" \
  || fail "camera id $CAMERA_ID or device_id $DEVICE_ID already exists in live DB (was it re-registered? that needs a remap, not this script)"
[ "$(psql_live -c "SELECT count(*) FROM projects WHERE id = $PROJECT_ID")" = "1" ] \
  && ok "project $PROJECT_ID exists" \
  || fail "project $PROJECT_ID does not exist in live DB"

# No primary key collisions in any table.
for t in "${TABLES[@]}"; do
  if [ -s "$WORKDIR/$t.ids" ]; then
    IDS="$(paste -sd, "$WORKDIR/$t.ids")"
    N="$(psql_live -c "SELECT count(*) FROM $t WHERE id IN ($IDS)")"
    [ "$N" = "0" ] && ok "$t: no id collisions" || fail "$t: $N of the ids to restore already exist in live DB"
  fi
done

# Referenced sites and users must exist in the live DB.
check_refs() {
  local label="$1" sql="$2" target="$3"
  local refs missing
  refs="$(psql_scratch -c "$sql" | paste -sd, || true)"
  [ -n "$refs" ] || { ok "$label: none referenced"; return; }
  missing="$(psql_live -c "SELECT count(*) FROM unnest(ARRAY[$refs]) AS r(id) WHERE NOT EXISTS (SELECT 1 FROM $target t WHERE t.id = r.id)")"
  [ "$missing" = "0" ] && ok "$label: all present in live DB" || fail "$label: $missing referenced rows missing in live DB"
}
check_refs "sites referenced by deployments/feed_events" \
  "SELECT DISTINCT site_id FROM (SELECT site_id FROM deployments WHERE camera_id = $CAMERA_ID UNION SELECT site_id FROM feed_events WHERE camera_id = $CAMERA_ID UNION SELECT from_site_id FROM feed_events WHERE camera_id = $CAMERA_ID) s WHERE site_id IS NOT NULL" \
  "sites"
check_refs "users referenced by restored rows" \
  "SELECT DISTINCT u FROM (
     SELECT verified_by_user_id AS u FROM images WHERE camera_id = $CAMERA_ID
     UNION SELECT liked_by_user_id FROM images WHERE camera_id = $CAMERA_ID
     UNION SELECT needs_review_by_user_id FROM images WHERE camera_id = $CAMERA_ID
     UNION SELECT created_by_user_id FROM human_observations WHERE image_id IN (SELECT id FROM images WHERE camera_id = $CAMERA_ID)
     UNION SELECT updated_by_user_id FROM human_observations WHERE image_id IN (SELECT id FROM images WHERE camera_id = $CAMERA_ID)
     UNION SELECT resolved_by_user_id FROM feed_events WHERE camera_id = $CAMERA_ID
   ) x WHERE u IS NOT NULL" \
  "users"

# ---- step 4: find restorable object versions in the backup bucket ----
# The nightly mirror removed the objects after the deletion, so each one is a
# delete marker on top of a real noncurrent version. Pick the newest real
# version per key.
log "Listing object versions in the backup bucket"
for bucket in raw-images thumbnails; do
  docker compose exec -T minio mc ls --versions --recursive --json \
    "$SRC_PREFIX/minio/$bucket/$DEVICE_ID/" 2>/dev/null > "$WORKDIR/$bucket.versions.json" || true
  python3 - "$WORKDIR/$bucket.versions.json" "$DEVICE_ID" > "$WORKDIR/$bucket.restore" <<'PYEOF'
import json, sys

path, device = sys.argv[1], sys.argv[2]
versions = {}  # key -> list of (lastModified, versionId, isDeleteMarker)
for line in open(path):
    line = line.strip()
    if not line:
        continue
    o = json.loads(line)
    key, vid = o.get("key"), o.get("versionId")
    if not key or not vid or o.get("type") == "folder":
        continue
    # mc may list keys relative to the given prefix; normalize to full
    # bucket-relative keys so they match the DB's storage paths.
    if not key.startswith(device + "/"):
        key = device + "/" + key.lstrip("/")
    versions.setdefault(key, []).append(
        (o.get("lastModified", ""), vid, bool(o.get("isDeleteMarker", False)))
    )

for key in sorted(versions):
    # newest real (non-delete-marker) version wins
    real = [v for v in sorted(versions[key], reverse=True) if not v[2]]
    if real:
        print(f"{real[0][1]}\t{key}")
PYEOF
  log "  $bucket: $(wc -l < "$WORKDIR/$bucket.restore") restorable objects"
done

# Compare against what the DB rows reference.
for pair in "raw-images:raw.keys" "thumbnails:thumbnails.keys"; do
  bucket="${pair%%:*}"; keys="${pair##*:}"
  # keys in file are full object keys ("<device>/...") matching the mc listing keys
  MISSING="$(comm -23 <(sort "$WORKDIR/$keys") <(cut -f2 "$WORKDIR/$bucket.restore" | sort) | wc -l | tr -d ' ')"
  ORPHANS="$(comm -13 <(sort "$WORKDIR/$keys") <(cut -f2 "$WORKDIR/$bucket.restore" | sort) | wc -l | tr -d ' ')"
  if [ "$MISSING" = "0" ]; then
    ok "$bucket: every DB-referenced object has a restorable version"
  else
    if [ "$bucket" = "thumbnails" ]; then
      ok "$bucket: $MISSING referenced objects have no backup version (thumbnails can be regenerated)"
    else
      fail "$bucket: $MISSING referenced objects have no backup version"
    fi
  fi
  [ "$ORPHANS" = "0" ] || log "  note: $bucket has $ORPHANS versioned objects not referenced by the dump (uploaded after the dump? inspect $WORKDIR/$bucket.restore)"
done

[ "$FAILED" = "false" ] || die "preflight failed, nothing was written"
log "Preflight passed"

# ---- summary / dry-run stop ----
log ""
log "Restore plan:"
log "  source      : $SRC_DOMAIN dump $DUMP_DATE"
log "  camera      : id=$CAMERA_ID device_id=$DEVICE_ID project=$PROJECT_ID"
for t in "${TABLES[@]}"; do
  log "  $(printf '%-22s' "$t"): $(wc -l < "$WORKDIR/$t.tsv" | tr -d ' ') rows"
done
log "  raw images  : $(wc -l < "$WORKDIR/raw-images.restore" | tr -d ' ') objects"
log "  thumbnails  : $(wc -l < "$WORKDIR/thumbnails.restore" | tr -d ' ') objects"
log ""

if [ "$APPLY" != "true" ]; then
  log "Dry run complete. Nothing was written. Re-run with --apply to restore."
  log "Extracted data kept in $WORKDIR, scratch DB $SCRATCH_DB kept for inspection."
  exit 0
fi

# ---- step 5: apply, database first (one transaction) ----
log "APPLY MODE: writing to the live database in 5 seconds. Ctrl-C to abort."
sleep 5

APPLY_SQL="$WORKDIR/apply.sql"
{
  for t in "${TABLES[@]}"; do
    echo "COPY public.$t ($(cat "$WORKDIR/$t.cols")) FROM stdin;"
    cat "$WORKDIR/$t.tsv"
    echo "\\."
  done
  # Rejections created while the camera was deleted keep device_id but were
  # never linked (or were SET NULL on the cascade). Re-link them.
  echo "UPDATE rejections SET camera_id = $CAMERA_ID, project_id = $PROJECT_ID WHERE device_id = '$DEVICE_ID' AND camera_id IS NULL;"
  # Sequences: explicit-id COPY does not advance them. All restored ids are
  # historical so this is normally a no-op, but keep it correct regardless.
  for t in "${TABLES[@]}"; do
    echo "SELECT setval(pg_get_serial_sequence('public.$t','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.$t), COALESCE((SELECT ps.last_value FROM pg_sequences ps WHERE ps.schemaname='public' AND 'public.'||quote_ident(ps.sequencename) = pg_get_serial_sequence('public.$t','id')), 1)));"
  done
} > "$APPLY_SQL"

log "Inserting rows into the live database"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --single-transaction --quiet -v ON_ERROR_STOP=1 < "$APPLY_SQL" > /dev/null
log "Database rows restored"

# ---- step 6: restore object files from their noncurrent versions ----
for bucket in raw-images thumbnails; do
  TOTAL="$(wc -l < "$WORKDIR/$bucket.restore" | tr -d ' ')"
  [ "$TOTAL" = "0" ] && { log "$bucket: nothing to restore"; continue; }
  log "Restoring $TOTAL objects into local/$bucket"
  N=0
  while IFS=$'\t' read -r VID KEY; do
    # </dev/null: docker exec -T must not eat the loop's stdin (the list file)
    docker compose exec -T minio mc cp --quiet --version-id "$VID" \
      "$SRC_PREFIX/minio/$bucket/$KEY" "local/$bucket/$KEY" > /dev/null < /dev/null
    N=$((N+1))
    [ $((N % 50)) -eq 0 ] && log "  $N/$TOTAL"
  done < "$WORKDIR/$bucket.restore"
  log "  $N/$TOTAL done"
done

# ---- step 7: verify ----
log "Verification against the live database"
VERIFY_FAILED="false"
for t in "${TABLES[@]}"; do
  WANT="$(wc -l < "$WORKDIR/$t.tsv" | tr -d ' ')"
  GOT="$(psql_live -c "SELECT count(*) FROM $t WHERE $(where_clause "$t")")"
  if [ "$WANT" = "$GOT" ]; then
    ok "$t: $GOT rows"
  else
    fail "$t: expected $WANT rows, live has $GOT"; VERIFY_FAILED="true"
  fi
done
SAMPLE_KEY="$(head -1 "$WORKDIR/raw.keys" || true)"
if [ -n "$SAMPLE_KEY" ]; then
  docker compose exec -T minio mc stat "local/raw-images/$SAMPLE_KEY" > /dev/null \
    && ok "sample raw object present in local storage" \
    || { fail "sample raw object missing in local storage"; VERIFY_FAILED="true"; }
fi
[ "$VERIFY_FAILED" = "false" ] || die "verification failed, inspect the live DB and $WORKDIR"

# ---- cleanup ----
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $SCRATCH_DB;"
log "Scratch database dropped. Workdir kept at $WORKDIR."
log ""
log "Restore complete."
log "Next steps:"
log "  1. Open the UI: the camera, its images, and statistics should be back."
log "  2. Move any rejected files of this device back into the upload dir to re-ingest them."
log "  3. Thumbnails that had no backup version regenerate via scripts/regenerate_thumbnails.py."
