"""Disk usage alert — hourly check, email server admins on threshold crossing.

Reads host-root disk stats from the `/host` bind-mount, compares %used
against DISK_ALERT_THRESHOLDS (default "80,90,95"), and emits one email
per threshold crossing (tracked in Redis). A drop below the previous
level resets the tracker, so a subsequent re-crossing will email again.
"""
import os
import socket
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import redis
from sqlalchemy import select

from shared.config import get_settings
from shared.database import get_sync_session
from shared.email_renderer import render_email
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


def _alert_recipient() -> Optional[Tuple[int, str]]:
    """Resolve the single admin email to notify, or None if not configured.

    Reads ADMIN_EMAIL (populated from the ansible admin_email var in .env).
    Disk alerts go only to the server owner, not to every superuser.
    """
    target = os.environ.get("ADMIN_EMAIL", "").strip()
    if not target:
        return None
    with get_sync_session() as db:
        row = db.execute(
            select(User.id, User.email).where(
                User.email == target,
                User.is_active == True,
                User.is_verified == True,
            )
        ).first()
    if not row:
        return None
    return (row.id, row.email)


def _format_gb(n: int) -> str:
    return f"{n / (1024 ** 3):.1f} GB"


def _build_email(pct: float, total: int, used: int, free: int,
                 level: int, hostname: str) -> tuple[str, str, str]:
    subject = f"{hostname} - Disk usage alert ({level}% crossed)"

    total_gb = _format_gb(total)
    used_gb = _format_gb(used)
    free_gb = _format_gb(free)

    text_body = (
        f"{hostname} - Disk usage alert\n"
        f"Crossed {level}% threshold\n"
        f"{'=' * 50}\n"
        f"\n"
        f"{pct:.1f}% of root filesystem used\n"
        f"\n"
        f"Total: {total_gb}\n"
        f"Used:  {used_gb}\n"
        f"Free:  {free_gb}\n"
        f"\n"
        f"This alert will not repeat while usage stays at or above {level}%. "
        f"If usage drops below {level}% and later crosses it again, a fresh alert is sent.\n"
    )

    html_body, _ = render_email(
        "disk_usage_alert.html",
        hostname=hostname,
        threshold=level,
        pct=pct,
        total_gb=total_gb,
        used_gb=used_gb,
        free_gb=free_gb,
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
    recipient = _alert_recipient()
    if not recipient:
        logger.warning(
            "Disk crossed threshold but ADMIN_EMAIL is unset or does not match an active verified user",
            threshold_level=current, pct=round(pct, 1),
        )
        redis_client.set(REDIS_KEY, current)
        return
    user_id, user_email = recipient

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
    except Exception:
        logger.exception("Failed to queue disk alert",
                         user_id=user_id, user_email=user_email)
        return

    redis_client.set(REDIS_KEY, current)
    logger.info("Disk usage alert queued",
                threshold_level=current, pct=round(pct, 1),
                recipient=user_email)
