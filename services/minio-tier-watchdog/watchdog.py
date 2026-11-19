"""MinIO cold-tier watchdog.

Measures local `raw-images` disk usage each tick. When it exceeds
COLD_TIER_HOT_BUDGET_GB, tags the oldest STANDARD-class objects with
`tier=cold` until the projected hot footprint drops back under budget.
A MinIO ILM rule (installed by minio-init) then transitions any tagged
object to the remote cold tier.

Only classified images are tagged. Detection and classification still read
the raw of every other image, and a raw that went cold first has to come
back from the remote tier for each read: slower, and one broken read fails
the image. So a backlog can hold the disk over budget until it is processed.
The budget is a target, not a limit.

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

import redis


BUCKET = "raw-images"
HOT_PATH = "/data/raw-images"
STATUS_KEY = "cold_tier:status"

# How long the ILM scanner gets to move tagged objects before a still-full
# disk counts as evidence that transitions are broken. Comfortably longer
# than a scan, comfortably shorter than the daily tick.
ILM_GRACE_SECONDS = 6 * 3600


def classified_keys(keys: list[str]) -> set[str]:
    """The keys among `keys` whose image is classified, so safe to move.

    An allow-list on purpose. Ingestion stores the object before it writes
    the row, so a skip-list of unfinished images would let a seconds-old
    upload through. One query, the keys go as a single array.
    """
    from sqlalchemy import String, any_, literal, select
    from sqlalchemy.dialects.postgresql import ARRAY
    from shared.database import get_db_session
    from shared.models import Image

    if not keys:
        return set()
    with get_db_session() as db:
        rows = db.execute(
            select(Image.storage_path).where(
                Image.status == "classified",
                Image.storage_path == any_(literal(keys, ARRAY(String))),
            )
        )
        return {row[0] for row in rows}


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


def ilm_is_stuck(current: int, budget_bytes: int, objects_cold: int,
                 previous: Optional[dict], now: datetime) -> bool:
    """True when tagged objects are demonstrably not reaching the cold tier.

    Four things have to hold together. The disk is over budget by more than
    the 10% margin. A previous tick already tagged objects, so ILM has been
    given something to move. That tick was long enough ago that the scanner
    has had its chance. And no more objects are cold now than at that tick.

    The last one separates a broken path from a full disk. A missing rule,
    an expired key and a remote outage all move nothing at all, while new
    uploads fill the disk with transitions working fine. Without it, one
    large SD-card import the day after any tagging raised the alert. It
    asks whether anything moved, not whether it moved fast enough.

    The middle two conditions are about timing. Tagging and measuring happen in the
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
    if now - tagged_at < timedelta(seconds=ILM_GRACE_SECONDS):
        return False
    return objects_cold <= previous.get("objects_cold", 0)


def tick(storage, log, previous: Optional[dict] = None):
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
    paginator = storage.client.get_paginator("list_objects_v2")
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
    movable = classified_keys([key for _lm, _size, key in candidates])
    candidates = sorted(c for c in candidates if c[2] in movable)
    log.info(
        "over budget by %.2f GB, selecting oldest of %d classified objects "
        "(%d STANDARD in total)",
        excess / (1024 ** 3), len(candidates), result["objects_hot"],
    )

    tagged_count = 0
    tagged_bytes = 0
    for _lm, size, key in candidates:
        if tagged_bytes >= excess:
            break
        try:
            storage.tag_object_cold(BUCKET, key)
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
    if ilm_is_stuck(current, budget_bytes, result["objects_cold"], previous,
                    datetime.now(timezone.utc)):
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
        if current > budget_bytes * 1.10 and tagged_count:
            result["waiting_for_ilm"] = True
            log.info("over budget, but these objects were only just tagged; "
                     "waiting for the ILM scanner before calling it broken")
        elif current > budget_bytes * 1.10:
            log.info("over budget, but no classified object is left to move; "
                     "the rest waits for detection and classification")
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
    from shared.storage import StorageClient
    storage = StorageClient()
    storage.client.head_bucket(Bucket=BUCKET)

    while True:
        try:
            result = tick(storage, log, read_status(redis_client))
            write_status(redis_client, tick_seconds, result)
        except Exception as exc:
            log.exception("tick failed, will retry next interval")
            write_status(redis_client, tick_seconds,
                         {"status": "error", "error": f"{type(exc).__name__}: {exc}"})
        time.sleep(tick_seconds)


if __name__ == "__main__":
    main()
