"""Infrastructure alert. Daily check of cold-tier, backup and security status
in Redis.

Sends an email to every verified server admin when a feature's last run ended
in error (or when the backup cron key disappeared, which means the scheduled
run did not happen at all). The three toggles on ServerSettings gate each
feature independently. When the underlying feature is disabled
(BACKUP_ENABLED=false or COLD_TIER_ENABLED=false), no alert fires even if
the toggle is on.

The security status is written by scripts/security-status.sh, which runs the
same security check ansible runs at the end of a deploy. It is server-wide and
goes to server admins only, like the other two: the security state belongs to
the machine rather than to a project, and telling a project viewer that the
server has an unpatched kernel only spreads a list of weak spots to people who
cannot act on it.
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
SECURITY_REDIS_KEY = "security:last_check"

# How old the security status may get before the check is treated as dead.
# Two missed daily runs, so a single skipped night is not an alert.
SECURITY_STALE_HOURS = 48


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


def _load_toggles() -> Tuple[bool, bool, bool]:
    """Return (notify_backup_failures, notify_cold_tier_failures,
    notify_security_failures). Default TRUE if the row is missing (fresh
    server where the migration ran but nothing has been saved yet)."""
    with get_sync_session() as db:
        row = db.execute(
            select(
                ServerSettings.notify_backup_failures,
                ServerSettings.notify_cold_tier_failures,
                ServerSettings.notify_security_failures,
            ).limit(1)
        ).first()
    if not row:
        return (True, True, True)
    return (row.notify_backup_failures,
            row.notify_cold_tier_failures,
            row.notify_security_failures)


def _load_status(redis_client, key: str) -> Optional[Dict]:
    raw = redis_client.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Could not parse Redis status payload", key=key, raw=str(raw)[:200])
        return None


def _build_email(feature_label: str, payload: Dict,
                 hostname: str, extra_fields: Optional[List[Tuple[str, str]]] = None
                 ) -> Tuple[str, str, str]:
    headline = f"Failure: {feature_label}"
    status_text = "FAILED"
    status_color = "#882000"
    subject = f"{hostname} - {feature_label} failed"

    timestamp = payload.get("timestamp", "?")
    duration_s = payload.get("duration_s")
    error_msg = payload.get("error")

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
        f"{hostname} - {feature_label} failed",
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
                "Cold tier migration", payload, hostname, extra)
            queued = _queue_email(recipients, subject, text_body, html, trigger)
            logger.info("Cold tier failure alert queued",
                        admins_notified=queued, timestamp=payload.get("timestamp"))


def _check_backup(redis_client, hostname: str, notify_on_failure: bool) -> None:
    if os.environ.get("BACKUP_ENABLED", "false").lower() != "true":
        return
    payload = _load_status(redis_client, BACKUP_REDIS_KEY)
    if payload is None:
        status = "error"
        payload = {"timestamp": "unknown", "error": "no recent backup run (expected daily at 02:00 UTC)"}
    else:
        status = payload.get("status", "error")

    # Deliberately-skipped runs (restore in progress, fresh-server window)
    # write status="skipped" so we know the backup did not run on purpose.
    # Treat the same way _check_cold_tier treats "idle": no email, no fuss.
    if status == "skipped":
        logger.info(
            "Backup deliberately skipped, not alerting",
            reason=payload.get("error"),
            timestamp=payload.get("timestamp"),
        )
        return

    trigger = {"feature": "backup", "status": status, "payload": payload,
               "generated_at": datetime.now(timezone.utc).isoformat()}

    if status == "error" and notify_on_failure:
        recipients = _alert_recipients()
        if not recipients:
            logger.warning("Backup failure but no active server admins to notify")
        else:
            subject, text_body, html = _build_email(
                "Automated backup", payload, hostname, [])
            queued = _queue_email(recipients, subject, text_body, html, trigger)
            logger.info("Backup failure alert queued",
                        admins_notified=queued, timestamp=payload.get("timestamp"))


def _hours_since(timestamp: Optional[str]) -> Optional[float]:
    """Age of an ISO timestamp in hours, or None when it cannot be read."""
    if not timestamp:
        return None
    try:
        when = datetime.fromisoformat(timestamp)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - when).total_seconds() / 3600


def _check_security(redis_client, hostname: str, notify_on_failure: bool) -> None:
    payload = _load_status(redis_client, SECURITY_REDIS_KEY)

    # No key at all means scripts/security-status.sh has never run here, which
    # is a server that has not had the ansible playbook applied yet, not an
    # insecure one. The worker code arrives with a git pull and the cron with
    # ansible, so alerting on a missing key would fire on every server that
    # took a code-only update. Staleness below covers a cron that dies.
    if payload is None:
        logger.info("No security check status in Redis, nothing to report")
        return

    status = payload.get("status", "fail")

    age_h = _hours_since(payload.get("timestamp"))
    if age_h is not None and age_h > SECURITY_STALE_HOURS:
        payload = dict(payload)
        status = "fail"
        payload["error"] = (
            f"the security check last ran {int(age_h)} hours ago, "
            "expected daily at 02:30 UTC"
        )

    extra: List[Tuple[str, str]] = []
    if payload.get("passed") is not None:
        extra.append(("Checks passed", str(payload["passed"])))
    if payload.get("failed") is not None:
        extra.append(("Checks failed", str(payload["failed"])))
    if payload.get("warnings") is not None:
        extra.append(("Warnings", str(payload["warnings"])))

    trigger = {"feature": "security", "status": status, "payload": payload,
               "generated_at": datetime.now(timezone.utc).isoformat()}

    if status != "ok" and notify_on_failure:
        recipients = _alert_recipients()
        if not recipients:
            logger.warning("Security check failure but no active server admins to notify")
        else:
            subject, text_body, html = _build_email(
                "Security check", payload, hostname, extra)
            queued = _queue_email(recipients, subject, text_body, html, trigger)
            logger.info("Security check failure alert queued",
                        admins_notified=queued, timestamp=payload.get("timestamp"))


def check_infra_alerts() -> None:
    logger.info("Running daily infra alert check")
    notify_backup, notify_cold_tier, notify_security = _load_toggles()
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

    try:
        _check_security(redis_client, hostname, notify_security)
    except Exception:
        logger.exception("Security alert check failed")
