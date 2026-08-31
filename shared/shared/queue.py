"""
Redis queue client wrapper

Provides simple interface for pub/sub messaging between services.
"""
import redis
import json
import time
from datetime import datetime, timezone
from typing import Any, Optional, Callable
from .config import get_settings
from .logger import get_logger

settings = get_settings()
logger = get_logger("queue")


class RedisQueue:
    """
    Redis-based message queue.

    Uses Redis lists for FIFO queue with BRPOP for blocking consumption.
    """

    def __init__(self, queue_name: str):
        self.queue_name = queue_name
        self.client = redis.from_url(settings.redis_url, decode_responses=True)

    def publish(self, message: dict) -> None:
        """
        Publish message to queue.

        Args:
            message: Dictionary to serialize as JSON
        """
        self.client.lpush(self.queue_name, json.dumps(message))

    def consume(self, timeout: int = 0) -> Optional[dict]:
        """
        Consume message from queue (blocking).

        Args:
            timeout: Timeout in seconds (0 = wait indefinitely)

        Returns:
            Deserialized message dict or None if timeout
        """
        result = self.client.brpop(self.queue_name, timeout=timeout)
        if result:
            _, message = result
            return json.loads(message)
        return None

    def _reconnect(self, backoff_seconds: float = 1.0) -> None:
        """
        Recreate the Redis client after a connection or read error.

        A long-running consumer must survive a transient Redis blip (dropped
        connection, socket read timeout) instead of letting the exception
        crash the worker. Sleeps briefly first so a persistent failure does
        not become a tight reconnect loop.
        """
        time.sleep(backoff_seconds)
        try:
            self.client.close()
        except Exception:
            pass
        self.client = redis.from_url(settings.redis_url, decode_responses=True)

    def consume_forever(
        self,
        callback: Callable[[dict], None],
        heartbeat_key: Optional[str] = None,
    ) -> None:
        """
        Consume messages in infinite loop.

        With a heartbeat_key, every loop iteration stamps the current UTC
        time into that Redis key so liveness checks can see the worker is
        alive. The BRPOP timeout is finite for that reason: an idle worker
        must still return to the loop top and tick. The stamp sits before
        the consume on purpose, it asserts "the loop is alive"; a callback
        wedged on a hung send never returns here, the stamps stop
        advancing, and staleness fires. No TTL on the key, so the last
        seen time survives restarts and a missing key means the worker
        never ran against this Redis.

        Args:
            callback: Function to call with each message
            heartbeat_key: Redis key to stamp each iteration, or None
        """
        logger.info("Worker listening on queue", queue=self.queue_name)
        while True:
            try:
                if heartbeat_key:
                    self.stamp_heartbeat(heartbeat_key)
                message = self.consume(timeout=HEARTBEAT_TICK_SECONDS)
            except (redis.ConnectionError, redis.TimeoutError) as e:
                logger.warning(
                    "Redis read failed, reconnecting",
                    queue=self.queue_name,
                    error=str(e),
                )
                self._reconnect()
                continue
            if message:
                try:
                    callback(message)
                except Exception as e:
                    logger.error(
                        "Error processing message",
                        queue=self.queue_name,
                        error=str(e),
                        exc_info=True,
                    )
                    # TODO: Add to dead-letter queue

    def consume_forever_priority(
        self,
        queues: list[str],
        callback: Callable[[dict], None],
        heartbeat_key: Optional[str] = None,
    ) -> None:
        """
        Consume from multiple queues in strict priority order.

        Uses Redis BRPOP with multiple keys: it scans the keys in the
        order given and pops from the first non-empty one. Earlier
        queues in the list are higher priority. This is what protects
        live ingestion from being starved by a long bulk-upload batch:
        whenever the live queue has anything, the worker grabs that
        first.

        The heartbeat works exactly as in consume_forever: stamped at the
        top of the loop, before the pop, so it asserts "the loop is
        alive" rather than "the process exists". A callback wedged on a
        hung inference never returns here, the stamps stop advancing, and
        staleness fires. The BRPOP timeout is finite for that reason; an
        idle worker must still come back and tick. It was 0 (block
        forever) before the heartbeat existed, and an empty pop was
        already handled, so the timeout changes nothing else.

        Args:
            queues: Queue names in priority order (highest first).
            callback: Function called with the message dict.
            heartbeat_key: Redis key to stamp each iteration, or None.
        """
        logger.info("Worker listening on priority queues", queues=queues)
        while True:
            try:
                if heartbeat_key:
                    self.stamp_heartbeat(heartbeat_key)
                result = self.client.brpop(queues, timeout=HEARTBEAT_TICK_SECONDS)
            except (redis.ConnectionError, redis.TimeoutError) as e:
                logger.warning(
                    "Redis read failed, reconnecting",
                    queues=queues,
                    error=str(e),
                )
                self._reconnect()
                continue
            if not result:
                continue
            source_queue, raw = result
            try:
                message = json.loads(raw)
                callback(message)
            except Exception as e:
                logger.error(
                    "Error processing priority message",
                    source_queue=source_queue,
                    error=str(e),
                    exc_info=True,
                )

    def stamp_heartbeat(self, heartbeat_key: str) -> None:
        """
        Write the current UTC time to a liveness key.

        One definition of how a heartbeat is written, used by both consume
        loops and by workers that consume no queue at all (ingestion
        watches the filesystem). No TTL, so the last seen time survives a
        restart and a missing key means the worker never ran against this
        Redis.
        """
        self.client.set(heartbeat_key, datetime.now(timezone.utc).isoformat())

    def record_device(self, device_key: str, device: str) -> None:
        """
        Record which device ("cpu" or "cuda") an ML worker loaded its model on.

        Written once, after the model is on that device, so the value is a
        fact and not a plan. The health page shows it next to the worker's
        heartbeat. A separate key rather than a richer heartbeat value, so
        parse_heartbeat and every existing reader stay untouched. No TTL,
        like the heartbeat; the reader only shows it for a healthy row, so a
        worker that has since died cannot advertise a stale device.
        """
        self.client.set(device_key, device)

    def queue_depth(self) -> int:
        """Get current queue depth"""
        return self.client.llen(self.queue_name)


# Queue names (constants)
QUEUE_IMAGE_INGESTED = "image-ingested"
QUEUE_DETECTION_COMPLETE = "detection-complete"
QUEUE_FAILED_JOBS = "failed-jobs"

# Bulk-upload variants. Workers consume the live queue with strict
# priority over the bulk one (see consume_forever_priority), so a
# 5,000-image SD card dump never delays a live FTPS detection.
QUEUE_IMAGE_INGESTED_BULK = "image-ingested-bulk"
QUEUE_DETECTION_COMPLETE_BULK = "detection-complete-bulk"
QUEUE_BULK_UPLOAD_JOB = "bulk-upload-job"
# Process-phase messages go to a dedicated queue so a user clicking
# Process jumps ahead of any pending inspects in the regular queue.
# Matches the live-vs-bulk priority pattern, applied within the
# bulk-upload worker.
QUEUE_BULK_UPLOAD_JOB_PROCESS = "bulk-upload-job-process"

# Notification queues
QUEUE_NOTIFICATION_EVENTS = "notification-events"  # Core service listens here
QUEUE_NOTIFICATION_TELEGRAM = "notification-telegram"  # Telegram worker listens here
QUEUE_NOTIFICATION_EMAIL = "notification-email"  # Email worker listens here
QUEUE_NOTIFICATION_EARTHRANGER = "notification-earthranger"  # EarthRanger (Gundi) worker listens here

def parse_heartbeat(raw: Optional[str]) -> Optional[datetime]:
    """Parse a stored heartbeat stamp. None on missing or garbage.

    A stamp without a timezone is treated as UTC. Nothing writes naive
    stamps today, but the watchdog must not be killable by one bad
    value: subtracting a naive datetime from an aware one raises, and an
    uncaught error here would silently disable the very check that
    exists to catch silent failures. Shared by the API health endpoint
    and the delivery liveness check so both classify values identically.
    """
    if not raw:
        return None
    try:
        stamp = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp


# Worker heartbeats. Every long-running worker stamps its key at the top
# of its own loop; the API health endpoint and the hourly liveness check
# read them. Names match the health page rows.
HEARTBEAT_KEY_NOTIFICATIONS = "heartbeat:notifications"
HEARTBEAT_KEY_NOTIFICATIONS_EMAIL = "heartbeat:notifications-email"
HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM = "heartbeat:notifications-telegram"
HEARTBEAT_KEY_NOTIFICATIONS_EARTHRANGER = "heartbeat:notifications-earthranger"
HEARTBEAT_KEY_INGESTION = "heartbeat:ingestion"
HEARTBEAT_KEY_DETECTION = "heartbeat:detection"
# One key for both classifiers. A server runs deepfaune or speciesnet,
# never both, and the health page has a single "classification" row.
HEARTBEAT_KEY_CLASSIFICATION = "heartbeat:classification"
# Device the ML workers loaded their model on, "cpu" or "cuda". Written by
# RedisQueue.record_device after the load, read by the API health endpoint.
# One key for both classifiers, for the same reason as the heartbeat.
DEVICE_KEY_DETECTION = "device:detection"
DEVICE_KEY_CLASSIFICATION = "device:classification"
# How often an idle consume loop wakes to stamp, and how old a stamp may
# get before the worker counts as dead. The margin between the two keeps
# one slow message from raising a false alarm.
HEARTBEAT_TICK_SECONDS = 60
HEARTBEAT_STALE_AFTER_MINUTES = 15
