#!/bin/bash
# Run the database tests (tests/db_ingestion, tests/db_api) against a
# throwaway PostGIS, the same image production runs.
#
#   bash scripts/test-db.sh            start the database, migrate, run, stop it
#   bash scripts/test-db.sh -k move    extra arguments go to pytest
#   KEEP_DB=1 bash scripts/test-db.sh  leave the database running afterwards
#   PYTHON=/path/to/python bash scripts/test-db.sh
#
# Needs Docker. Python needs the api requirements and shared/ installed, as
# for tests/api. CI runs the same in the db job of .github/workflows/tests.yml.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"
NAME=addaxai-test-db
PORT="${TEST_DB_PORT:-55432}"

export DEPLOYMENT_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/deployment_tests"
export PYTHONWARNINGS=ignore

cleanup() {
    if [ -z "${KEEP_DB:-}" ]; then
        docker rm -f "$NAME" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "${PORT}:5432" \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=deployment_tests \
    postgis/postgis:15-3.3 >/dev/null

# The image runs its init scripts on a temporary server and then restarts
# Postgres, so wait for the end of init before the first real query.
ready=""
for _ in $(seq 1 120); do
    if docker logs "$NAME" 2>&1 | grep -q "PostgreSQL init process complete" \
        && docker exec "$NAME" psql -U postgres -d deployment_tests -Atc "SELECT postgis_version()" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 1
done
[ -n "$ready" ] || { echo "PostGIS did not come up"; exit 1; }

cd "$REPO"
bash scripts/test-db-run.sh "$PY" "$@"
