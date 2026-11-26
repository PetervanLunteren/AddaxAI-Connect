#!/bin/bash
# Update database with Alembic migrations and backfill data
# This script applies migrations and populates derived tables (e.g. deployment periods).
# Safe to run multiple times. For development: generate migrations locally, commit them, then deploy.

set -eo pipefail

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

# The app stops while the migrations run. They run in one transaction and take
# exclusive locks on many tables, so a service reading the database at the same
# moment can take its locks in the other order: Postgres then ends the
# migration with a deadlock and the new code runs on the old schema. Seen on
# dev in 2 of 10 restores on 26 Nov 2026, while the workers processed photos.
# Only the stores the migration needs keep running. Photos that arrive in this
# minute wait in uploads/ and ingestion takes them in when it starts again.
# The app stays stopped until the two scripts below are done as well: a photo
# taken in before the carry-over rebuilds its camera from the GPS alone, and
# the hand corrections of before phase 2 are then lost for good.
# Starting everything at the end also does what three restarts did
# before: api builds its connection pool and cached statements on the new
# schema (drenthe served 185 UndefinedColumn errors on 18 Aug 2026 until api
# restarted), bulk-upload recovers interrupted jobs on it (v0.14.0), and
# ingestion takes in waiting uploads on it (drenthe kept 14 on 11 Nov 2026).
APP_SERVICES=$(docker compose ps --services --status running | grep -vxF -e postgres -e redis -e minio || true)
if [ -n "$APP_SERVICES" ]; then
    echo ""
    echo "Stopping the app while the database migrates: $(echo $APP_SERVICES)"
    trap 'echo ""; echo "The update failed. The app is stopped; fix the cause and run this script again."' ERR
    docker compose stop $APP_SERVICES > /dev/null
fi

echo ""
echo "Applying migrations..."
# Mount the alembic/versions directory so migration files are accessible
docker compose run --rm -v "$(pwd)/services/api/alembic/versions:/app/alembic/versions" api alembic upgrade head

echo ""
echo "✅ Database initialized! Checking tables..."
docker exec addaxai-postgres psql -U addaxai -d addaxai_connect -c '\dt'

echo ""
echo "Carrying deployments over to statements (once per server)..."
# Since phase 2 deployments are rebuilt from photo GPS plus statements. History
# that does not follow from the GPS alone (hand corrections, uploads to a site,
# older rules) becomes statements, so no deployment changes. Runs once: it
# records the run in server_settings and does nothing on later updates. The
# four scripts that used to reshape deployments here are gone; they would undo
# what the rebuild makes. The report stays in logs/, also when restore.sh
# runs this script without output.
mkdir -p logs
docker compose run --rm -T api python /app/scripts/carry_over_deployments.py --apply | tee logs/carry-over-deployments.txt

echo ""
echo "Moving legacy camera tags onto their sites..."
# Place-describing tags set back when a camera was the location belong on the
# Site now. Moves each camera's tags to every site it deploys to, then clears
# the camera. Runs last, after sites are final. Idempotent: once moved the tags
# are gone from the camera, so a healthy server moves nothing on the next run.
docker compose run --rm -T api python /app/scripts/backfill_camera_tags_to_sites.py

if [ -n "$APP_SERVICES" ]; then
    echo ""
    echo "Starting the app again..."
    docker compose start $APP_SERVICES > /dev/null
    trap - ERR
fi

echo ""
echo "Done! If you see this line, all migrations have been applied successfully without errors."
