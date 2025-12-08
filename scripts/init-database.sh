#!/bin/bash
# Initialize database with Alembic migrations
# Run this on the VM after deploying

set -e

echo "Building API service with shared library..."
docker compose build api

echo ""
echo "Creating initial migration..."
# Mount the alembic/versions directory so the migration file persists to the host
docker compose run --rm -v "$(pwd)/services/api/alembic/versions:/app/alembic/versions" api alembic revision --autogenerate -m "Initial schema with images, cameras, detections, classifications, users"

echo ""
echo "Applying migrations..."
docker compose run --rm api alembic upgrade head

echo ""
echo "✅ Database initialized! Checking tables..."
docker exec -it addaxai-postgres psql -U addaxai -d addaxai_connect -c '\dt'

echo ""
echo "🎉 Done! Your database is ready."
