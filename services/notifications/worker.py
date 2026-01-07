"""
Core Notifications Service

Listens to notification events from classification/ingestion workers,
evaluates rules, and routes to appropriate channel queues.
"""
from typing import Dict, Any

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EVENTS, QUEUE_NOTIFICATION_SIGNAL
from shared.config import get_settings

from rule_engine import get_matching_users
from event_handlers import handle_species_detection, handle_low_battery, handle_system_health

logger = get_logger("notifications")
settings = get_settings()


def process_notification_event(event: Dict[str, Any]) -> None:
    """
    Process incoming notification event.

    Args:
        event: Notification event from classification/ingestion workers

    Expected event structure:
    {
        'type': 'species_detection' | 'low_battery' | 'system_health',
        ... (type-specific fields)
    }
    """
    event_type = event.get('type')

    if not event_type:
        logger.error("Missing event type", event=event)
        return

    logger.info("Processing notification event", event_type=event_type)

    try:
        # Get users who should be notified based on their preferences
        matching_users = get_matching_users(event)

        if not matching_users:
            logger.debug(
                "No users match notification criteria",
                event_type=event_type,
                event_id=event.get('image_id') or event.get('camera_id')
            )
            return

        logger.info(
            "Found matching users",
            event_type=event_type,
            user_count=len(matching_users)
        )

        # Route to appropriate event handler
        if event_type == 'species_detection':
            handle_species_detection(event, matching_users)
        elif event_type == 'low_battery':
            handle_low_battery(event, matching_users)
        elif event_type == 'system_health':
            handle_system_health(event, matching_users)
        else:
            logger.error("Unknown event type", event_type=event_type)

    except Exception as e:
        logger.error(
            "Failed to process notification event",
            event_type=event_type,
            error=str(e),
            exc_info=True
        )
        raise


def main() -> None:
    """Main entry point for notifications service"""
    logger.info("Starting notifications service")

    # Listen to notification events queue
    queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)

    logger.info("Listening for notification events")

    try:
        queue.consume_forever(process_notification_event)
    except KeyboardInterrupt:
        logger.info("Shutting down notifications service")


if __name__ == "__main__":
    main()
