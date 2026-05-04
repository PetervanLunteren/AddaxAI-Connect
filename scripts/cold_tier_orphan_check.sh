#!/bin/bash
# Identify cold-tier prefixes whose newest object was last modified more
# than N days ago. Useful when several servers share one cold-tier bucket
# and a server gets destroyed without cleaning up its tiered data.
#
# A "prefix" here is the per-server folder at the bucket root, set via
# COLD_TIER_PREFIX in each server's .env (defaults to its domain_name,
# e.g. `pwn.addaxai.com/`). MinIO writes its tiered bodies under that
# prefix using internally-opaque object names.
#
# Heuristic: a live server tiers new objects often enough that its prefix
# has fresh activity. A destroyed server's prefix goes silent. Threshold is
# 14 days by default. Tune via --days.
#
# Caveat: a live server that stays comfortably under its hot budget for
# weeks does nothing, so its prefix can look orphaned. Raise --days, or
# check ssh access to all live servers before running with --delete.
#
# Usage (on a server):
#   bash /opt/addaxai-connect/scripts/cold_tier_orphan_check.sh                # dry-run report
#   bash /opt/addaxai-connect/scripts/cold_tier_orphan_check.sh --days 30      # custom threshold
#   bash /opt/addaxai-connect/scripts/cold_tier_orphan_check.sh --delete       # remove orphans
#
# One-liner from your laptop (no interactive ssh needed):
#   ssh pwn 'cd /opt/addaxai-connect && git pull --ff-only origin main > /dev/null && bash scripts/cold_tier_orphan_check.sh'

# pipefail intentionally off: the per-prefix `sort -r | head -1` pipe gives
# `sort` a SIGPIPE the moment `head` exits, which under pipefail kills the
# whole script silently inside the command substitution.
set -eu

DAYS=14
DELETE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --delete) DELETE=true; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# The script runs `docker compose exec` against the minio container, so it
# only works on a deployed server where the stack is up. Try the standard
# install path first, fall back to the current dir for non-default setups.
if [ -f "/opt/addaxai-connect/.env" ]; then
  cd "/opt/addaxai-connect"
elif [ -f "./.env" ] && [ -f "./docker-compose.yml" ]; then
  :
else
  echo "Run this on a deployed server (a directory with .env and docker-compose.yml)." >&2
  echo "Typical: ssh into the server, cd /opt/addaxai-connect, then run." >&2
  exit 1
fi

env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

BKT=$(env_get COLD_TIER_BUCKET)
ENDPOINT=$(env_get COLD_TIER_ENDPOINT)
ACC=$(env_get COLD_TIER_ACCESS_KEY)
SEC=$(env_get COLD_TIER_SECRET_KEY)

[ -n "$BKT" ] && [ -n "$ENDPOINT" ] && [ -n "$ACC" ] && [ -n "$SEC" ] \
  || { echo "COLD_TIER_* not set in .env"; exit 1; }

docker compose exec -T minio mc alias set wasabi-cold "$ENDPOINT" "$ACC" "$SEC" > /dev/null

NOW_EPOCH=$(date -u +%s)
THRESHOLD_EPOCH=$(( NOW_EPOCH - DAYS * 86400 ))

echo "Cold bucket: $BKT"
echo "Threshold:   ${DAYS} days (cutoff $(date -u -d "@$THRESHOLD_EPOCH" '+%Y-%m-%d %H:%M UTC'))"
echo "Mode:        $([ "$DELETE" = true ] && echo DELETE || echo dry-run)"
echo

PREFIXES=$(docker compose exec -T minio mc ls "wasabi-cold/$BKT/" \
  | awk '{print $NF}' | grep '/$' | tr -d '/')

if [ -z "$PREFIXES" ]; then
  echo "No prefixes in bucket. Nothing to check."
  exit 0
fi

for PFX in $PREFIXES; do
  LATEST=$(docker compose exec -T minio mc ls --recursive "wasabi-cold/$BKT/$PFX/" 2>/dev/null \
    | sort -r | head -1)
  if [ -z "$LATEST" ]; then
    echo "EMPTY  $PFX (no objects)"
    continue
  fi
  LATEST_DATE=$(echo "$LATEST" | awk -F'[][]' '{print $2}')
  LATEST_EPOCH=$(date -u -d "$LATEST_DATE" +%s 2>/dev/null || echo 0)
  AGE_DAYS=$(( (NOW_EPOCH - LATEST_EPOCH) / 86400 ))
  SIZE=$(docker compose exec -T minio mc du "wasabi-cold/$BKT/$PFX/" 2>/dev/null \
    | awk '{print $1, $2}')

  if [ "$LATEST_EPOCH" -lt "$THRESHOLD_EPOCH" ]; then
    echo "ORPHAN $PFX  age=${AGE_DAYS}d  size=$SIZE  latest=$LATEST_DATE"
    if [ "$DELETE" = true ]; then
      docker compose exec -T minio mc rm --recursive --force "wasabi-cold/$BKT/$PFX/" > /dev/null
      echo "       deleted"
    fi
  else
    echo "live   $PFX  age=${AGE_DAYS}d  size=$SIZE  latest=$LATEST_DATE"
  fi
done

if [ "$DELETE" = false ]; then
  echo
  echo "Dry run only. Re-run with --delete to remove the orphans listed above."
fi
