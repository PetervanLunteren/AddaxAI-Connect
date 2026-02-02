"""
Email report generation for daily/weekly/monthly project summaries.

Each user with email reports enabled receives one email per project
containing comprehensive statistics for the report period.
"""
from typing import Tuple, Optional, List, Dict, Any
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

from sqlalchemy import select, and_

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    ProjectNotificationPreference,
    User,
    Project
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings

from db_operations import create_notification_log
from report_stats import (
    get_overview_stats,
    get_species_distribution,
    get_camera_health_summary,
    get_notable_detections,
    get_activity_summary,
    get_images_timeline
)

logger = get_logger("notifications.email_report")
settings = get_settings()

# Set up Jinja2 template environment
TEMPLATE_DIR = Path(__file__).parent / "templates"
jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=True
)


def send_daily_reports() -> None:
    """
    Scheduled job: Send daily email reports at 06:00 UTC.

    Queries users with email_report.enabled=True and frequency='daily',
    generates reports for yesterday's data, and queues for delivery.
    """
    logger.info("Starting daily email reports")

    # Report covers yesterday
    today = date.today()
    report_date = today - timedelta(days=1)

    _send_reports_for_frequency(
        frequency='daily',
        start_date=report_date,
        end_date=report_date,
        period_label=report_date.strftime('%B %d, %Y')
    )


def send_weekly_reports() -> None:
    """
    Scheduled job: Send weekly email reports at 06:00 UTC Monday.

    Queries users with email_report.enabled=True and frequency='weekly',
    generates reports for the previous week's data, and queues for delivery.
    """
    logger.info("Starting weekly email reports")

    # Report covers last 7 days (Mon-Sun)
    today = date.today()
    end_date = today - timedelta(days=1)  # Yesterday (Sunday)
    start_date = end_date - timedelta(days=6)  # Previous Monday

    _send_reports_for_frequency(
        frequency='weekly',
        start_date=start_date,
        end_date=end_date,
        period_label=f"{start_date.strftime('%B %d')} - {end_date.strftime('%B %d, %Y')}"
    )


def send_monthly_reports() -> None:
    """
    Scheduled job: Send monthly email reports at 06:00 UTC on 1st.

    Queries users with email_report.enabled=True and frequency='monthly',
    generates reports for the previous month's data, and queues for delivery.
    """
    logger.info("Starting monthly email reports")

    # Report covers previous month
    today = date.today()
    # First day of current month
    first_of_month = today.replace(day=1)
    # Last day of previous month
    end_date = first_of_month - timedelta(days=1)
    # First day of previous month
    start_date = end_date.replace(day=1)

    _send_reports_for_frequency(
        frequency='monthly',
        start_date=start_date,
        end_date=end_date,
        period_label=start_date.strftime('%B %Y')
    )


def _send_reports_for_frequency(
    frequency: str,
    start_date: date,
    end_date: date,
    period_label: str
) -> None:
    """
    Send reports for all users with the given frequency setting.

    Args:
        frequency: 'daily', 'weekly', or 'monthly'
        start_date: Start of report period
        end_date: End of report period
        period_label: Human-readable period description
    """
    with get_sync_session() as db:
        # Query users with email reports enabled for this frequency
        query = (
            select(ProjectNotificationPreference, User, Project)
            .join(User, ProjectNotificationPreference.user_id == User.id)
            .join(Project, ProjectNotificationPreference.project_id == Project.id)
            .where(
                User.is_active == True,
                User.is_verified == True
            )
        )

        preferences = list(db.execute(query).all())

        if not preferences:
            logger.info("No users with notification preferences found")
            return

        # Filter to users with email reports enabled at this frequency
        eligible_prefs = []
        for pref, user, project in preferences:
            email_config = _get_email_report_config(pref)
            if email_config and email_config.get('frequency') == frequency:
                eligible_prefs.append((pref, user, project, email_config))

        if not eligible_prefs:
            logger.info(
                "No users with email reports enabled for frequency",
                frequency=frequency
            )
            return

        logger.info(
            "Processing email reports",
            frequency=frequency,
            user_project_count=len(eligible_prefs),
            period=period_label
        )

        # Initialize email queue
        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        messages_queued = 0

        for pref, user, project, email_config in eligible_prefs:
            try:
                # Determine recipient email
                to_email = pref.report_email if pref.report_email else user.email

                if not to_email:
                    logger.warning(
                        "No email address for user",
                        user_id=user.id,
                        project_id=project.id
                    )
                    continue

                # Generate report content
                html_content, text_content = generate_report_content(
                    db=db,
                    project_id=project.id,
                    project_name=project.name,
                    start_date=start_date,
                    end_date=end_date,
                    period_label=period_label,
                    frequency=frequency,
                    email_config=email_config
                )

                # Build subject line
                frequency_label = frequency.capitalize()
                subject = f"{project.name} - {frequency_label} report ({period_label})"

                # Trigger data for audit log
                trigger_data = {
                    'project_id': project.id,
                    'project_name': project.name,
                    'frequency': frequency,
                    'start_date': start_date.isoformat(),
                    'end_date': end_date.isoformat(),
                    'period_label': period_label,
                    'generated_at': datetime.now(timezone.utc).isoformat()
                }

                # Create notification log
                log_id = create_notification_log(
                    user_id=user.id,
                    notification_type='email_report',
                    channel='email',
                    trigger_data=trigger_data,
                    message_content=text_content[:1000]  # Truncate for log
                )

                # Queue for delivery
                email_queue.publish({
                    'notification_log_id': log_id,
                    'to_email': to_email,
                    'subject': subject,
                    'body_text': text_content,
                    'body_html': html_content
                })

                messages_queued += 1

                logger.info(
                    "Queued email report",
                    user_id=user.id,
                    user_email=to_email,
                    project_id=project.id,
                    project_name=project.name,
                    frequency=frequency,
                    log_id=log_id
                )

            except Exception as e:
                logger.error(
                    "Failed to generate report for user",
                    user_id=user.id,
                    project_id=project.id,
                    error=str(e),
                    exc_info=True
                )
                continue

        logger.info(
            "Email reports completed",
            frequency=frequency,
            total_checked=len(eligible_prefs),
            messages_queued=messages_queued
        )


def _get_email_report_config(pref: ProjectNotificationPreference) -> Optional[Dict[str, Any]]:
    """
    Extract email report configuration from notification_channels JSON.

    Args:
        pref: User's notification preference

    Returns:
        Email report config dict or None if not enabled
    """
    channels_config = pref.notification_channels

    if not channels_config or not isinstance(channels_config, dict):
        return None

    email_config = channels_config.get('email_report', {})

    if not isinstance(email_config, dict):
        return None

    if not email_config.get('enabled', False):
        return None

    # Ensure frequency is set
    if 'frequency' not in email_config:
        return None

    return email_config


def generate_report_content(
    db,
    project_id: int,
    project_name: str,
    start_date: date,
    end_date: date,
    period_label: str,
    frequency: str,
    email_config: Dict[str, Any]
) -> Tuple[str, str]:
    """
    Generate HTML and plain text report content.

    Args:
        db: Database session
        project_id: Project ID
        project_name: Project name
        start_date: Report period start
        end_date: Report period end
        period_label: Human-readable period
        frequency: Report frequency
        email_config: User's email report settings

    Returns:
        Tuple of (html_content, text_content)
    """
    domain = settings.domain_name or "localhost:3000"
    project_url = f"https://{domain}/projects/{project_id}/dashboard"
    settings_url = f"https://{domain}/projects/{project_id}/notifications"

    # Determine which sections to include
    include_stats = email_config.get('include_stats', True)
    include_health = email_config.get('include_health', True)
    include_activity = email_config.get('include_activity', True)
    include_detections = email_config.get('include_detections', True)

    # Gather statistics
    report_data = {
        'project_name': project_name,
        'project_url': project_url,
        'settings_url': settings_url,
        'period_label': period_label,
        'frequency': frequency.capitalize(),
        'domain': domain,
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    }

    if include_stats:
        report_data['overview'] = get_overview_stats(db, project_id, start_date, end_date)
        report_data['species'] = get_species_distribution(
            db, project_id, start_date, end_date,
            limit=email_config.get('top_species_count', 10)
        )

    if include_health:
        report_data['health'] = get_camera_health_summary(db, project_id)

    if include_activity:
        report_data['activity'] = get_activity_summary(db, project_id, start_date, end_date)
        report_data['timeline'] = get_images_timeline(db, project_id, start_date, end_date)

    if include_detections:
        report_data['notable'] = get_notable_detections(
            db, project_id, start_date, end_date,
            limit=email_config.get('notable_detection_count', 5)
        )

    # Generate HTML
    try:
        html_template = jinja_env.get_template('email_report.html')
        html_content = html_template.render(**report_data)
    except Exception as e:
        logger.warning("Failed to render HTML template, using text only", error=str(e))
        html_content = None

    # Generate plain text
    text_content = _generate_text_report(report_data)

    return html_content, text_content


def _generate_text_report(data: Dict[str, Any]) -> str:
    """
    Generate plain text version of the report.

    Args:
        data: Report data dictionary

    Returns:
        Plain text report
    """
    lines = [
        f"{data['project_name']} - {data['frequency']} Report",
        f"Period: {data['period_label']}",
        "=" * 50,
        ""
    ]

    # Overview
    if 'overview' in data:
        overview = data['overview']
        lines.extend([
            "OVERVIEW",
            "-" * 20,
            f"New images: {overview['new_images']}",
            f"Total images: {overview['total_images']}",
            f"Total cameras: {overview['total_cameras']}",
            f"Species detected: {overview['total_species']}",
            f"New species: {overview['new_species']}",
            ""
        ])

    # Top species
    if 'species' in data and data['species']:
        lines.extend([
            "TOP SPECIES",
            "-" * 20
        ])
        for sp in data['species']:
            lines.append(f"  {sp['species']}: {sp['count']} detections")
        lines.append("")

    # Camera health
    if 'health' in data:
        health = data['health']
        lines.extend([
            "CAMERA HEALTH",
            "-" * 20,
            f"Active cameras: {health['active']} / {health['total']}",
            f"Inactive cameras: {health['inactive']}",
            f"Low battery: {health['low_battery_count']}"
        ])
        if health['low_battery_cameras']:
            lines.append("  Cameras needing attention:")
            for cam in health['low_battery_cameras'][:5]:
                lines.append(f"    - {cam['name']}: {cam['battery']}%")
        lines.append("")

    # Activity
    if 'activity' in data:
        activity = data['activity']
        lines.extend([
            "ACTIVITY",
            "-" * 20,
            f"Total detections: {activity['total_detections']}"
        ])
        if activity['peak_hour'] is not None:
            lines.append(f"Peak activity hour: {activity['peak_hour']}:00")
        lines.append("")

    # Notable detections
    if 'notable' in data and data['notable']:
        lines.extend([
            "NOTABLE DETECTIONS",
            "-" * 20
        ])
        for det in data['notable']:
            lines.append(f"  {det['species']} ({det['confidence']}%) at {det['camera']}")
        lines.append("")

    # Footer
    lines.extend([
        "-" * 50,
        f"View full dashboard: {data['project_url']}",
        f"Manage notifications: {data['settings_url']}",
        "",
        "AddaxAI Connect - Camera trap image processing"
    ])

    return "\n".join(lines)
