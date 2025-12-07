#!/bin/bash
# Database migration script
# Run this inside the API container on the VM

set -e

echo "Running database migrations..."

# Run migrations
alembic upgrade head

echo "Migrations complete!"
