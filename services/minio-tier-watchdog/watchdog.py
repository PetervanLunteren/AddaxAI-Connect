"""MinIO cold-tier watchdog.

Measures local `raw-images` disk usage each tick. When it exceeds
COLD_TIER_HOT_BUDGET_GB, tags the oldest STANDARD-class objects with
`tier=cold` until the projected hot footprint drops back under budget.
A MinIO ILM rule (installed by minio-init) then transitions any tagged
object to the remote cold tier.

After each tick (success or failure) the watchdog writes a status
payload to Redis at `cold_tier:status` so both the Docker healthcheck
and the API /api/health/services endpoint can surface problems.
"""
import json
import logging
import os
import subprocess
import time
from datetime import datetime, timezone

import boto3
import redis
from botocore.client import Config


BUCKET = "raw-images"
HOT_PATH = "/data/raw-images"
TAG_KEY = "tier"
TAG_VALUE = "cold"
STATUS_KEY = "cold_tier:status"


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


def hot_bytes() -> int:
    if not os.path.exists(HOT_PATH):
        return 0
    result = subprocess.run(
        ["du", "-sb", HOT_PATH], capture_output=True, text=True, check=True
    )
    return int(result.stdout.split()[0])


def write_status(redis_client, tick_seconds: int, payload: dict):
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    # TTL at 3x tick interval so the key disappears if the watchdog dies
    ttl = max(tick_seconds * 3, 300)
    redis_client.set(STATUS_KEY, json.dumps(payload), ex=ttl)


def tick(client, log):
    budget_gb = float(os.environ.get("COLD_TIER_HOT_BUDGET_GB", "80"))
    budget_bytes = int(budget_gb * (1024 ** 3))

    current = hot_bytes()
    log.info("hot=%.2f GB, budget=%.2f GB", current / (1024 ** 3), budget_gb)
    result = {
        "hot_gb": round(current / (1024 ** 3), 3),
        "budget_gb": budget_gb,
        "tagged_count": 0,
        "tagged_gb": 0.0,
    }
    if current <= budget_bytes:
        log.info("under budget, no-op")
        return result

    excess = current - budget_bytes
    log.info(
        "over budget by %.2f GB, selecting oldest STANDARD objects",
        excess / (1024 ** 3),
    )

    candidates = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            if obj.get("StorageClass", "STANDARD") != "STANDARD":
                continue  # already transitioned to a remote tier
            candidates.append((obj["LastModified"], obj["Size"], obj["Key"]))
    candidates.sort(key=lambda r: r[0])

    tagged_count = 0
    tagged_bytes = 0
    for _lm, size, key in candidates:
        if tagged_bytes >= excess:
            break
        try:
            client.put_object_tagging(
                Bucket=BUCKET,
                Key=key,
                Tagging={"TagSet": [{"Key": TAG_KEY, "Value": TAG_VALUE}]},
            )
        except Exception:
            log.exception("failed to tag %s", key)
            continue
        tagged_count += 1
        tagged_bytes += size

    log.info(
        "tagged %d objects (%.2f GB); projected hot after ILM scan ~= %.2f GB",
        tagged_count,
        tagged_bytes / (1024 ** 3),
        (current - tagged_bytes) / (1024 ** 3),
    )
    result["tagged_count"] = tagged_count
    result["tagged_gb"] = round(tagged_bytes / (1024 ** 3), 3)
    return result


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    # boto3 + botocore + urllib3 are extremely chatty at DEBUG (full signature
    # computation and HTTP headers per request). Pin them to WARNING so the
    # watchdog's own logger keeps DEBUG useful for our logic.
    for noisy in ("boto3", "botocore", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    log = logging.getLogger("tier-watchdog")

    tick_seconds = int(os.environ.get("COLD_TIER_TICK_SECONDS", "86400"))
    log.info("watchdog starting; tick_seconds=%d", tick_seconds)

    redis_client = redis.from_url(os.environ["REDIS_URL"])

    if not os.environ.get("COLD_TIER_ENDPOINT"):
        log.info("COLD_TIER_ENDPOINT not set; idling (nothing to transition to)")
        write_status(redis_client, 86400, {"status": "idle",
                     "message": "cold tier disabled (COLD_TIER_ENDPOINT empty)"})
        while True:
            time.sleep(3600)
            write_status(redis_client, 86400, {"status": "idle",
                         "message": "cold tier disabled (COLD_TIER_ENDPOINT empty)"})

    # Crash early on auth or connectivity errors (CONVENTIONS.md #1)
    client = make_client()
    client.head_bucket(Bucket=BUCKET)

    while True:
        try:
            result = tick(client, log)
            write_status(redis_client, tick_seconds, {"status": "ok", **result})
        except Exception as exc:
            log.exception("tick failed, will retry next interval")
            write_status(redis_client, tick_seconds,
                         {"status": "error", "error": f"{type(exc).__name__}: {exc}"})
        time.sleep(tick_seconds)


if __name__ == "__main__":
    main()
