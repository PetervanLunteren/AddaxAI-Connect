#!/bin/bash
# Replay this code's update against a production server's real data, on a dev
# server, and say whether it worked.
#
# Usage:   bash scripts/test-update.sh <source-domain> [options]
# Example: bash scripts/test-update.sh lab.addaxai.com
# Example: bash scripts/test-update.sh spw.addaxai.com --full --json /tmp/spw.json
#
# Options:
#   --full         restore the images too (hours, not minutes). Default is
#                  database only, which is what a migration test needs.
#   --json <path>  write the result as JSON for a later triage session
#   --yes          skip the confirmation prompt
#
# What it does, in order:
#   1. refuses to run anywhere but a development server
#   2. records row counts before
#   3. restores the source server's latest backup over this server
#      (restore.sh applies the migrations and backfills as part of that)
#   4. runs verify-server.sh
#   5. prints pass or fail, and exits non-zero on fail
#
# Why no commit-hash argument. The dump carries the source server's schema and
# its alembic_version row, so restoring it puts this box at exactly the
# revision production is on. Running the migrations from the checked-out code
# then reproduces the upgrade production is about to make. Checking out an old
# commit first would only rebuild container images that get thrown away.
#
# DESTRUCTIVE. It replaces this server's database every run.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/addaxai-connect}"
FULL="false"
JSON_OUT=""
ASSUME_YES="false"
SRC_DOMAIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --full)  FULL="true"; shift ;;
    --json)  JSON_OUT="$2"; shift 2 ;;
    --yes|-y) ASSUME_YES="true"; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) SRC_DOMAIN="$1"; shift ;;
  esac
done

cd "$APP_DIR" || { echo "cannot cd to $APP_DIR" >&2; exit 2; }

log()  { echo "[$(date -u +'%H:%M:%S')] $*"; }
die()  { echo "ERROR: $*" >&2; exit 2; }

[ -n "$SRC_DOMAIN" ] || die "source domain required. Usage: bash scripts/test-update.sh <source-domain>"

env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
PG_USER="$(env_get POSTGRES_USER)"
PG_DB="$(env_get POSTGRES_DB)"
THIS_DOMAIN="$(env_get DOMAIN_NAME)"
ENVIRONMENT="$(env_get ENVIRONMENT)"

# ---- refuse to run on anything but a dev server -----------------------------
# This wipes the database. The same setting the notification guard uses, so a
# server that is safe to notify from is a server that is not safe to wipe.
if [ "$ENVIRONMENT" != "development" ]; then
  die "ENVIRONMENT is '$ENVIRONMENT', not 'development'. This script destroys the database and refuses to run outside a dev server."
fi

if [ "$THIS_DOMAIN" = "$SRC_DOMAIN" ]; then
  die "source and target are both $SRC_DOMAIN. Restoring a server over itself is not a test."
fi

log "Target : $THIS_DOMAIN (development)"
log "Source : $SRC_DOMAIN (latest backup)"
log "Scope  : $([ "$FULL" = "true" ] && echo 'database and images' || echo 'database only')"
log "Code   : $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo ""

if [ "$ASSUME_YES" != "true" ]; then
  printf "This replaces %s's database with %s's data. Continue? [y/N] " "$THIS_DOMAIN" "$SRC_DOMAIN"
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "aborted"; exit 2 ;; esac
fi

START="$(date +%s)"

# ---- counts before ----------------------------------------------------------
# The restore replaces these wholesale, so "before" is the previous test's
# data, not a baseline to diff against. It is recorded so a run that ends with
# an empty database is obvious rather than quietly passing.
counts() {
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAF',' -c "
    SELECT 'images', count(*) FROM images
    UNION ALL SELECT 'detections', count(*) FROM detections
    UNION ALL SELECT 'classifications', count(*) FROM classifications
    UNION ALL SELECT 'human_observations', count(*) FROM human_observations
    UNION ALL SELECT 'cameras', count(*) FROM cameras
    UNION ALL SELECT 'projects', count(*) FROM projects
    ORDER BY 1;" 2>/dev/null | grep -E '^[a-z_]+,[0-9]+$'
}
BEFORE="$(counts)"

# ---- the actual test --------------------------------------------------------
RESTORE_LOG="/tmp/test-update-restore-$$.log"
RESTORE_ARGS=("$SRC_DOMAIN" "--force")
[ "$FULL" = "true" ] || RESTORE_ARGS+=("--db-only")

log "Restoring and migrating (this is the part that can fail)"
if bash scripts/restore.sh "${RESTORE_ARGS[@]}" > "$RESTORE_LOG" 2>&1; then
  RESTORE_STATUS="pass"
  log "  restore and migrations OK"
else
  RESTORE_STATUS="fail"
  log "  restore or migrations FAILED, last lines:"
  tail -15 "$RESTORE_LOG" | sed 's/^/      /'
fi

# Only meaningful when the restore actually landed. After a failed restore the
# database still holds whatever the previous run left, and reporting that
# against this dataset reads as though it had that much data.
if [ "$RESTORE_STATUS" = "pass" ]; then
  AFTER="$(counts)"
else
  AFTER=""
fi

# ---- verify -----------------------------------------------------------------
VERIFY_JSON="/tmp/test-update-verify-$$.json"
VERIFY_STATUS="skipped"
if [ "$RESTORE_STATUS" = "pass" ]; then
  log "Verifying the server"
  # A fresh restore means the workers have just reconnected, so only look at
  # errors from this run rather than whatever was in the log before.
  if bash scripts/verify-server.sh --json "$VERIFY_JSON" --since "$(( ($(date +%s) - START) / 60 + 1 ))m" --quiet > /dev/null 2>&1; then
    VERIFY_STATUS="pass"
  else
    VERIFY_STATUS="fail"
  fi
  [ -f "$VERIFY_JSON" ] && grep -oE '"name": "[a-z]+", "status": "(pass|fail)"' "$VERIFY_JSON" \
    | sed 's/"name": "//; s/", "status": "/  /; s/"$//' | sed 's/^/      /'
fi

ELAPSED=$(( $(date +%s) - START ))

# ---- report -----------------------------------------------------------------
if [ -n "$AFTER" ]; then
  echo ""
  echo "  Row counts after restore"
  while IFS=, read -r t n; do
    [ -n "$t" ] || continue
    b="$(printf '%s' "$BEFORE" | awk -F, -v k="$t" '$1==k{print $2}')"
    printf '    %-20s %-10s (was %s)\n' "$t" "$n" "${b:-?}"
  done <<< "$AFTER"
fi

echo ""
if [ "$RESTORE_STATUS" = "pass" ] && [ "$VERIFY_STATUS" = "pass" ]; then
  OVERALL="pass"
  echo "PASS  $SRC_DOMAIN  in ${ELAPSED}s"
else
  OVERALL="fail"
  echo "FAIL  $SRC_DOMAIN  in ${ELAPSED}s  (restore: $RESTORE_STATUS, verify: $VERIFY_STATUS)"
  echo "      restore log: $RESTORE_LOG"
  [ -f "$VERIFY_JSON" ] && echo "      verify json: $VERIFY_JSON"
fi

if [ -n "$JSON_OUT" ]; then
  {
    printf '{\n'
    printf '  "source": "%s",\n' "$SRC_DOMAIN"
    printf '  "target": "%s",\n' "$THIS_DOMAIN"
    printf '  "commit": "%s",\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    printf '  "scope": "%s",\n' "$([ "$FULL" = "true" ] && echo full || echo db-only)"
    printf '  "finished_at": "%s",\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf '  "seconds": %d,\n' "$ELAPSED"
    printf '  "restore": "%s",\n' "$RESTORE_STATUS"
    printf '  "verify": "%s",\n' "$VERIFY_STATUS"
    printf '  "result": "%s",\n' "$OVERALL"
    printf '  "restore_log": "%s",\n' "$RESTORE_LOG"
    # Embed what verify-server.sh found. Without this a failed dataset says
    # only "verify: fail" and triage means hunting for a temp file, which is
    # exactly what happened the first time a dataset failed here.
    printf '  "verify_checks": '
    if [ -f "$VERIFY_JSON" ]; then
      python3 -c "
import json,sys
try:
    d = json.load(open('$VERIFY_JSON'))
    print(json.dumps(d.get('checks', [])))
except Exception:
    print('[]')
" 2>/dev/null || printf '[]'
    else
      printf '[]'
    fi
    printf ',\n'
    printf '  "row_counts": {'
    first=1
    while IFS=, read -r t n; do
      [ -n "$t" ] || continue
      [ $first -eq 1 ] || printf ', '
      printf '"%s": %s' "$t" "$n"; first=0
    done <<< "$AFTER"
    printf '}\n}\n'
  } > "$JSON_OUT"
  echo "      wrote $JSON_OUT"
fi

[ "$OVERALL" = "pass" ]
