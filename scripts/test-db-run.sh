#!/bin/bash
# Migrate the test database and run the database tests. Called by
# scripts/test-db.sh locally and by the db job in CI, which starts its own
# PostGIS. Expects DEPLOYMENT_TEST_DATABASE_URL to point at it.
set -euo pipefail

PY="$1"
shift

# shared.config refuses to load without these. Nothing here talks to Redis or
# MinIO, so the values only have to exist. Same values as tests/conftest.py.
export DATABASE_URL="$DEPLOYMENT_TEST_DATABASE_URL"
export REDIS_URL=redis://localhost:6379/0 MINIO_ENDPOINT=localhost:9000
export MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin
export LOG_LEVEL=WARNING LOG_FORMAT=text ENVIRONMENT=test
export JWT_SECRET=test-only-secret DOMAIN_NAME=connect.example.org

echo "Migrating the test database to head"
if ! out=$(cd services/api && PYTHONPATH=../../shared "$PY" -m alembic upgrade head 2>&1); then
    echo "$out"
    echo "Migration failed"
    exit 1
fi

# One pytest run per folder: the ingestion and api services both have a
# top-level `utils`, the same reason CI runs one job per test folder.
status=0
for dir in tests/db_ingestion tests/db_api; do
    echo "Running $dir"
    "$PY" -m pytest "$dir" -q -p no:cacheprovider "$@" || status=1
done
exit $status
