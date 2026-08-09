# Notifications service

Central notification coordinator. Evaluates real-time detection alert
rules on the live event path and runs the scheduled notification jobs.

## Architecture

1. Listens to `QUEUE_NOTIFICATION_EVENTS` for `species_detection` events
   from the classification workers
2. Evaluates each event against the users' private detection alert rules
   (`detection_alerts.py`), including site scope, time-of-day window,
   group size, cooldown, and rarity conditions
3. Creates `notification_logs` entries for the audit trail
4. Routes messages to the channel queues (`QUEUE_NOTIFICATION_EMAIL`,
   `QUEUE_NOTIFICATION_TELEGRAM`); the channel workers handle delivery

Scheduled jobs (APScheduler, see `worker.py` for times): email reports,
excessive image alerts, project inactivity alerts, SIM expiry alerts,
project reminders, camera condition alert rules, disk usage and infra
alert checks.

## Species detection event

Published by both classification workers, suppressed for bulk uploads:

```python
{
    'event_type': 'species_detection',
    'project_id': int,
    'image_uuid': str,
    'camera_id': int,
    'camera_name': str,
    'camera_location': {'lat': float, 'lon': float} or None,
    'species': str,               # species label, or person/vehicle
    'confidence': float,          # classification confidence
    'detection_confidence': float,
    'detection_count': int,       # all detections in the image
    'species_count': int,         # detections of this species
    'annotated_minio_path': str or None,
    'timestamp': str,             # camera capture time
}
```

## Files

- `worker.py` - Main entry point, event loop plus the scheduled jobs
- `detection_alerts.py` - Detection alert rules, live event path
- `camera_alerts.py` - Camera condition alert rules, daily cron
- `email_report.py`, `report_stats.py` - Scheduled email reports
- `excessive_images.py`, `project_inactivity.py`, `sim_expiry.py`,
  `disk_usage_alert.py`, `infra_alert.py`, `reminders.py` - Other crons
- `db_operations.py` - Notification logs and shared DB helpers
