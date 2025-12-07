#!/bin/bash
# Create initial database migration
# Run this inside the API Docker container on the VM

set -e

cd /app

echo "Installing shared library..."
pip install -e /app/../../shared

echo "Creating initial migration..."
alembic revision --autogenerate -m "Initial schema with images, cameras, detections, classifications, users"

echo "Migration created! Check services/api/alembic/versions/ for the new file."
