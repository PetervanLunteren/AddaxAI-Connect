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

    def queue_depth(self) -> int:
        """Get current queue depth"""
        return self.client.llen(self.queue_name)


# Queue names (constants)
QUEUE_IMAGE_INGESTED = "image-ingested"
QUEUE_DETECTION_COMPLETE = "detection-complete"
QUEUE_CLASSIFICATION_COMPLETE = "classification-complete"
QUEUE_FAILED_JOBS = "failed-jobs"

# Notification queues
QUEUE_NOTIFICATION_EVENTS = "notification-events"  # Core service listens here
QUEUE_NOTIFICATION_SIGNAL = "notification-signal"  # Signal worker listens here
QUEUE_NOTIFICATION_TELEGRAM = "notification-telegram"  # Telegram worker listens here
# Future channels:
# QUEUE_NOTIFICATION_EMAIL = "notification-email"
# QUEUE_NOTIFICATION_SMS = "notification-sms"
# QUEUE_NOTIFICATION_EARTHRANGER = "notification-earthranger"
