"""
Core Notifications Service

Listens to species_detection events from the classification workers and
evaluates them against the users' detection alert rules.

Also runs scheduled jobs (15-minute spacing convention):
- Infra alert check daily at 03:00 UTC
- Email reports: daily at 06:00 UTC, weekly on Monday, monthly on 1st
- Project inactivity alerts daily at 06:00 UTC
- SIM expiry alerts on the 1st at 06:15 UTC
- Excessive image alerts daily at 06:30 UTC
- Scheduled project reminders daily at 06:45 UTC
- Camera condition alert rules daily at 07:00 UTC
- Scheduled species reports daily at 07:30 UTC
- Disk usage alert check hourly at :00
- Delivery worker liveness check hourly at :15
"""
from typing import Dict, Any
from apscheduler.schedulers.background import BackgroundScheduler

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EVENTS, HEARTBEAT_KEY_NOTIFICATIONS
from shared.config import get_settings

from detection_alerts import handle_detection_event
from camera_alerts import send_camera_condition_alerts
from email_report import send_daily_reports, send_weekly_reports, send_monthly_reports
from excessive_images import send_excessive_image_alerts
from project_inactivity import send_project_inactivity_alerts
from sim_expiry import send_sim_expiry_alerts
from reminders import send_due_reminders
from disk_usage_alert import check_disk_usage_and_alert
from infra_alert import check_infra_alerts
from delivery_liveness import check_delivery_liveness
from scheduled_species_reports import send_scheduled_species_reports

logger = get_logger("notifications")
settings = get_settings()


def process_notification_event(event: Dict[str, Any]) -> None:
    """
    Process incoming notification event.

    Args:
        event: Notification event from the classification workers

    Expected event structure:
    {
        'event_type': 'species_detection',
        ... (see detection_alerts.handle_detection_event)
    }
    """
    event_type = event.get('event_type')

    if not event_type:
        logger.error("Missing event type", event=event)
        return

    logger.info("Processing notification event", event_type=event_type)

    try:
        if event_type == 'species_detection':
            handle_detection_event(event)
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

    # Set up the scheduled jobs (15-minute spacing convention)
    scheduler = BackgroundScheduler(timezone='UTC')
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

    # Excessive image alerts - daily at 06:30 UTC
    scheduler.add_job(
        send_excessive_image_alerts,
        'cron',
        hour=6,
        minute=30,
        id='excessive_image_alerts',
        name='Send excessive image alerts at 06:30 UTC'
    )

    # Project inactivity alerts - daily at 06:00 UTC
    scheduler.add_job(
        send_project_inactivity_alerts,
        'cron',
        hour=6,
        minute=0,
        id='project_inactivity_alerts',
        name='Send project inactivity alerts at 06:00 UTC'
    )

    # SIM expiry alerts - monthly on the 1st at 06:15 UTC. Sits 15 min after
    # the monthly email_reports job at 06:00 so the two cron jobs do not slam
    # the SMTP queue at the same instant.
    scheduler.add_job(
        send_sim_expiry_alerts,
        'cron',
        day=1,
        hour=6,
        minute=15,
        id='sim_expiry_alerts',
        name='Send SIM expiry alerts on the 1st at 06:15 UTC'
    )

    # Scheduled project reminders - daily at 06:45 UTC. Spaced 15 min after
    # the excessive-image alerts (06:30) so the SMTP queue is not slammed.
    scheduler.add_job(
        send_due_reminders,
        'cron',
        hour=6,
        minute=45,
        id='project_reminders',
        name='Send due project reminders at 06:45 UTC daily',
    )

    # Disk usage alert - hourly
    scheduler.add_job(
        check_disk_usage_and_alert,
        'cron',
        minute=0,
        id='disk_usage_alert',
        name='Check disk usage hourly, email admins on threshold crossing'
    )

    # Delivery worker liveness - hourly at :15 (disk owns :00; :15 only
    # overlaps SIM expiry on the 1st at 06:15, the least-colliding slot)
    scheduler.add_job(
        check_delivery_liveness,
        'cron',
        minute=15,
        id='delivery_liveness',
        name='Check delivery worker liveness hourly at :15'
    )

    # Infra alerts (cold tier + backup) - daily at 03:00 UTC, one hour after the
    # backup cron so the new backup:last_run key is fresh when we check it.
    scheduler.add_job(
        check_infra_alerts,
        'cron',
        hour=3,
        minute=0,
        id='infra_alerts',
        name='Daily infra alert check at 03:00 UTC'
    )

    # Camera condition alert rules - daily at 07:00 UTC (next free slot
    # after reminders at 06:45)
    scheduler.add_job(
        send_camera_condition_alerts,
        'cron',
        hour=7,
        minute=0,
        id='camera_condition_alerts',
        name='Evaluate camera condition alert rules daily at 07:00 UTC'
    )

    # Scheduled species reports - daily at 07:30 UTC (07:15 would collide
    # with the hourly delivery liveness check at :15). The job itself
    # decides which frequencies are due on the server-local date.
    scheduler.add_job(
        send_scheduled_species_reports,
        'cron',
        hour=7,
        minute=30,
        id='scheduled_species_reports',
        name='Send scheduled species reports daily at 07:30 UTC'
    )

    scheduler.start()

    logger.info("Scheduled camera condition alerts at 07:00 UTC")
    logger.info("Scheduled species reports at 07:30 UTC")
    logger.info("Scheduled email reports: daily 06:00, weekly Monday 06:00, monthly 1st 06:00 UTC")
    logger.info("Scheduled excessive image alerts at 06:30 UTC")
    logger.info("Scheduled project inactivity alerts at 06:00 UTC")
    logger.info("Scheduled disk usage alert check hourly")
    logger.info("Scheduled infra alert check daily at 03:00 UTC")

    # Listen to notification events queue
    queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)

    logger.info("Listening for notification events")

    try:
        queue.consume_forever(
            process_notification_event, heartbeat_key=HEARTBEAT_KEY_NOTIFICATIONS
        )
    except KeyboardInterrupt:
        logger.info("Shutting down notifications service")
        scheduler.shutdown()


if __name__ == "__main__":
    main()
