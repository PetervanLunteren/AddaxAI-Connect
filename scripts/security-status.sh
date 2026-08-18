#!/bin/bash
# Daily security check, published to Redis.
#
# Runs the same /usr/local/bin/security-check.sh that ansible runs at the end
# of a deploy, and writes the result where the notifications worker can read
# it. That worker mails every server admin when the result is a failure. One
# definition of a secure server, checked on every deploy and once a day in
# between.
#
# Must run as root. security-check.sh shells out to sudo, and without a
# terminal sudo cannot prompt, so every sudo-backed check reports a failure
# that is not real.
#
# No TTL on the key on purpose. A missing key means this cron has never run,
# which is a server that has not had the ansible playbook applied yet, not an
# insecure one. The reader stays silent for that and judges staleness from the
# timestamp instead, so a cron that dies is still noticed.
#
# Scheduled by ansible at 02:30 UTC. Run manually for testing.

set -uo pipefail

APP_DIR="/opt/addaxai-connect"
CHECK="/usr/local/bin/security-check.sh"
REDIS_KEY="security:last_check"

cd "$APP_DIR"

START_EPOCH="$(date +%s)"
NOW_ISO="$(date -u +'%Y-%m-%dT%H:%M:%S+00:00')"

# Read from .env without `source`, which breaks on values with unquoted
# spaces. Same reason as scripts/backup.sh.
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
REDIS_PASSWORD="$(env_get REDIS_PASSWORD)"

redis_set_status() {
  local payload="$1"
  docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" \
    SET "$REDIS_KEY" "$payload" > /dev/null 2>&1 || true
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

if [ ! -x "$CHECK" ]; then
  redis_set_status "$(printf '{"status":"fail","timestamp":"%s","error":"%s","passed":0,"failed":1,"warnings":0,"duration_s":0}' \
    "$NOW_ISO" "security-check.sh is missing from $CHECK, run the ansible playbook")"
  echo "security-check.sh not found at $CHECK"
  exit 1
fi

OUTPUT="$("$CHECK" 2>&1)"
RC=$?

# The check prints colour codes, strip them before parsing or counting.
PLAIN="$(printf '%s\n' "$OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')"

PASSED="$(printf '%s\n' "$PLAIN" | grep -c '^\[PASS\]')"
FAILED="$(printf '%s\n' "$PLAIN" | grep -c '^\[FAIL\]')"
WARNINGS="$(printf '%s\n' "$PLAIN" | grep -c '^\[WARN\]')"

# Only the failing lines go in the email. Warnings are deliberately left out:
# a pending reboot warns for a day or two every month and mailing about it
# would train everyone to ignore the alert.
FAILURES="$(printf '%s\n' "$PLAIN" | grep '^\[FAIL\]' | sed 's/^\[FAIL\] *//' | paste -sd '; ' -)"

DURATION=$(( $(date +%s) - START_EPOCH ))

if [ "$RC" -eq 0 ]; then
  STATUS="ok"
else
  STATUS="fail"
  [ -n "$FAILURES" ] || FAILURES="the security check exited $RC without naming a failing check"
fi

redis_set_status "$(printf '{"status":"%s","timestamp":"%s","error":"%s","passed":%d,"failed":%d,"warnings":%d,"duration_s":%d}' \
  "$STATUS" "$NOW_ISO" "$(json_escape "$FAILURES")" \
  "$PASSED" "$FAILED" "$WARNINGS" "$DURATION")"

echo "[$NOW_ISO] security check $STATUS (passed=$PASSED failed=$FAILED warnings=$WARNINGS)"
[ "$STATUS" = "ok" ] || printf '%s\n' "$PLAIN" | grep '^\[FAIL\]'
exit 0
