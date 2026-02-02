"""
Core Notifications Service

Listens to notification events from classification/ingestion workers,
evaluates rules, and routes to appropriate channel queues.

Also runs scheduled jobs:
- Daily battery digest at 12:00 UTC
- Email reports: daily at 06:00 UTC, weekly on Monday, monthly on 1st
"""
from typing import Dict, Any
from apscheduler.schedulers.background import BackgroundScheduler

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EVENTS
from shared.config import get_settings

from rule_engine import get_matching_users
from event_handlers import handle_species_detection, handle_low_battery, handle_system_health
from battery_digest import send_daily_battery_digest
from email_report import send_daily_reports, send_weekly_reports, send_monthly_reports

logger = get_logger("notifications")
settings = get_settings()


def process_notification_event(event: Dict[str, Any]) -> None:
    """
    Process incoming notification event.

    Args:
        event: Notification event from classification/ingestion workers

    Expected event structure:
    {
        'event_type': 'species_detection' | 'low_battery' | 'system_health',
        ... (type-specific fields)
    }
    """
    event_type = event.get('event_type')

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

    # Set up daily battery digest scheduler
    scheduler = BackgroundScheduler(timezone='UTC')
    scheduler.add_job(
        send_daily_battery_digest,
        'cron',
        hour=12,
        minute=0,
        id='daily_battery_digest',
        name='Send daily battery digest at noon UTC'
    )
    # Email reports - daily at 06:00 UTC
    scheduler.add_job(
        send_daily_reports,
        'cron',
        hour=6,
        minute=0,
        id='daily_email_reports',
        name='Send daily email reports at 06:00 UTC'
    )

    # Email reports - weekly on Monday at 06:00 UTC
    scheduler.add_job(
        send_weekly_reports,
        'cron',
        day_of_week='mon',
        hour=6,
        minute=0,
        id='weekly_email_reports',
        name='Send weekly email reports at 06:00 UTC Monday'
    )

    # Email reports - monthly on 1st at 06:00 UTC
    scheduler.add_job(
        send_monthly_reports,
        'cron',
        day=1,
        hour=6,
        minute=0,
        id='monthly_email_reports',
        name='Send monthly email reports at 06:00 UTC on 1st'
    )

    scheduler.start()

    logger.info("Scheduled daily battery digest at 12:00 UTC")
    logger.info("Scheduled email reports: daily 06:00, weekly Monday 06:00, monthly 1st 06:00 UTC")

    # Listen to notification events queue
    queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)

    logger.info("Listening for notification events")

    try:
        queue.consume_forever(process_notification_event)
    except KeyboardInterrupt:
        logger.info("Shutting down notifications service")
        scheduler.shutdown()


if __name__ == "__main__":
    main()
