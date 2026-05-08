"""
Scheduled project reminders — daily check.

Each row in `project_reminders` is a one-shot email scheduled by a project
admin. Every morning at 06:45 UTC we scan for rows where:
    sent_at IS NULL
    AND cancelled_at IS NULL
    AND send_on <= server-local today

For every match we email the creator (the only recipient by user choice),
stamp `sent_at`, and write a `notification_logs` row for audit. Defense-in-
depth: if the creator no longer has any access to the project we skip the
row silently and leave `sent_at` NULL so an operator can chase it via the
history UI ("creator no longer in project") rather than silently emailing
someone who lost access.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from sqlalchemy import select

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    Project,
    ProjectMembership,
    ProjectReminder,
    User,
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import create_notification_log, get_server_timezone

logger = get_logger("notifications.reminders")
settings = get_settings()


def send_due_reminders() -> None:
    """Scheduled job. Email every reminder whose send_on has arrived and
    whose creator still has access to the project."""
    logger.info("Starting due-reminders check")

    with get_sync_session() as db:
        tz = get_server_timezone(db)
        today = datetime.now(tz).date()

        rows: List[Tuple[ProjectReminder, User, Project]] = list(db.execute(
            select(ProjectReminder, User, Project)
            .join(User, ProjectReminder.created_by_user_id == User.id)
            .join(Project, ProjectReminder.project_id == Project.id)
            .where(
                ProjectReminder.sent_at.is_(None),
                ProjectReminder.cancelled_at.is_(None),
                ProjectReminder.send_on <= today,
                User.is_active == True,
                User.is_verified == True,
            )
            .order_by(ProjectReminder.send_on.asc(), ProjectReminder.id.asc())
        ).all())

        if not rows:
            logger.info("No due reminders")
            return

        logger.info("Processing due reminders", count=len(rows))

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        sent = 0
        skipped_no_access = 0
        failed = 0

        for reminder, user, project in rows:
            try:
                if not _has_project_access(db, user.id, project.id):
                    # Creator was removed from the project after creating the
                    # reminder. Leave the row unsent so admins notice it.
                    logger.warning(
                        "Skipping reminder; creator has no project access",
                        reminder_id=reminder.id,
                        project_id=project.id,
                        user_id=user.id,
                    )
                    skipped_no_access += 1
                    continue

                if not user.email:
                    logger.warning(
                        "Skipping reminder; user has no email",
                        reminder_id=reminder.id,
                        user_id=user.id,
                    )
                    skipped_no_access += 1
                    continue

                _queue_email(email_queue, reminder, user, project, today)
                reminder.sent_at = datetime.now(timezone.utc)
                sent += 1

            except Exception as exc:
                logger.error(
                    "Failed to process reminder",
                    reminder_id=reminder.id,
                    project_id=project.id,
                    user_id=user.id,
                    error=str(exc),
                    exc_info=True,
                )
                failed += 1
                continue

        db.commit()

        logger.info(
            "Due-reminders check complete",
            total=len(rows),
            sent=sent,
            skipped_no_access=skipped_no_access,
            failed=failed,
        )


def _has_project_access(db, user_id: int, project_id: int) -> bool:
    """Server admins have implicit access; regular users must hold any
    membership row (admin or viewer) on the project."""
    user = db.execute(
        select(User).where(User.id == user_id)
    ).scalar_one_or_none()
    if user and user.is_superuser:
        return True
    membership = db.execute(
        select(ProjectMembership.role).where(
            ProjectMembership.user_id == user_id,
            ProjectMembership.project_id == project_id,
        )
    ).scalar_one_or_none()
    return membership is not None


def _queue_email(
    email_queue: RedisQueue,
    reminder: ProjectReminder,
    user: User,
    project: Project,
    run_date,
) -> None:
    """Render the HTML + plaintext bodies and publish to the email queue,
    plus write the notification_logs audit row."""
    domain = settings.domain_name or "localhost:3000"
    settings_url = f"https://{domain}/projects/{project.id}/notifications"

    template_data: Dict[str, Any] = {
        "project_name": project.name,
        "date_label": reminder.send_on.strftime("%B %d, %Y"),
        "message": reminder.message,
        "settings_url": settings_url,
    }

    html_content, _ = render_email("project_reminder.html", **template_data)
    text_content = _generate_text_content(
        project.name, reminder.send_on, reminder.message, settings_url
    )

    subject = f"{project.name}: reminder"

    trigger_data = {
        "reminder_id": reminder.id,
        "project_id": project.id,
        "project_name": project.name,
        "send_on": reminder.send_on.isoformat(),
        "run_date": run_date.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    log_id = create_notification_log(
        user_id=user.id,
        notification_type="project_reminder",
        channel="email",
        trigger_data=trigger_data,
        message_content=text_content[:1000],
    )

    email_queue.publish({
        "notification_log_id": log_id,
        "to_email": user.email,
        "subject": subject,
        "body_text": text_content,
        "body_html": html_content,
    })

    logger.info(
        "Queued reminder email",
        reminder_id=reminder.id,
        project_id=project.id,
        user_id=user.id,
        log_id=log_id,
    )


def _generate_text_content(
    project_name: str,
    send_on,
    message: str,
    settings_url: str,
) -> str:
    """Plaintext fallback. Mirrors the HTML structure line by line."""
    lines = [
        f"{project_name} - Reminder for {send_on.strftime('%B %d, %Y')}",
        "=" * 50,
        "",
        message,
        "",
        "-" * 50,
        f"Manage scheduled reminders: {settings_url}",
        "",
        "AddaxAI Connect - Camera trap image processing",
    ]
    return "\n".join(lines)
