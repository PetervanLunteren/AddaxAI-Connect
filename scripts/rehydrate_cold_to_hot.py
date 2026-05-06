"""Move every cold-tier object in raw-images permanently back to hot.

Rehydrates by GET + PUT to the same key. The new PUT lands as a fresh
STANDARD-class current version with no tags. The previous version (the
one with the WASABI_COLD storage class and tier=cold tag) becomes
noncurrent and is swept by the existing
`--noncurrentversion-expiration-days 1 --expired-object-delete-marker`
ILM rule, which also tells MinIO to drop the body in Wasabi.

Run inside the api or ingestion container so MinIO creds come from env.
The transition ILM rule must already be removed (see the runbook in
docs/cold-storage-restore.md) so re-PUTs are not immediately re-tagged
or transitioned.

Usage:
    docker compose exec -T api python /app/scripts/rehydrate_cold_to_hot.py --dry-run
    docker compose exec -T api python /app/scripts/rehydrate_cold_to_hot.py
    docker compose exec -T api python /app/scripts/rehydrate_cold_to_hot.py --limit 10

The script is idempotent: re-running after a partial run picks up only
objects that are still cold.
"""
import argparse
import logging
import os
import sys
import time

import boto3
from botocore.client import Config


BUCKET = "raw-images"
HOT_CLASS = "STANDARD"


def make_client():
    endpoint = os.environ["MINIO_ENDPOINT"]
    if not endpoint.startswith("http"):
        endpoint = f"http://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],
        aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="us-east-1",
    )


def list_cold_objects(client):
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            if obj.get("StorageClass", HOT_CLASS) != HOT_CLASS:
                yield obj["Key"], obj["Size"]


def rehydrate_one(client, key: str) -> int:
    """GET the cold body from Wasabi and PUT it back as a hot object.

    Returns the byte size of the rehydrated body.
    """
    resp = client.get_object(Bucket=BUCKET, Key=key)
    body = resp["Body"].read()
    content_type = resp.get("ContentType", "application/octet-stream")
    metadata = resp.get("Metadata", {})

    # Plain put_object writes a new STANDARD current version with no tags.
    # We deliberately do not copy the tier=cold tag from the cold version.
    client.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=body,
        ContentType=content_type,
        Metadata=metadata,
    )
    return len(body)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Count and size cold objects, do not rehydrate.")
    parser.add_argument("--limit", type=int, default=0,
                        help="Stop after this many objects (0 = no limit).")
    parser.add_argument("--progress-every", type=int, default=100,
                        help="Log progress every N objects.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stdout,
    )
    log = logging.getLogger("rehydrate")

    client = make_client()
    client.head_bucket(Bucket=BUCKET)

    cold = list(list_cold_objects(client))
    total_count = len(cold)
    total_bytes = sum(size for _, size in cold)
    log.info("found %d cold objects, %.2f GB total",
             total_count, total_bytes / 1e9)

    if args.dry_run:
        log.info("dry-run: not rehydrating")
        return 0

    if args.limit > 0:
        cold = cold[:args.limit]
        log.info("limit=%d, will process %d objects", args.limit, len(cold))

    started = time.time()
    done = 0
    bytes_done = 0
    failed = []

    for key, expected_size in cold:
        try:
            size = rehydrate_one(client, key)
            done += 1
            bytes_done += size
        except Exception as exc:
            log.exception("failed to rehydrate %s", key)
            failed.append((key, str(exc)))

        if done % args.progress_every == 0 and done > 0:
            elapsed = time.time() - started
            rate = done / elapsed if elapsed > 0 else 0
            remaining = len(cold) - done
            eta_min = (remaining / rate / 60) if rate > 0 else 0
            log.info(
                "progress %d/%d (%.1f%%), %.2f GB done, %.1f obj/s, ETA %.1f min",
                done, len(cold), 100 * done / len(cold),
                bytes_done / 1e9, rate, eta_min,
            )

    elapsed = time.time() - started
    log.info(
        "done: %d rehydrated, %d failed, %.2f GB transferred in %.1f min",
        done, len(failed), bytes_done / 1e9, elapsed / 60,
    )
    if failed:
        log.error("failed keys (first 20):")
        for key, err in failed[:20]:
            log.error("  %s: %s", key, err)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
