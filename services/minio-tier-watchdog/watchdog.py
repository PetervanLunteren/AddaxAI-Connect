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
from datetime import datetime, timedelta, timezone
from typing import Optional

import boto3
import redis
from botocore.client import Config


BUCKET = "raw-images"
HOT_PATH = "/data/raw-images"
TAG_KEY = "tier"
TAG_VALUE = "cold"
STATUS_KEY = "cold_tier:status"

# How long the ILM scanner gets to move tagged objects before a still-full
# disk counts as evidence that transitions are broken. Comfortably longer
# than a scan, comfortably shorter than the daily tick.
ILM_GRACE_SECONDS = 6 * 3600


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


def read_status(redis_client) -> Optional[dict]:
    """Last tick's payload, or None when there is nothing usable.

    The key outlives the process (TTL is 3x the tick), so this survives a
    restart. Missing on a fresh server, which correctly reads as "nothing
    has been tagged yet".
    """
    raw = redis_client.get(STATUS_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def ilm_is_stuck(current: int, budget_bytes: int,
                 previous: Optional[dict], now: datetime) -> bool:
    """True when tagged objects are demonstrably not reaching the cold tier.

    Three things have to hold together. The disk is over budget by more than
    the 10% margin. A previous tick already tagged objects, so ILM has been
    given something to move. And that tick was long enough ago that the
    scanner has had its chance.

    The last two conditions are the point. Tagging and measuring happen in the
    same tick, and the loop ticks immediately at startup, so the size read
    just before tagging says nothing yet about whether transitions work.
    Judging on it alone meant every deploy made while over budget raised an
    alert, which then sat on the health page and in the 03:00 email for a full
    day with nothing actually wrong.
    """
    if current <= budget_bytes * 1.10:
        return False
    if not previous or not previous.get("tagged_count"):
        return False
    stamped = previous.get("timestamp")
    if not stamped:
        return False
    try:
        tagged_at = datetime.fromisoformat(stamped)
    except ValueError:
        return False
    if tagged_at.tzinfo is None:
        tagged_at = tagged_at.replace(tzinfo=timezone.utc)
    return now - tagged_at >= timedelta(seconds=ILM_GRACE_SECONDS)


def tick(client, log, previous: Optional[dict] = None):
    budget_gb = float(os.environ.get("COLD_TIER_HOT_BUDGET_GB", "80"))
    budget_bytes = int(budget_gb * (1024 ** 3))

    current = hot_bytes()
    log.info("hot=%.2f GB, budget=%.2f GB", current / (1024 ** 3), budget_gb)
    result = {
        "hot_gb": round(current / (1024 ** 3), 3),
        "budget_gb": budget_gb,
        "tagged_count": 0,
        "tagged_gb": 0.0,
        "objects_hot": 0,
        "objects_cold": 0,
    }

    # Walk the bucket once: count per storage class and collect hot candidates.
    candidates = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            storage_class = obj.get("StorageClass", "STANDARD")
            if storage_class == "STANDARD":
                result["objects_hot"] += 1
                candidates.append((obj["LastModified"], obj["Size"], obj["Key"]))
            else:
                result["objects_cold"] += 1

    if current <= budget_bytes:
        log.info("under budget, no-op (hot=%d, cold=%d objects)",
                 result["objects_hot"], result["objects_cold"])
        result["status"] = "ok"
        return result

    excess = current - budget_bytes
    log.info(
        "over budget by %.2f GB, selecting oldest of %d STANDARD objects",
        excess / (1024 ** 3), result["objects_hot"],
    )
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

    # Health check against the budget contract. The 10% margin absorbs normal
    # between-scan lag and fresh uploads arriving between ticks. Catches
    # missing rules, expired remote credentials, Wasabi outages, and any
    # other reason transitions are not happening. See ilm_is_stuck for why
    # the disk size on its own is not enough to convict.
    if ilm_is_stuck(current, budget_bytes, previous, datetime.now(timezone.utc)):
        result["status"] = "error"
        result["error"] = (
            f"hot disk {current / (1024 ** 3):.2f} GB exceeds "
            f"budget {budget_gb:.2f} GB by more than 10%. "
            "MinIO ILM is not draining tagged objects to the cold tier. "
            "Check `mc ilm rule ls` and `mc ilm tier ls`."
        )
        log.error(result["error"])
    else:
        result["status"] = "ok"
        if current > budget_bytes * 1.10:
            result["waiting_for_ilm"] = True
            log.info("over budget, but these objects were only just tagged; "
                     "waiting for the ILM scanner before calling it broken")
    return result


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    for noisy in ("boto3", "botocore", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    log = logging.getLogger("tier-watchdog")

    tick_seconds = int(os.environ.get("COLD_TIER_TICK_SECONDS", "86400"))
    log.info("watchdog starting; tick_seconds=%d", tick_seconds)

    redis_client = redis.from_url(os.environ["REDIS_URL"])

    if os.environ.get("COLD_TIER_ENABLED", "false").lower() != "true":
        log.info("COLD_TIER_ENABLED is not true; idling (nothing to transition to)")
        write_status(redis_client, 86400, {"status": "idle",
                     "message": "cold tier disabled (COLD_TIER_ENABLED=false)"})
        while True:
            time.sleep(3600)
            write_status(redis_client, 86400, {"status": "idle",
                         "message": "cold tier disabled (COLD_TIER_ENABLED=false)"})

    # Crash early on auth or connectivity errors (CONVENTIONS.md #1)
    client = make_client()
    client.head_bucket(Bucket=BUCKET)

    while True:
        try:
            result = tick(client, log, read_status(redis_client))
            write_status(redis_client, tick_seconds, result)
        except Exception as exc:
            log.exception("tick failed, will retry next interval")
            write_status(redis_client, tick_seconds,
                         {"status": "error", "error": f"{type(exc).__name__}: {exc}"})
        time.sleep(tick_seconds)


if __name__ == "__main__":
    main()
