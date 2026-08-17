#!/bin/bash
# Is this server actually working? Mechanical pass/fail, no judgement calls.
#
# Usage:   bash scripts/verify-server.sh [options]
# Example: bash scripts/verify-server.sh
# Example: bash scripts/verify-server.sh --json /tmp/verify.json --since 30m
#
# Options:
#   --json <path>    also write the full result as JSON, for a script or a
#                    later triage session to read
#   --since <dur>    how far back to scan logs for errors (default 10m)
#   --max-errors <n> tolerate up to n ERROR log lines (default 0)
#   --quiet          only print the summary table
#
# Run it on the server, after an update or a restore:
#   cd /opt/addaxai-connect && bash scripts/verify-server.sh
#
# Exit code is 0 only when every check passed, so it works as a gate.
#
# Read-only. It starts nothing, changes nothing, and writes only the file you
# ask for with --json.
#
# Why these checks. A migration that crashes is easy to notice. The dangerous
# update is the one where every container comes up, alembic says head, and a
# dashboard query then dies on a data shape that only exists in production.
# That is why the API smoke test carries most of the weight here: it runs the
# heavy aggregate endpoints against the real data on this server.

set -uo pipefail   # deliberately not -e: every check must run, even after one fails

APP_DIR="${APP_DIR:-/opt/addaxai-connect}"
SINCE="10m"
JSON_OUT=""
MAX_ERRORS=0
QUIET="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --json)        JSON_OUT="$2"; shift 2 ;;
    --since)       SINCE="$2"; shift 2 ;;
    --max-errors)  MAX_ERRORS="$2"; shift 2 ;;
    --quiet)       QUIET="true"; shift ;;
    -h|--help)     sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

cd "$APP_DIR" || { echo "cannot cd to $APP_DIR" >&2; exit 2; }

say()  { [ "$QUIET" = "true" ] || echo "$@"; }
RESULTS=()   # "name|status|detail", collected for the summary and the JSON

record() { RESULTS+=("$1|$2|$3"); }

pass() { record "$1" pass "$2"; say "  PASS  $1${2:+  $2}"; }
fail() { record "$1" fail "$2"; say "  FAIL  $1${2:+  $2}"; }

# One-shot containers that are supposed to be sitting in Exited(0).
ONE_SHOT="minio-init"

say ""
say "Verifying $(grep -E '^DOMAIN_NAME=' .env | cut -d= -f2- 2>/dev/null || echo "$APP_DIR")"
say ""

# ---------------------------------------------------------------- containers
# `docker compose config --services` respects COMPOSE_PROFILES, so this asks
# for the services this server is meant to run rather than a hardcoded list.
EXPECTED="$(docker compose config --services 2>/dev/null | sort)"
if [ -z "$EXPECTED" ]; then
  fail "containers" "docker compose config returned nothing"
else
  bad=""
  while read -r svc; do
    [ -n "$svc" ] || continue
    state="$(docker compose ps -a --format '{{.Service}} {{.State}}' 2>/dev/null \
             | awk -v s="$svc" '$1==s {print $2; exit}')"
    case "$svc" in
      $ONE_SHOT) [ "$state" = "exited" ] || [ "$state" = "running" ] || bad="$bad $svc($state)" ;;
      *)         [ "$state" = "running" ] || bad="$bad $svc(${state:-absent})" ;;
    esac
  done <<< "$EXPECTED"

  n="$(echo "$EXPECTED" | grep -c .)"
  if [ -n "$bad" ]; then
    fail "containers" "not running:$bad"
  else
    pass "containers" "$n up"
  fi
fi

# ------------------------------------------------------------------ database
# Compare the applied revision against the head the code ships. Equal means the
# migrations for this build are fully applied. This catches the silent case
# where the container was rebuilt but the migration step was skipped, and the
# multiple-heads case where alembic upgrade quietly does nothing useful.
# Revision ids here look like 20260812_theft_watch_rules, so match the whole
# token. An earlier version stopped at the first underscore, which compared
# equal for any two revisions sharing a date prefix.
CURRENT="$(docker compose exec -T api alembic current 2>/dev/null \
           | grep -oE '^[0-9a-zA-Z_]+' | sort | tr '\n' ',' | sed 's/,$//')"
HEADS="$(docker compose exec -T api alembic heads 2>/dev/null \
         | grep -oE '^[0-9a-zA-Z_]+' | sort | tr '\n' ',' | sed 's/,$//')"

if [ -z "$HEADS" ]; then
  fail "migrations" "could not read alembic heads"
elif [ -z "$CURRENT" ]; then
  fail "migrations" "database is at no revision, migrations have never run"
elif [ "$CURRENT" != "$HEADS" ]; then
  fail "migrations" "at $CURRENT, head is $HEADS"
else
  case "$HEADS" in
    *,*) fail "migrations" "multiple heads: $HEADS" ;;
    *)   pass "migrations" "at head $HEADS" ;;
  esac
fi

# --------------------------------------------------------------------- token
# Mint a short-lived server-admin token instead of logging in. After a restore
# the users are the source server's, and their passwords are not ours to know.
# This runs inside the api container, so it needs no secret from outside.
TOKEN="$(docker compose exec -T api python -c "
import asyncio, logging
logging.disable(logging.CRITICAL)
from sqlalchemy import select
from shared.database import get_async_session
from shared.models import User
from auth.users import get_jwt_strategy

async def main():
    async for s in get_async_session():
        u = (await s.execute(
            select(User).where(User.is_superuser == True, User.is_active == True).limit(1)
        )).scalar_one_or_none()
        if u:
            print(await get_jwt_strategy().write_token(u))
        return

asyncio.run(main())
" 2>/dev/null | tr -d '[:space:]')"

BASE="https://$(grep -E '^DOMAIN_NAME=' .env | cut -d= -f2-)"

if [ -z "$TOKEN" ]; then
  fail "auth" "could not mint a token, is there an active server admin?"
else
  pass "auth" "token for the API checks"
fi

# -------------------------------------------------------------------- health
if [ -n "$TOKEN" ]; then
  HEALTH="$(curl -s --max-time 30 -H "Authorization: Bearer $TOKEN" "$BASE/api/health/services")"
  UNHEALTHY="$(printf '%s' "$HEALTH" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('PARSE_ERROR'); raise SystemExit
bad = [s['name'] for s in d.get('services', []) if s.get('status') != 'healthy']
print(','.join(bad) if bad else '')
" 2>/dev/null)"
  TOTAL="$(printf '%s' "$HEALTH" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin).get('services', [])))
except Exception: print(0)
" 2>/dev/null)"

  if [ "$UNHEALTHY" = "PARSE_ERROR" ] || [ "$TOTAL" = "0" ]; then
    fail "health" "endpoint did not return a service list"
  elif [ -n "$UNHEALTHY" ]; then
    fail "health" "unhealthy: $UNHEALTHY"
  else
    pass "health" "$TOTAL services healthy"
  fi
fi

# ----------------------------------------------------------------- API smoke
# The heavy read paths, run against whatever data this server holds. These are
# where an update actually breaks: the migration succeeds and then a dashboard
# aggregate dies on a shape the demo data never had.
#
# {p} is replaced with each project id. Endpoints needing a species or a date
# range are left out; they need discovery and add little over these.
ENDPOINTS='
/api/projects
/api/cameras?project_id={p}
/api/cameras/tags?project_id={p}
/api/projects/{p}/sites
/api/projects/{p}/sites/tags
/api/projects/{p}/site-groups
/api/images?project_id={p}&page=1&page_size=20
/api/images/species?project_id={p}
/api/images/tags?project_id={p}
/api/images/validators?project_id={p}
/api/species/available?project_id={p}
/api/statistics/overview?project_id={p}
/api/statistics/species-distribution?project_id={p}
/api/statistics/detection-trend?project_id={p}
/api/statistics/activity-pattern?project_id={p}
/api/statistics/verification-progress?project_id={p}
/api/statistics/trap-effort?project_id={p}
/api/statistics/detection-rate-map?project_id={p}
/api/statistics/naive-occupancy?project_id={p}
/api/statistics/group-size?project_id={p}
/api/statistics/species-accumulation?project_id={p}
/api/statistics/confidence-distribution?project_id={p}
/api/statistics/demographics?project_id={p}
/api/statistics/images-timeline?project_id={p}
/api/statistics/timeline?project_id={p}
/api/statistics/independence-summary?project_id={p}
/api/statistics/performance?project_id={p}
/api/statistics/pipeline-status
/api/statistics/last-update?project_id={p}
'

API_FAILURES=""
API_OK=0
if [ -n "$TOKEN" ]; then
  PROJECT_IDS="$(curl -s --max-time 30 -H "Authorization: Bearer $TOKEN" "$BASE/api/projects" \
    | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit
items = d if isinstance(d, list) else d.get('items', [])
print('\n'.join(str(p['id']) for p in items))
" 2>/dev/null)"

  NPROJ="$(printf '%s' "$PROJECT_IDS" | grep -c . || true)"
  if [ "${NPROJ:-0}" -eq 0 ]; then
    fail "api" "no projects returned, cannot exercise the read paths"
  else
    while read -r pid; do
      [ -n "$pid" ] || continue
      while read -r ep; do
        [ -n "$ep" ] || continue
        url="$BASE${ep//\{p\}/$pid}"
        code="$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' \
                -H "Authorization: Bearer $TOKEN" "$url")"
        if [ "$code" = "200" ]; then
          API_OK=$((API_OK + 1))
        else
          API_FAILURES="$API_FAILURES ${ep%%\?*}[$code]"
        fi
      done <<< "$(printf '%s' "$ENDPOINTS" | grep .)"
    done <<< "$PROJECT_IDS"

    if [ -n "$API_FAILURES" ]; then
      fail "api" "$API_OK ok, failed:$API_FAILURES"
    else
      pass "api" "$API_OK requests across $NPROJ project(s), all 200"
    fi
  fi
fi

# -------------------------------------------------------------------- images
# Ask the API to actually serve a stratified handful of images. The sample is
# defined once in scripts/lib/sample-images.sql, the same file restore.sh reads
# when it fetches objects for a --db-only run, and the query is deterministic
# so both always pick the same rows.
#
# Scope is deliberately narrow: does it come back 200 and does it decode. Not
# whether the blur is correct, which tests/api/test_full_frame_blur.py already
# covers with real pixel assertions. Two copies of that check would drift.
#
# A missing object is a warning, not a failure. Some rows on these servers
# point at objects removed by an earlier restore, and failing on those forever
# would just train everyone to ignore a red line.
SAMPLE_SQL="$APP_DIR/scripts/lib/sample-images.sql"
IMG_MISSING=0
if [ -n "$TOKEN" ] && [ -f "$SAMPLE_SQL" ]; then
  SAMPLE="$(docker compose exec -T postgres psql \
            -U "$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)" \
            -d "$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)" \
            -F'|' -A -t -f /dev/stdin < "$SAMPLE_SQL" 2>/dev/null | grep '|')"

  IMG_OK=0
  IMG_BAD=""
  while IFS='|' read -r reason uuid raw thumb; do
    [ -n "$uuid" ] || continue
    for kind in thumbnail full; do
      body="$(mktemp)"
      code="$(curl -s -o "$body" --max-time 60 -w '%{http_code}' \
              -H "Authorization: Bearer $TOKEN" "$BASE/api/images/$uuid/$kind")"
      size="$(wc -c < "$body" | tr -d ' ')"
      # JPEG magic. Enough to tell a real image from an error page or a
      # zero-length body, without needing PIL on the host.
      magic="$(head -c 3 "$body" | od -An -tx1 | tr -d ' \n')"
      rm -f "$body"

      if [ "$code" = "404" ]; then
        IMG_MISSING=$((IMG_MISSING + 1))          # object gone from storage
      elif [ "$code" != "200" ]; then
        IMG_BAD="$IMG_BAD $reason/$kind[$code]"
      elif [ "$size" -lt 500 ] || [ "$magic" != "ffd8ff" ]; then
        IMG_BAD="$IMG_BAD $reason/$kind[not-a-jpeg]"
      else
        IMG_OK=$((IMG_OK + 1))
      fi
    done
  done <<< "$SAMPLE"

  n_sample="$(printf '%s' "$SAMPLE" | grep -c . || true)"
  if [ "${n_sample:-0}" -eq 0 ]; then
    pass "images" "no images on this server, nothing to serve"
  elif [ -n "$IMG_BAD" ]; then
    fail "images" "$IMG_OK served, broken:$IMG_BAD${IMG_MISSING:+, $IMG_MISSING missing from storage}"
  else
    pass "images" "$IMG_OK served from a $n_sample image sample${IMG_MISSING:+, $IMG_MISSING missing from storage (warning)}"
  fi
fi

# ---------------------------------------------------------------------- logs
# Structured logs, so this counts real ERROR records rather than any line that
# happens to contain the word.
ERR_COUNT="$(docker compose logs --since "$SINCE" 2>/dev/null \
             | grep -c '"level": "ERROR"' || true)"
ERR_COUNT="${ERR_COUNT:-0}"

if [ "$ERR_COUNT" -gt "$MAX_ERRORS" ]; then
  fail "logs" "$ERR_COUNT error lines in the last $SINCE (allowed $MAX_ERRORS)"
else
  pass "logs" "$ERR_COUNT error lines in the last $SINCE"
fi

# -------------------------------------------------------------------- counts
# Not pass/fail on their own, nothing here knows what the number should be.
# They exist so an update test can compare before and after, where a table
# losing rows is the thing you most want to catch.
COUNTS="$(docker compose exec -T postgres psql -U "$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)" \
  -d "$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)" -tAF',' -c "
SELECT 'users', count(*) FROM users
UNION ALL SELECT 'projects', count(*) FROM projects
UNION ALL SELECT 'cameras', count(*) FROM cameras
UNION ALL SELECT 'sites', count(*) FROM sites
UNION ALL SELECT 'deployments', count(*) FROM deployments
UNION ALL SELECT 'images', count(*) FROM images
UNION ALL SELECT 'detections', count(*) FROM detections
UNION ALL SELECT 'classifications', count(*) FROM classifications
UNION ALL SELECT 'human_observations', count(*) FROM human_observations
ORDER BY 1;" 2>/dev/null | grep -E '^[a-z_]+,[0-9]+$')"

if [ -n "$COUNTS" ]; then
  say ""
  say "  Row counts"
  while IFS=, read -r t n; do say "    $(printf '%-20s %s' "$t" "$n")"; done <<< "$COUNTS"
fi

# ------------------------------------------------------------------- summary
FAILED=0
for r in "${RESULTS[@]}"; do
  [ "$(echo "$r" | cut -d'|' -f2)" = "fail" ] && FAILED=$((FAILED + 1))
done

say ""
if [ "$FAILED" -eq 0 ]; then
  echo "PASS  ${#RESULTS[@]} checks, 0 failed"
else
  echo "FAIL  ${#RESULTS[@]} checks, $FAILED failed"
fi

# ---------------------------------------------------------------------- json
if [ -n "$JSON_OUT" ]; then
  {
    printf '{\n'
    printf '  "domain": "%s",\n' "${BASE#https://}"
    printf '  "checked_at": "%s",\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf '  "failed": %d,\n' "$FAILED"
    printf '  "checks": [\n'
    first=1
    for r in "${RESULTS[@]}"; do
      name="$(echo "$r" | cut -d'|' -f1)"
      status="$(echo "$r" | cut -d'|' -f2)"
      detail="$(echo "$r" | cut -d'|' -f3- | sed 's/\\/\\\\/g; s/"/\\"/g')"
      [ $first -eq 1 ] || printf ',\n'
      printf '    {"name": "%s", "status": "%s", "detail": "%s"}' "$name" "$status" "$detail"
      first=0
    done
    printf '\n  ],\n'
    printf '  "row_counts": {'
    first=1
    while IFS=, read -r t n; do
      [ -n "$t" ] || continue
      [ $first -eq 1 ] || printf ', '
      printf '"%s": %s' "$t" "$n"
      first=0
    done <<< "$COUNTS"
    printf '}\n}\n'
  } > "$JSON_OUT"
  say "  wrote $JSON_OUT"
fi

[ "$FAILED" -eq 0 ]
