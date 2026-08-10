"""Delivery worker liveness — hourly check of the notification workers.

The email and telegram delivery workers stamp a heartbeat key in Redis
every consume-loop iteration (see shared.queue.consume_forever). This
check runs hourly at :15 and raises an alarm when a heartbeat has gone
stale or a delivery queue has grown past a fixed depth, which catches a
worker that is alive but stuck. Without it a dead delivery worker is
invisible: the queues accept publishes with no consumer, and messages
pile up silently (it happened twice before this existed).

Alerts go to every server admin on both channels at once, email and
Telegram. A dead worker cannot deliver its own obituary, so the copy in
its queue simply waits for the restart while the other channel carries
the signal. When both workers are down, the server health page is the
remaining signal.

Once per incident: the Redis state key holds the worker names already
alerted for. A worker that recovers drops out of the state silently,
which re-arms it; there is no recovery notification. The notifications
coordinator runs this check and therefore cannot check itself; its own
heartbeat is surfaced by the API health endpoint.
"""
import json
import socket
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

import redis
from sqlalchemy import select

from shared.config import get_settings
from shared.database import get_sync_session
from shared.logger import get_logger
from shared.models import ProjectNotificationPreference, User
from shared.queue import (
    RedisQueue,
    QUEUE_NOTIFICATION_EMAIL,
    QUEUE_NOTIFICATION_TELEGRAM,
    HEARTBEAT_KEY_NOTIFICATIONS_EMAIL,
    HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM,
    HEARTBEAT_STALE_AFTER_MINUTES,
)

from db_operations import create_notification_log
from infra_alert import _alert_recipients, _build_email

logger = get_logger("notifications.delivery_liveness")
settings = get_settings()

STALE_AFTER = timedelta(minutes=HEARTBEAT_STALE_AFTER_MINUTES)
QUEUE_DEPTH_ALERT = 200
STATE_REDIS_KEY = "delivery_liveness:alerted"

# (worker name, heartbeat key, queue it consumes). The names match the
# health page rows.
WORKERS = [
    ("notifications-email", HEARTBEAT_KEY_NOTIFICATIONS_EMAIL, QUEUE_NOTIFICATION_EMAIL),
    ("notifications-telegram", HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM, QUEUE_NOTIFICATION_TELEGRAM),
]


def parse_heartbeat(raw: Optional[str]) -> Optional[datetime]:
    """Parse a stored heartbeat stamp. None on missing or garbage."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def heartbeat_stale(last_seen: Optional[datetime], now: datetime) -> bool:
    """A heartbeat is stale when it is missing or older than the
    threshold. Missing means the worker never ran against this Redis,
    which is the outage this check exists to catch."""
    return last_seen is None or (now - last_seen) > STALE_AFTER


def worker_problem(
    last_seen: Optional[datetime], queue_name: str, depth: int, now: datetime
) -> Optional[str]:
    """One human-readable reason when the worker is unhealthy, else None.

    Both conditions can hold at once; they make one incident with one
    combined reason, not two alerts.
    """
    reasons = []
    if heartbeat_stale(last_seen, now):
        if last_seen is None:
            reasons.append("no heartbeat ever recorded")
        else:
            days = (now - last_seen).days
            ago = f"{days} day{'s' if days != 1 else ''} ago" if days else "today"
            reasons.append(f"no heartbeat since {last_seen.isoformat()} ({ago})")
    if depth > QUEUE_DEPTH_ALERT:
        if reasons:
            reasons.append(f"queue {queue_name} depth {depth} over {QUEUE_DEPTH_ALERT}")
        else:
            reasons.append(
                f"queue {queue_name} depth {depth} over {QUEUE_DEPTH_ALERT} "
                "(heartbeat fresh, worker draining too slowly)"
            )
    return "; ".join(reasons) if reasons else None


def split_incidents(
    unhealthy: List[str], previously_alerted: List[str]
) -> Tuple[List[str], List[str], List[str]]:
    """Split unhealthy workers into (new, ongoing, recovered)."""
    bad = set(unhealthy)
    prev = set(previously_alerted or [])
    return sorted(bad - prev), sorted(bad & prev), sorted(prev - bad)


def check_delivery_liveness() -> None:
    """Scheduled job. Alert server admins about delivery workers that
    stopped heartbeating or whose queue is piling up."""
    logger.info("Running delivery liveness check")
    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    now = datetime.now(timezone.utc)
    hostname = settings.domain_name or socket.gethostname()

    problems = {}
    for name, heartbeat_key, queue_name in WORKERS:
        last_seen = parse_heartbeat(redis_client.get(heartbeat_key))
        depth = RedisQueue(queue_name).queue_depth()
        reason = worker_problem(last_seen, queue_name, depth, now)
        if reason:
            problems[name] = (reason, last_seen, queue_name, depth)

    previously = _load_state(redis_client)
    new, ongoing, recovered = split_incidents(list(problems.keys()), previously)

    for name in new:
        reason, last_seen, queue_name, depth = problems[name]
        try:
            _send_alerts(name, reason, last_seen, queue_name, depth, hostname)
        except Exception:
            logger.exception("Failed to send liveness alert", worker=name)

    next_state = sorted(set(new) | set(ongoing))
    if next_state != sorted(previously):
        redis_client.set(STATE_REDIS_KEY, json.dumps(next_state))

    logger.info(
        "Delivery liveness check complete",
        unhealthy=sorted(problems.keys()),
        new=new,
        ongoing=ongoing,
        recovered=recovered,
    )


def _load_state(redis_client) -> List[str]:
    """Worker names already alerted for. Missing or garbage reads as
    empty, so a wiped Redis re-alerts rather than staying silent."""
    raw = redis_client.get(STATE_REDIS_KEY)
    if not raw:
        return []
    try:
        state = json.loads(raw)
        return state if isinstance(state, list) else []
    except json.JSONDecodeError:
        return []


def _admin_telegram_chats() -> List[Tuple[int, str]]:
    """(user_id, chat_id) for every server admin with a linked Telegram
    chat, deduped by chat id so an admin linked in several projects gets
    one message."""
    with get_sync_session() as db:
        rows = db.execute(
            select(User.id, ProjectNotificationPreference.telegram_chat_id)
            .join(
                ProjectNotificationPreference,
                ProjectNotificationPreference.user_id == User.id,
            )
            .where(
                User.is_superuser == True,
                User.is_active == True,
                User.is_verified == True,
                ProjectNotificationPreference.telegram_chat_id.isnot(None),
            )
        ).all()
    seen = set()
    chats = []
    for user_id, chat_id in rows:
        if chat_id not in seen:
            seen.add(chat_id)
            chats.append((user_id, chat_id))
    return chats


def _send_alerts(
    worker_name: str,
    reason: str,
    last_seen: Optional[datetime],
    queue_name: str,
    depth: int,
    hostname: str,
) -> None:
    """One alert about one worker, queued to both channels for every
    server admin. The dead worker's own copy waits in its queue and
    arrives after the restart, which is harmless."""
    feature_label = (
        "Email delivery worker" if worker_name == "notifications-email"
        else "Telegram delivery worker"
    )
    domain = settings.domain_name or hostname
    health_url = f"https://{domain}/server/health"

    trigger_data = {
        "worker": worker_name,
        "reason": reason,
        "queue": queue_name,
        "queue_depth": depth,
        "last_seen": last_seen.isoformat() if last_seen else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Email to all server admins, template shared with the infra alerts
    payload = {
        "timestamp": last_seen.isoformat() if last_seen else "never",
        "error": reason,
    }
    extra = [
        ("Queue", queue_name),
        ("Queue depth", str(depth)),
        ("Stale after", f"{HEARTBEAT_STALE_AFTER_MINUTES} min"),
    ]
    subject, text_body, html = _build_email(feature_label, payload, hostname, extra)

    email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
    emails_queued = 0
    for user_id, user_email in _alert_recipients():
        log_id = create_notification_log(
            user_id=user_id,
            notification_type="delivery_liveness_alert",
            channel="email",
            trigger_data=trigger_data,
            message_content=text_body[:1000],
        )
        email_queue.publish({
            "notification_log_id": log_id,
            "to_email": user_email,
            "subject": subject,
            "body_text": text_body,
            "body_html": html,
        })
        emails_queued += 1

    # Telegram to every admin with a linked chat
    label = "email" if worker_name == "notifications-email" else "telegram"
    message_lines = [
        f"*{hostname}: {label} delivery worker down*",
        reason.capitalize() + ".",
        f"Queue {queue_name} depth {depth}.",
    ]
    message_text = "\n".join(message_lines)

    telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)
    telegrams_queued = 0
    for user_id, chat_id in _admin_telegram_chats():
        log_id = create_notification_log(
            user_id=user_id,
            notification_type="delivery_liveness_alert",
            channel="telegram",
            trigger_data=trigger_data,
            message_content=message_text[:1000],
        )
        telegram_queue.publish({
            "notification_log_id": log_id,
            "chat_id": chat_id,
            "message_text": message_text,
            "annotated_minio_path": None,
            "reply_markup": {
                "inline_keyboard": [[{"text": "Open health page", "url": health_url}]]
            },
        })
        telegrams_queued += 1

    logger.info(
        "Queued delivery liveness alert",
        worker=worker_name,
        reason=reason,
        emails=emails_queued,
        telegrams=telegrams_queued,
    )
