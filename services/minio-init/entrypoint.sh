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

# Annotated images are written to thumbnails/annotated/ for notification
# attachments and are only needed until the messages go out. They used to be
# deleted by the telegram worker after its own send, which stole the
# attachment from every other recipient of the same photo. MinIO expires them
# instead. The prefix keeps real thumbnails, which live under
# <camera_id>/<year>/<month>/, untouched.
# Runs before the cold-tier block below, which exits early when the cold tier
# is off, so this applies on every server.
if mc ilm rule export minio/thumbnails > /dev/null 2>&1; then
  mc ilm rule remove --all --force minio/thumbnails
fi
mc ilm rule add --expire-days 1 --prefix "annotated/" minio/thumbnails

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
#
# Detection uses `mc ilm tier ls` because `mc ilm tier info NAME --json` is
# broken in current mc releases (fails with "Incorrect number of arguments").
# This stack registers at most one remote tier, so the first Bucket/Endpoint
# in the listing belongs to $NAME.
#
# Parsed with shell builtins on purpose. The minio/mc image ships mc, cat, cut,
# tr and head, and no grep, sed, awk or jq. A grep here died with "command not
# found", which under `set -e` took the script out at the `mc ilm tier add`
# below, before it ever reached the transition rule. Every cold-tier server ran
# for months with minio-init exiting 1 and raw-images holding expiry rules but
# no transition, so nothing ever drained. Use no external tool in this block.
tiers="$(mc ilm tier ls minio --json)"
case "$tiers" in *"\"Name\":\"$NAME\""*)
  # Shortest prefix up to the first "Bucket":" , then everything before the
  # closing quote. Same first-match semantics the listing guarantees.
  rest="${tiers#*\"Bucket\":\"}"   ; cur_bucket="${rest%%\"*}"
  rest="${tiers#*\"Endpoint\":\"}" ; cur_endpoint="${rest%%\"*}"
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
  ;;
*)
  echo "Cold tier $NAME not registered yet, adding"
  mc ilm tier add s3 minio "$NAME" \
    --endpoint "$COLD_TIER_ENDPOINT" \
    --access-key "$COLD_TIER_ACCESS_KEY" \
    --secret-key "$COLD_TIER_SECRET_KEY" \
    --bucket "$COLD_TIER_BUCKET" \
    --prefix "${COLD_TIER_PREFIX}/" \
    --region "$REGION"
  ;;
esac

# `mc ilm rule remove --all` errors when the bucket has no lifecycle
# configuration yet (fresh bucket), so only remove when one exists.
if mc ilm rule export minio/raw-images > /dev/null 2>&1; then
  mc ilm rule remove --all --force minio/raw-images
fi
mc ilm rule add --transition-days 0 --transition-tier "$NAME" --tags "tier=cold" minio/raw-images
mc ilm rule add --noncurrentversion-expiration-days 1 --expired-object-delete-marker minio/raw-images

echo "Cold tier configured"
echo "MinIO buckets created successfully"
