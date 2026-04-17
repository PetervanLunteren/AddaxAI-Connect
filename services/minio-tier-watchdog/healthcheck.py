"""Docker healthcheck for the cold-tier watchdog.

Exits 0 when the watchdog has written a recent `ok` or `idle` status to
Redis. Exits 1 when the status is missing (container never ticked),
stale (Redis TTL expired), or `error` (last tick raised).
"""
import json
import os
import sys

import redis


STATUS_KEY = "cold_tier:status"


def main():
    client = redis.from_url(os.environ["REDIS_URL"])
    raw = client.get(STATUS_KEY)
    if not raw:
        print("no status in redis (watchdog never ticked or TTL expired)")
        sys.exit(1)
    payload = json.loads(raw)
    status = payload.get("status")
    if status in ("ok", "idle"):
        print(f"status={status}")
        sys.exit(0)
    print(f"status={status} error={payload.get('error', 'unknown')}")
    sys.exit(1)


if __name__ == "__main__":
    main()
