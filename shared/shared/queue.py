"""
Redis queue client wrapper

Provides simple interface for pub/sub messaging between services.
"""
import redis
import json
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

    def consume_forever(self, callback: Callable[[dict], None]) -> None:
        """
        Consume messages in infinite loop.

        Args:
            callback: Function to call with each message
        """
        logger.info("Worker listening on queue", queue=self.queue_name)
        while True:
            message = self.consume()
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
    ) -> None:
        """
        Consume from multiple queues in strict priority order.

        Uses Redis BRPOP with multiple keys: it scans the keys in the
        order given and pops from the first non-empty one. Earlier
        queues in the list are higher priority. This is what protects
        live ingestion from being starved by a long bulk-upload batch:
        whenever the live queue has anything, the worker grabs that
        first.

        Args:
            queues: Queue names in priority order (highest first).
            callback: Function called with the message dict.
        """
        logger.info("Worker listening on priority queues", queues=queues)
        while True:
            result = self.client.brpop(queues, timeout=0)
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

# Notification queues
QUEUE_NOTIFICATION_EVENTS = "notification-events"  # Core service listens here
QUEUE_NOTIFICATION_TELEGRAM = "notification-telegram"  # Telegram worker listens here
QUEUE_NOTIFICATION_EMAIL = "notification-email"  # Email worker listens here
# Future channels:
# QUEUE_NOTIFICATION_SMS = "notification-sms"
# QUEUE_NOTIFICATION_EARTHRANGER = "notification-earthranger"
