#!/bin/sh
# MinIO bucket + cold-tier initialization.
#
# Reads config from env (set by docker-compose). Idempotent: re-run on every
# deploy. When COLD_TIER_ENABLED=true, registers the remote tier and installs
# the tag-based ILM rules. Recreates the tier registration if bucket or
# endpoint changed since the last run, which lets a Wasabi-bucket swap happen
# fully via ansible (no manual `mc ilm tier rm` step on the server).

set -eu

sleep 10

mc alias set minio http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing minio/raw-images
mc mb --ignore-existing minio/crops
mc mb --ignore-existing minio/thumbnails
mc mb --ignore-existing minio/models
mc mb --ignore-existing minio/project-images
mc mb --ignore-existing minio/project-documents
mc mb --ignore-existing minio/bulk-upload-staging
mc version enable minio/raw-images

if [ "${COLD_TIER_ENABLED:-false}" != "true" ]; then
  echo "Cold tier disabled (COLD_TIER_ENABLED=false)"
  echo "MinIO buckets created successfully"
  exit 0
fi

NAME="${COLD_TIER_NAME:-WASABI_COLD}"
REGION="${COLD_TIER_REGION:-eu-central-1}"

# If the tier already exists with a different bucket or endpoint, drop it
# before re-adding so the new config takes effect. `mc ilm tier rm` refuses
# while objects still reference the tier; that failure is the right behavior
# (forces the operator to rehydrate cold objects before changing buckets).
if mc ilm tier info minio "$NAME" --json > /tmp/tier.json 2>/dev/null; then
  cur_bucket=$(grep -o '"Bucket":"[^"]*"' /tmp/tier.json | head -1 | cut -d: -f2- | tr -d '"')
  cur_endpoint=$(grep -o '"Endpoint":"[^"]*"' /tmp/tier.json | head -1 | cut -d: -f2- | tr -d '"')
  if [ "$cur_bucket" = "$COLD_TIER_BUCKET" ] && [ "$cur_endpoint" = "$COLD_TIER_ENDPOINT" ]; then
    echo "Cold tier $NAME already points at $cur_bucket; updating credentials only"
    mc ilm tier update minio "$NAME" --access-key "$COLD_TIER_ACCESS_KEY" --secret-key "$COLD_TIER_SECRET_KEY"
  else
    echo "Cold tier $NAME bucket/endpoint changed (was $cur_bucket @ $cur_endpoint, want $COLD_TIER_BUCKET @ $COLD_TIER_ENDPOINT). Recreating."
    mc ilm tier rm minio "$NAME"
    mc ilm tier add s3 minio "$NAME" \
      --endpoint "$COLD_TIER_ENDPOINT" \
      --access-key "$COLD_TIER_ACCESS_KEY" \
      --secret-key "$COLD_TIER_SECRET_KEY" \
      --bucket "$COLD_TIER_BUCKET" \
      --prefix "${COLD_TIER_PREFIX}/" \
      --region "$REGION"
  fi
else
  echo "Cold tier $NAME not registered yet, adding"
  mc ilm tier add s3 minio "$NAME" \
    --endpoint "$COLD_TIER_ENDPOINT" \
    --access-key "$COLD_TIER_ACCESS_KEY" \
    --secret-key "$COLD_TIER_SECRET_KEY" \
    --bucket "$COLD_TIER_BUCKET" \
    --prefix "${COLD_TIER_PREFIX}/" \
    --region "$REGION"
fi

mc ilm rule remove --all --force minio/raw-images
mc ilm rule add --transition-days 0 --transition-tier "$NAME" --tags "tier=cold" minio/raw-images
mc ilm rule add --noncurrentversion-expiration-days 1 --expired-object-delete-marker minio/raw-images

echo "Cold tier configured"
echo "MinIO buckets created successfully"
