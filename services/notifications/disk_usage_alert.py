"""Disk usage alert — hourly check, email server admins on threshold crossing.

Reads host-root disk stats from the `/host` bind-mount, compares %used
against DISK_ALERT_THRESHOLDS (default "80,90,95"), and emits one email
per threshold crossing (tracked in Redis). A drop below the previous
level resets the tracker, so a subsequent re-crossing will email again.
"""
import os
import socket
from datetime import datetime, timezone
from typing import List

import redis
from sqlalchemy import select

from shared.config import get_settings
from shared.database import get_sync_session
from shared.logger import get_logger
from shared.models import User
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL

from db_operations import create_notification_log

logger = get_logger("notifications.disk_usage_alert")
settings = get_settings()

HOST_ROOT = "/host"
REDIS_KEY = "disk_alert:last_level"
DEFAULT_THRESHOLDS = "80,90,95"


def _parse_thresholds() -> List[int]:
    raw = os.environ.get("DISK_ALERT_THRESHOLDS", DEFAULT_THRESHOLDS)
    try:
        values = sorted({int(v.strip()) for v in raw.split(",") if v.strip()})
    except ValueError:
        logger.error("Invalid DISK_ALERT_THRESHOLDS, falling back to default", raw=raw)
        values = [int(v) for v in DEFAULT_THRESHOLDS.split(",")]
    return [v for v in values if 0 < v < 100]


def _disk_pct_used() -> tuple[float, int, int, int]:
    """Return (pct_used, total_bytes, used_bytes, free_bytes) for host root.

    When /host isn't mounted (e.g. running outside the normal compose stack),
    fall back to the container's own root so the job doesn't crash — callers
    see a reasonable number rather than a failed scheduled job.
    """
    path = HOST_ROOT if os.path.isdir(HOST_ROOT) else "/"
    stat = os.statvfs(path)
    total = stat.f_blocks * stat.f_frsize
    free = stat.f_bavail * stat.f_frsize
    used = total - free
    pct = (used / total * 100) if total else 0.0
    return pct, total, used, free


def _current_level(pct: float, thresholds: List[int]) -> int:
    """Highest threshold that pct has crossed, or 0 if below all."""
    crossed = [t for t in thresholds if pct >= t]
    return max(crossed) if crossed else 0


def _load_last_level(redis_client) -> int:
    raw = redis_client.get(REDIS_KEY)
    if not raw:
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _server_admin_emails() -> List[tuple[int, str]]:
    with get_sync_session() as db:
        rows = db.execute(
            select(User).where(
                User.is_superuser == True,
                User.is_active == True,
                User.is_verified == True,
            )
        ).scalars().all()
        return [(u.id, u.email) for u in rows if u.email]


def _format_gb(n: int) -> str:
    return f"{n / (1024 ** 3):.1f} GB"


def _build_email(pct: float, total: int, used: int, free: int,
                 level: int, hostname: str) -> tuple[str, str, str]:
    subject = f"[AddaxAI] Disk on {hostname} crossed {level}% ({pct:.1f}% used)"

    text_body = (
        f"Disk usage on {hostname} has crossed the {level}% threshold.\n"
        f"\n"
        f"Total:   {_format_gb(total)}\n"
        f"Used:    {_format_gb(used)} ({pct:.1f}%)\n"
        f"Free:    {_format_gb(free)}\n"
        f"\n"
        f"Suggested actions:\n"
        f"  - docker builder prune -af  (reclaim build cache)\n"
        f"  - Check docs/operations.md > Cold storage tier for cold-tier status\n"
        f"  - Review data/minio/ and data/postgres/ growth\n"
        f"\n"
        f"This alert will not repeat while usage stays at or above {level}%.\n"
        f"If usage drops below {level}% and crosses it again, a new alert is sent.\n"
    )

    html_body = (
        f"<h2>Disk usage on {hostname} crossed {level}%</h2>"
        f"<p><strong>{pct:.1f}% used</strong> "
        f"— {_format_gb(used)} of {_format_gb(total)}, {_format_gb(free)} free.</p>"
        f"<h3>Suggested actions</h3>"
        f"<ul>"
        f"<li><code>docker builder prune -af</code> (reclaim build cache)</li>"
        f"<li>Check the Cold storage tier section of <code>docs/operations.md</code></li>"
        f"<li>Review growth of <code>data/minio/</code> and <code>data/postgres/</code></li>"
        f"</ul>"
        f"<p>This alert will not repeat while usage stays at or above {level}%.</p>"
    )
    return subject, text_body, html_body


def check_disk_usage_and_alert() -> None:
    thresholds = _parse_thresholds()
    if not thresholds:
        logger.info("No disk alert thresholds configured, skipping")
        return

    pct, total, used, free = _disk_pct_used()
    logger.info(
        "Disk usage check",
        pct_used=round(pct, 1),
        total_gb=round(total / (1024 ** 3), 1),
        used_gb=round(used / (1024 ** 3), 1),
        free_gb=round(free / (1024 ** 3), 1),
        thresholds=thresholds,
    )

    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    last_level = _load_last_level(redis_client)
    current = _current_level(pct, thresholds)

    if current == last_level:
        return

    if current < last_level:
        # Usage dropped below the previously-emailed threshold; reset so a
        # future re-crossing triggers a fresh email.
        redis_client.set(REDIS_KEY, current)
        logger.info("Disk usage dropped, resetting alert level",
                    old_level=last_level, new_level=current)
        return

    # current > last_level → fire alert for `current`
    admins = _server_admin_emails()
    if not admins:
        logger.warning("Disk crossed threshold but no active server admins to notify",
                       threshold_level=current, pct=round(pct, 1))
        redis_client.set(REDIS_KEY, current)
        return

    hostname = settings.domain_name or socket.gethostname()
    subject, text_body, html_body = _build_email(pct, total, used, free, current, hostname)
    trigger_data = {
        "threshold_pct": current,
        "current_pct": round(pct, 2),
        "total_gb": round(total / (1024 ** 3), 2),
        "used_gb": round(used / (1024 ** 3), 2),
        "free_gb": round(free / (1024 ** 3), 2),
        "hostname": hostname,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
    queued = 0
    for user_id, user_email in admins:
        try:
            log_id = create_notification_log(
                user_id=user_id,
                notification_type="disk_usage_alert",
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
            logger.exception("Failed to queue disk alert",
                             user_id=user_id, user_email=user_email)

    redis_client.set(REDIS_KEY, current)
    logger.info("Disk usage alert queued",
                threshold_level=current, pct=round(pct, 1), admins_notified=queued)
