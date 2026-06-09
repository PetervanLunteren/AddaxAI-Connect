#!/bin/bash
# Update database with Alembic migrations and backfill data
# This script applies migrations and populates derived tables (e.g. deployment periods).
# Safe to run multiple times. For development: generate migrations locally, commit them, then deploy.

set -e

echo "Building API service with shared library..."
docker compose build --no-cache api

# Check if migration files exist
VERSIONS_DIR="services/api/alembic/versions"
MIGRATION_COUNT=$(find "$VERSIONS_DIR" -name "*.py" ! -name "__init__.py" 2>/dev/null | wc -l)

if [ "$MIGRATION_COUNT" -eq 0 ]; then
    echo ""
    echo "⚠️  No migration files found in $VERSIONS_DIR"
    echo "This appears to be a development environment."
    echo ""
    echo "Generating initial migration..."
    # Mount the alembic/versions directory so the migration file persists to the host
    docker compose run --rm -v "$(pwd)/services/api/alembic/versions:/app/alembic/versions" api alembic revision --autogenerate -m "Initial schema with images, cameras, detections, classifications, users"
    echo ""
    echo "⚠️  IMPORTANT: Commit this migration file to git before deploying to production!"
else
    echo ""
    echo "Found $MIGRATION_COUNT migration file(s) in $VERSIONS_DIR"
    echo "Using existing migrations from version control..."
fi

echo ""
echo "Applying migrations..."
# Mount the alembic/versions directory so migration files are accessible
docker compose run --rm -v "$(pwd)/services/api/alembic/versions:/app/alembic/versions" api alembic upgrade head

echo ""
echo "✅ Database initialized! Checking tables..."
docker exec addaxai-postgres psql -U addaxai -d addaxai_connect -c '\dt'

echo ""
echo "Backfilling deployment periods from image GPS data..."
docker compose exec -T api python /app/scripts/backfill_deployment_periods.py

echo ""
echo "Backfilling sites from deployments and linking images to deployments..."
# Must run after the deployment backfill, since sites are clustered from
# deployment rows. Idempotent: deployments that already have a site are left
# untouched, so this is safe on every update.
docker compose exec -T api python /app/scripts/backfill_sites.py

echo ""
echo "Cleaning up empty deployment debris..."
# Removes closed, zero-image deployments left by the pre-fix ingestion bug
# (daily reports with GPS but no photo opened a deployment that closed before
# any image landed). Conservative: only deletes deployments nothing references,
# so a healthy server finds nothing to remove. Runs last, after sites are built.
docker compose exec -T api python /app/scripts/cleanup_empty_deployments.py

echo ""
echo "Merging contiguous same-site deployments left by old GPS splits..."
# Collapses a camera's adjacent same-site deployments that have no real gap (the
# (0,0) split also cut one real placement into a before/after pair). Conservative
# and idempotent: a genuine remove-and-redeploy has a multi-day gap and is never
# merged, so a healthy server merges nothing.
docker compose exec -T api python /app/scripts/merge_contiguous_deployments.py

echo ""
echo "Done! If you see this line, all migrations have been applied successfully without errors."
