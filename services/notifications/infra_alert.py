"""Infrastructure alert. Daily check of cold-tier + backup status in Redis.

Sends an email to every verified server admin when either feature's last run
ended in error (or when the backup cron key disappeared, which means the
scheduled run did not happen at all). The two toggles on ServerSettings
gate each feature independently. When the underlying feature is disabled
(BACKUP_ENABLED=false or COLD_TIER_ENABLED=false), no alert fires even if
the toggle is on.

TEMP: during initial verification the same job also emails `admin_email`
on status=ok for both features, so Peter can watch the healthy path from
his inbox. The TEMP block is marked and tracked in TODO.md. Remove once
both features have run clean for a week.
"""
import json
import os
import socket
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import redis
from sqlalchemy import select

from shared.config import get_settings
from shared.database import get_sync_session
from shared.email_renderer import render_email
from shared.logger import get_logger
from shared.models import ServerSettings, User
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL

from db_operations import create_notification_log

logger = get_logger("notifications.infra_alert")
settings = get_settings()


COLD_TIER_REDIS_KEY = "cold_tier:status"
BACKUP_REDIS_KEY = "backup:last_run"


def _alert_recipients() -> List[Tuple[int, str]]:
    """All active verified server admins. Matches disk_usage_alert."""
    with get_sync_session() as db:
        rows = db.execute(
            select(User.id, User.email).where(
                User.is_superuser == True,
                User.is_active == True,
                User.is_verified == True,
            )
        ).all()
    return [(r.id, r.email) for r in rows if r.email]


def _load_toggles() -> Tuple[bool, bool]:
    """Return (notify_backup_failures, notify_cold_tier_failures). Default TRUE
    if the row is missing (fresh server where the migration ran but nothing
    has been saved yet)."""
    with get_sync_session() as db:
        row = db.execute(
            select(
                ServerSettings.notify_backup_failures,
                ServerSettings.notify_cold_tier_failures,
            ).limit(1)
        ).first()
    if not row:
        return (True, True)
    return (row.notify_backup_failures, row.notify_cold_tier_failures)


def _load_status(redis_client, key: str) -> Optional[Dict]:
    raw = redis_client.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Could not parse Redis status payload", key=key, raw=str(raw)[:200])
        return None


def _build_email(feature_label: str, status: str, payload: Dict,
                 hostname: str, extra_fields: Optional[List[Tuple[str, str]]] = None
                 ) -> Tuple[str, str, str]:
    is_error = status == "error"
    headline = f"{'Failure' if is_error else 'Success'}: {feature_label}"
    status_text = "FAILED" if is_error else "OK"
    status_color = "#882000" if is_error else "#0f6064"
    subject_tag = "failed" if is_error else "ok"
    subject = f"{hostname} - {feature_label} {subject_tag}"

    timestamp = payload.get("timestamp", "?")
    duration_s = payload.get("duration_s")
    error_msg = payload.get("error") if is_error else None

    domain = settings.domain_name or hostname
    health_url = f"https://{domain}/server/health"

    html, _ = render_email(
        "infra_alert.html",
        hostname=hostname,
        feature_label=feature_label,
        headline=headline,
        status_text=status_text,
        status_color=status_color,
        timestamp=timestamp,
        duration_s=duration_s,
        extra_fields=extra_fields or [],
        error_msg=error_msg,
        health_url=health_url,
    )

    lines = [
        f"{hostname} - {feature_label} {subject_tag}",
        f"Status: {status_text}",
        f"Last run: {timestamp}",
    ]
    if duration_s is not None:
        lines.append(f"Duration: {duration_s} s")
    for label, value in (extra_fields or []):
        lines.append(f"{label}: {value}")
    if error_msg:
        lines.append("")
        lines.append("Error:")
        lines.append(error_msg)
    lines.append("")
    lines.append(f"Full status: {health_url}")
    text_body = "\n".join(lines)

    return subject, text_body, html


def _queue_email(recipients: List[Tuple[int, str]], subject: str,
                 text_body: str, html_body: str, trigger_data: Dict) -> int:
    """Publish one email per recipient to notification-email. Returns queued count."""
    email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
    queued = 0
    for user_id, user_email in recipients:
        try:
            log_id = create_notification_log(
                user_id=user_id,
                notification_type="infra_alert",
                channel="email",
                trigger_data=trigger_data,
                message_content=text_body[:1000],
            )
            email_queue.publish({
                "notification_log_id": log_id,
                "to_email": user_email,
                "subject": subject,
                "body_text": text_body,
                "body_html": html_body,
            })
            queued += 1
        except Exception:
            logger.exception("Failed to queue infra alert",
                             user_id=user_id, user_email=user_email)
    return queued


def _temp_email_admin(subject: str, text_body: str, html_body: str,
                      trigger_data: Dict) -> None:
    """TEMP: success-path email to admin_email during verification. Remove once
    backup + cold tier have been stable for a week. See TODO.md.
    """
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip()
    if not admin_email:
        return
    with get_sync_session() as db:
        row = db.execute(
            select(User.id).where(User.email == admin_email).limit(1)
        ).first()
    if not row:
        logger.warning("ADMIN_EMAIL not found as a user, skipping TEMP success mail",
                       admin_email=admin_email)
        return
    _queue_email([(row.id, admin_email)], subject, text_body, html_body, trigger_data)


def _check_cold_tier(redis_client, hostname: str, notify_on_failure: bool) -> None:
    if os.environ.get("COLD_TIER_ENABLED", "false").lower() != "true":
        return
    payload = _load_status(redis_client, COLD_TIER_REDIS_KEY)
    if payload is None:
        status = "error"
        payload = {"timestamp": "unknown", "error": "no recent status in Redis (watchdog down or never ticked)"}
    else:
        status = payload.get("status", "error")
    if status == "idle":
        return

    extra: List[Tuple[str, str]] = []
    if payload.get("hot_gb") is not None:
        extra.append(("Hot disk", f"{payload['hot_gb']} GB"))
    if payload.get("budget_gb") is not None:
        extra.append(("Budget", f"{payload['budget_gb']} GB"))
    if payload.get("objects_hot") is not None and payload.get("objects_cold") is not None:
        extra.append(("Objects hot / cold", f"{payload['objects_hot']} / {payload['objects_cold']}"))

    trigger = {"feature": "cold_tier", "status": status, "payload": payload,
               "generated_at": datetime.now(timezone.utc).isoformat()}

    if status == "error" and notify_on_failure:
        recipients = _alert_recipients()
        if not recipients:
            logger.warning("Cold tier failure but no active server admins to notify")
        else:
            subject, text_body, html = _build_email(
                "Cold tier migration", "error", payload, hostname, extra)
            queued = _queue_email(recipients, subject, text_body, html, trigger)
            logger.info("Cold tier failure alert queued",
                        admins_notified=queued, timestamp=payload.get("timestamp"))

    # TEMP: also email admin_email on status=ok. Remove after verification week.
    # See TODO.md entry "revert TEMP success-email branch in infra_alert.py".
    if status == "ok":
        subject, text_body, html = _build_email(
            "Cold tier migration", "ok", payload, hostname, extra)
        _temp_email_admin(subject, text_body, html, trigger)
        logger.info("TEMP cold tier success mail sent", timestamp=payload.get("timestamp"))


def _check_backup(redis_client, hostname: str, notify_on_failure: bool) -> None:
    if os.environ.get("BACKUP_ENABLED", "false").lower() != "true":
        return
    payload = _load_status(redis_client, BACKUP_REDIS_KEY)
    if payload is None:
        status = "error"
        payload = {"timestamp": "unknown", "error": "no recent backup run (expected daily at 02:00 UTC)"}
    else:
        status = payload.get("status", "error")

    trigger = {"feature": "backup", "status": status, "payload": payload,
               "generated_at": datetime.now(timezone.utc).isoformat()}

    if status == "error" and notify_on_failure:
        recipients = _alert_recipients()
        if not recipients:
            logger.warning("Backup failure but no active server admins to notify")
        else:
            subject, text_body, html = _build_email(
                "Automated backup", "error", payload, hostname, [])
            queued = _queue_email(recipients, subject, text_body, html, trigger)
            logger.info("Backup failure alert queued",
                        admins_notified=queued, timestamp=payload.get("timestamp"))

    # TEMP: also email admin_email on status=ok. Remove after verification week.
    # See TODO.md entry "revert TEMP success-email branch in infra_alert.py".
    if status == "ok":
        subject, text_body, html = _build_email(
            "Automated backup", "ok", payload, hostname, [])
        _temp_email_admin(subject, text_body, html, trigger)
        logger.info("TEMP backup success mail sent", timestamp=payload.get("timestamp"))


def check_infra_alerts() -> None:
    logger.info("Running daily infra alert check")
    notify_backup, notify_cold_tier = _load_toggles()
    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    hostname = settings.domain_name or socket.gethostname()

    try:
        _check_cold_tier(redis_client, hostname, notify_cold_tier)
    except Exception:
        logger.exception("Cold tier alert check failed")

    try:
        _check_backup(redis_client, hostname, notify_backup)
    except Exception:
        logger.exception("Backup alert check failed")
