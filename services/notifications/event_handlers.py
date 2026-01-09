"""
Event handlers for different notification types

Each handler:
1. Formats message content
2. Creates notification_log entries
3. Publishes to channel-specific queues (e.g., Signal)
"""
from typing import Dict, Any, List
from datetime import datetime

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_SIGNAL, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings

from db_operations import create_notification_log

logger = get_logger("notifications.handlers")
settings = get_settings()


def handle_species_detection(
    event: Dict[str, Any],
    matching_users: List[Dict[str, Any]]
) -> None:
    """
    Handle species detection notification.

    Event schema:
    {
        'event_type': 'species_detection',
        'image_uuid': str (UUID),
        'species': str,
        'confidence': float,
        'camera_id': int,
        'camera_name': str,
        'camera_location': {'lat': float, 'lon': float} or None,
        'thumbnail_path': str,  # MinIO path to image thumbnail with bbox
        'timestamp': str (ISO 8601)
    }

    Message format:
    "Wolf (94%) detected at Camera-GK123
    Location: 51.5074, -0.1278
    View: https://yourdomain.com/images/{image_uuid}"

    Attaches thumbnail image with bounding box.
    """
    image_uuid = event.get('image_uuid')
    species = event.get('species')
    confidence = event.get('confidence')
    camera_name = event.get('camera_name')
    location = event.get('camera_location')
    thumbnail_path = event.get('thumbnail_path')

    # Validate required fields
    if not all([image_uuid, species, confidence, camera_name]):
        logger.error("Missing required fields in species_detection event", event=event)
        return

    # Format confidence as percentage
    confidence_pct = int(confidence * 100)

    # Build message text
    message_lines = [
        f"{species.replace('_', ' ').title()} ({confidence_pct}%) detected at {camera_name}"
    ]

    if location:
        lat = location.get('lat')
        lon = location.get('lon')
        if lat and lon:
            message_lines.append(f"Location: {lat:.6f}, {lon:.6f}")

    # Add link to web dashboard
    domain = settings.domain_name or "localhost:3000"
    dashboard_url = f"https://{domain}/images/{image_uuid}"
    message_lines.append(f"View: {dashboard_url}")

    message_content = "\n".join(message_lines)

    logger.info(
        "Processing species detection notification",
        species=species,
        camera=camera_name,
        user_count=len(matching_users)
    )

    # Initialize queues
    signal_queue = RedisQueue(QUEUE_NOTIFICATION_SIGNAL)
    telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)

    for user in matching_users:
        channels = user.get('channels', [])

        # Publish to each requested channel
        for channel in channels:
            if channel == 'signal' and user.get('signal_phone'):
                # Create notification log entry (status='pending')
                log_id = create_notification_log(
                    user_id=user['user_id'],
                    notification_type='species_detection',
                    channel='signal',
                    trigger_data=event,
                    message_content=message_content
                )

                # Publish to Signal queue
                signal_queue.publish({
                    'notification_log_id': log_id,
                    'recipient_phone': user['signal_phone'],
                    'message_text': message_content,
                    'attachment_path': thumbnail_path,
                })

                logger.info(
                    "Queued species detection notification",
                    user_id=user['user_id'],
                    species=species,
                    channel='signal',
                    log_id=log_id
                )

            elif channel == 'telegram' and user.get('telegram_chat_id'):
                # Create notification log entry (status='pending')
                log_id = create_notification_log(
                    user_id=user['user_id'],
                    notification_type='species_detection',
                    channel='telegram',
                    trigger_data=event,
                    message_content=message_content
                )

                # Publish to Telegram queue
                telegram_queue.publish({
                    'notification_log_id': log_id,
                    'chat_id': user['telegram_chat_id'],
                    'message_text': message_content,
                    'attachment_path': thumbnail_path,
                })

                logger.info(
                    "Queued species detection notification",
                    user_id=user['user_id'],
                    species=species,
                    channel='telegram',
                    log_id=log_id
                )


def handle_low_battery(
    event: Dict[str, Any],
    matching_users: List[Dict[str, Any]]
) -> None:
    """
    Handle low battery notification.

    Event schema:
    {
        'type': 'low_battery',
        'camera_id': int,
        'camera_name': str,
        'imei': str,
        'battery_percentage': int,
        'location': {'lat': float, 'lon': float} or None,
        'timestamp': str (ISO 8601)
    }

    Message format:
    "Low battery alert: Camera-GK123 (IMEI: 123456789)
    Battery: 25%
    Location: 51.5074, -0.1278"
    """
    camera_name = event.get('camera_name')
    imei = event.get('imei')
    battery_percentage = event.get('battery_percentage')
    location = event.get('location')

    # Validate required fields
    if not all([camera_name, imei, battery_percentage is not None]):
        logger.error("Missing required fields in low_battery event", event=event)
        return

    # Build message text
    message_lines = [
        f"Low battery alert: {camera_name} (IMEI: {imei})",
        f"Battery: {battery_percentage}%"
    ]

    if location:
        lat = location.get('lat')
        lon = location.get('lon')
        if lat and lon:
            message_lines.append(f"Location: {lat:.6f}, {lon:.6f}")

    message_content = "\n".join(message_lines)

    logger.info(
        "Processing low battery notification",
        camera=camera_name,
        battery=battery_percentage,
        user_count=len(matching_users)
    )

    # Initialize queues
    signal_queue = RedisQueue(QUEUE_NOTIFICATION_SIGNAL)
    telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)

    for user in matching_users:
        channels = user.get('channels', [])

        # Publish to each requested channel
        for channel in channels:
            if channel == 'signal' and user.get('signal_phone'):
                # Create notification log entry (status='pending')
                log_id = create_notification_log(
                    user_id=user['user_id'],
                    notification_type='low_battery',
                    channel='signal',
                    trigger_data=event,
                    message_content=message_content
                )

                # Publish to Signal queue (no attachment for battery notifications)
                signal_queue.publish({
                    'notification_log_id': log_id,
                    'recipient_phone': user['signal_phone'],
                    'message_text': message_content,
                    'attachment_path': None,
                })

                logger.info(
                    "Queued low battery notification",
                    user_id=user['user_id'],
                    camera=camera_name,
                    channel='signal',
                    log_id=log_id
                )

            elif channel == 'telegram' and user.get('telegram_chat_id'):
                # Create notification log entry (status='pending')
                log_id = create_notification_log(
                    user_id=user['user_id'],
                    notification_type='low_battery',
                    channel='telegram',
                    trigger_data=event,
                    message_content=message_content
                )

                # Publish to Telegram queue (no attachment for battery notifications)
                telegram_queue.publish({
                    'notification_log_id': log_id,
                    'chat_id': user['telegram_chat_id'],
                    'message_text': message_content,
                    'attachment_path': None,
                })

                logger.info(
                    "Queued low battery notification",
                    user_id=user['user_id'],
                    camera=camera_name,
                    channel='telegram',
                    log_id=log_id
                )


def handle_system_health(
    event: Dict[str, Any],
    matching_users: List[Dict[str, Any]]
) -> None:
    """
    Handle system health notification.

    Event schema:
    {
        'type': 'system_health',
        'alert_type': str,  # e.g., 'service_down', 'queue_backlog', 'disk_space'
        'severity': str,  # 'warning', 'error', 'critical'
        'message': str,
        'details': dict,
        'timestamp': str (ISO 8601)
    }

    Message format:
    "System health alert: Service down
    Severity: critical
    Details: Detection worker has been down for 5 minutes"
    """
    alert_type = event.get('alert_type')
    severity = event.get('severity')
    message = event.get('message')

    # Validate required fields
    if not all([alert_type, severity, message]):
        logger.error("Missing required fields in system_health event", event=event)
        return

    # Build message text
    message_lines = [
        f"System health alert: {alert_type}",
        f"Severity: {severity}",
        message
    ]

    message_content = "\n".join(message_lines)

    logger.info(
        "Processing system health notification",
        alert_type=alert_type,
        severity=severity,
        user_count=len(matching_users)
    )

    # Initialize queues
    signal_queue = RedisQueue(QUEUE_NOTIFICATION_SIGNAL)
    telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)

    for user in matching_users:
        channels = user.get('channels', [])

        # Publish to each requested channel
        for channel in channels:
            if channel == 'signal' and user.get('signal_phone'):
                # Create notification log entry (status='pending')
                log_id = create_notification_log(
                    user_id=user['user_id'],
                    notification_type='system_health',
                    channel='signal',
                    trigger_data=event,
                    message_content=message_content
                )

                # Publish to Signal queue (no attachment for system health)
                signal_queue.publish({
                    'notification_log_id': log_id,
                    'recipient_phone': user['signal_phone'],
                    'message_text': message_content,
                    'attachment_path': None,
                })

                logger.info(
                    "Queued system health notification",
                    user_id=user['user_id'],
                    alert_type=alert_type,
                    channel='signal',
                    log_id=log_id
                )

            elif channel == 'telegram' and user.get('telegram_chat_id'):
                # Create notification log entry (status='pending')
                log_id = create_notification_log(
                    user_id=user['user_id'],
                    notification_type='system_health',
                    channel='telegram',
                    trigger_data=event,
                    message_content=message_content
                )

                # Publish to Telegram queue (no attachment for system health)
                telegram_queue.publish({
                    'notification_log_id': log_id,
                    'chat_id': user['telegram_chat_id'],
                    'message_text': message_content,
                    'attachment_path': None,
                })

                logger.info(
                    "Queued system health notification",
                    user_id=user['user_id'],
                    alert_type=alert_type,
                    channel='telegram',
                    log_id=log_id
                )
