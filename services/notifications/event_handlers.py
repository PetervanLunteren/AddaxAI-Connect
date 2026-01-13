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

from db_operations import create_notification_log, get_project_name

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
        'annotated_image_url': str,  # API URL to annotated image
        'timestamp': str (ISO 8601)
    }

    Message format:
    "Wolf observed 70s ago!

    Camera: WUH07
    Time: 06:12:34
    Date: 2026-01-12

    View: https://yourdomain.com/images/{image_uuid}"

    Attaches annotated image with bounding box.
    """
    image_uuid = event.get('image_uuid')
    species = event.get('species')
    confidence = event.get('confidence')
    camera_name = event.get('camera_name')
    location = event.get('camera_location')
    annotated_image_url = event.get('annotated_image_url')
    project_id = event.get('project_id')
    timestamp_str = event.get('timestamp')

    # Validate required fields
    if not all([image_uuid, species, confidence, camera_name, project_id]):
        logger.error("Missing required fields in species_detection event", event=event)
        return

    # Get project name
    project_name = get_project_name(project_id)
    if not project_name:
        project_name = f"Project {project_id}"  # Fallback

    # Parse timestamp (just extract time and date from DateTimeOriginal)
    try:
        if timestamp_str:
            # Try ISO 8601 format first
            try:
                event_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except ValueError:
                # Fall back to EXIF format: "2025:12:16 18:21:25"
                # EXIF DateTimeOriginal is in camera's local time (timezone-agnostic)
                event_time = datetime.strptime(timestamp_str, "%Y:%m:%d %H:%M:%S")
        else:
            event_time = datetime.now()

        # Format time and date from camera's DateTimeOriginal
        time_str = event_time.strftime('%H:%M:%S')
        date_str = event_time.strftime('%a, %d %b %Y')  # e.g., "Wed, 23 Dec 2025"
    except Exception as e:
        logger.warning(f"Failed to parse timestamp: {e}")
        time_str = "Unknown"
        date_str = "Unknown"

    # Format species name (replace underscores with spaces and capitalize first letter only)
    species_display = species.replace('_', ' ').capitalize()

    # Build message text with Markdown formatting (bold for headers)
    message_lines = [
        f"*{species_display} detected!*",
        f"*Camera:* {camera_name}",
        f"*Time:* {time_str}",
        f"*Date:* {date_str}",
        f"*Project:* {project_name}"
    ]

    message_content = "\n".join(message_lines)

    # Build dashboard URL for buttons
    domain = settings.domain_name or "localhost:3000"
    dashboard_url = f"https://{domain}/projects/{project_id}/images"

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
                    'attachment_url': annotated_image_url,
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

                # Create inline keyboard with Map and View buttons
                buttons_row = []

                # Add Map button if location is available
                if location:
                    lat = location.get('lat')
                    lon = location.get('lon')
                    if lat and lon:
                        buttons_row.append({
                            'text': 'Map',
                            'url': f'https://maps.google.com/?q={lat},{lon}'
                        })

                # Add View button
                buttons_row.append({
                    'text': 'View',
                    'url': dashboard_url
                })

                reply_markup = {
                    'inline_keyboard': [buttons_row]
                }

                # Publish to Telegram queue
                telegram_queue.publish({
                    'notification_log_id': log_id,
                    'chat_id': user['telegram_chat_id'],
                    'message_text': message_content,
                    'attachment_url': annotated_image_url,
                    'reply_markup': reply_markup,
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
