"""
Redis queue client wrapper

Provides simple interface for pub/sub messaging between services.
"""
import redis
import json
from typing import Any, Optional, Callable
from .config import get_settings

settings = get_settings()


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
        print(f"Worker listening on queue: {self.queue_name}")
        while True:
            message = self.consume()
            if message:
                try:
                    callback(message)
                except Exception as e:
                    print(f"Error processing message: {e}")
                    # TODO: Add to dead-letter queue

    def queue_depth(self) -> int:
        """Get current queue depth"""
        return self.client.llen(self.queue_name)


# Queue names (constants)
QUEUE_IMAGE_INGESTED = "image-ingested"
QUEUE_DETECTION_COMPLETE = "detection-complete"
QUEUE_CLASSIFICATION_COMPLETE = "classification-complete"
QUEUE_FAILED_JOBS = "failed-jobs"
