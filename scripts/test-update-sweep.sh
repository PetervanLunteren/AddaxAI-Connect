#!/bin/bash
# Run the update test against several production datasets in turn, and print
# one table saying which passed.
#
# Usage:   bash scripts/test-update-sweep.sh <domain> [<domain> ...] [options]
# Example: bash scripts/test-update-sweep.sh lab.example.com spw.example.com
#
# Options:
#   --full          restore images too, hours rather than minutes
#   --results <dir> keep the per-server JSON (default /tmp/sweep-<date>)
#
# Run it on the dev server. Each dataset is restored over this server's
# database in turn, so they cannot overlap and this is deliberately serial.
# Budget roughly three minutes per dataset for a database-only run.
#
# A failure does not stop the sweep. The point is to learn which datasets
# break, not to stop at the first one, so every server is always attempted and
# the table is always complete.
#
# Exit code is 0 only when every dataset passed.
#
# DESTRUCTIVE. Replaces this server's database once per dataset. The last
# dataset in the list is what stays on the box afterwards, which is worth
# choosing on purpose if you plan to poke at the result.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/addaxai-connect}"
RESULTS_DIR=""
PASSTHRU=()
DOMAINS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --full)    PASSTHRU+=("--full"); shift ;;
    --results) RESULTS_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) DOMAINS+=("$1"); shift ;;
  esac
done

if [ "${#DOMAINS[@]}" -eq 0 ]; then
  echo "No source domains given."
  echo "Usage: bash scripts/test-update-sweep.sh <domain> [<domain> ...]"
  echo "Pass the domain_name of each server whose backup you want to test against."
  exit 2
fi

cd "$APP_DIR" || { echo "cannot cd to $APP_DIR" >&2; exit 2; }

# Fail here rather than once per dataset. test-update.sh checks this too, but
# discovering it after the first restore would be a slow way to find out.
ENVIRONMENT="$(grep -E '^ENVIRONMENT=' .env | head -1 | cut -d= -f2-)"
if [ "$ENVIRONMENT" != "development" ]; then
  echo "ERROR: ENVIRONMENT is '$ENVIRONMENT', not 'development'." >&2
  echo "This sweep destroys the database and refuses to run outside a dev server." >&2
  exit 2
fi

RESULTS_DIR="${RESULTS_DIR:-/tmp/sweep-$(date -u +%Y%m%d-%H%M%S)}"
mkdir -p "$RESULTS_DIR"

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
START="$(date +%s)"

echo ""
echo "Testing commit $COMMIT against ${#DOMAINS[@]} dataset(s)"
echo "Results in $RESULTS_DIR"
echo ""

for d in "${DOMAINS[@]}"; do
  printf '  %-28s ' "$d"
  if bash scripts/test-update.sh "$d" --yes --json "$RESULTS_DIR/${d%%.*}.json" \
       "${PASSTHRU[@]+"${PASSTHRU[@]}"}" > "$RESULTS_DIR/${d%%.*}.log" 2>&1; then
    echo "pass"
  else
    echo "FAIL   see $RESULTS_DIR/${d%%.*}.log"
  fi
done

# ---- the table --------------------------------------------------------------
# Built from the JSON each run wrote, so it reports what actually happened
# rather than what this loop believes happened.
echo ""
python3 - "$RESULTS_DIR" "${DOMAINS[@]}" <<'PY'
import json, os, sys

results_dir, domains = sys.argv[1], sys.argv[2:]
rows, failed = [], 0

for d in domains:
    path = os.path.join(results_dir, d.split('.')[0] + '.json')
    try:
        with open(path) as fh:
            r = json.load(fh)
    except Exception:
        # No JSON means the run died before it could write one, which is
        # itself a failure and must not be silently dropped from the table.
        rows.append((d, 'FAIL', '?', '?', '?', 'no result file'))
        failed += 1
        continue
    counts = r.get('row_counts', {})
    ok = r.get('result') == 'pass'
    if not ok:
        failed += 1
    # A failed restore leaves the previous dataset's rows in place, so
    # test-update.sh omits the counts rather than reporting someone else's.
    img = f"{counts['images']:,}" if isinstance(counts.get('images'), int) else '-'
    cam = str(counts['cameras']) if isinstance(counts.get('cameras'), int) else '-'
    rows.append((
        d,
        'pass' if ok else 'FAIL',
        f"{r.get('seconds','?')}s",
        img,
        cam,
        '' if ok else f"restore={r.get('restore')} verify={r.get('verify')}",
    ))

w = max(len(r[0]) for r in rows)
print(f"  {'dataset'.ljust(w)}  {'result':6}  {'time':>6}  {'images':>8}  {'cams':>5}  note")
print(f"  {'-'*w}  {'-'*6}  {'-'*6}  {'-'*8}  {'-'*5}  ----")
for d, res, t, img, cam, note in rows:
    print(f"  {d.ljust(w)}  {res:6}  {t:>6}  {img:>8}  {cam:>5}  {note}")

print()
print(f"  {len(rows) - failed}/{len(rows)} passed")
sys.exit(1 if failed else 0)
PY
TABLE_STATUS=$?

echo ""
echo "Elapsed $(( ($(date +%s) - START) / 60 ))m. Datasets left on this server: ${DOMAINS[-1]}"
[ "$TABLE_STATUS" -eq 0 ]
