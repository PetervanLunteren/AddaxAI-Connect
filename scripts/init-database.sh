#!/bin/bash
# Initialize database with Alembic migrations
# This script applies existing migrations from version control to the database.
# For development: Generate migrations locally, commit them, then deploy.

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
echo "Done! If you see this line, all migrations have been applied successfully without errors."
