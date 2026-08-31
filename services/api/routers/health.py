"""
Health check endpoints for monitoring system services.

Provides service status information for server admins.
"""
import json
import os
from datetime import datetime, timezone
from typing import List, Literal, Optional
import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from shared.models import User
from shared.database import get_async_session
from shared.logger import get_logger
from shared.queue import (
    RedisQueue,
    QUEUE_IMAGE_INGESTED,
    QUEUE_DETECTION_COMPLETE,
    QUEUE_NOTIFICATION_EVENTS,
    QUEUE_NOTIFICATION_EMAIL,
    QUEUE_NOTIFICATION_TELEGRAM,
    QUEUE_NOTIFICATION_EARTHRANGER,
    HEARTBEAT_KEY_INGESTION,
    HEARTBEAT_KEY_DETECTION,
    HEARTBEAT_KEY_CLASSIFICATION,
    DEVICE_KEY_DETECTION,
    DEVICE_KEY_CLASSIFICATION,
    HEARTBEAT_KEY_NOTIFICATIONS,
    HEARTBEAT_KEY_NOTIFICATIONS_EMAIL,
    HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM,
    HEARTBEAT_KEY_NOTIFICATIONS_EARTHRANGER,
    HEARTBEAT_STALE_AFTER_MINUTES,
    parse_heartbeat,
)
from auth.permissions import require_server_admin

router = APIRouter(prefix="/api/health", tags=["health"])
logger = get_logger("api.health")


class ServiceStatus(BaseModel):
    """Status information for a single service"""
    name: str
    status: Literal["healthy", "unhealthy"]
    message: str
    # "cpu" or "cuda" for the ML workers, only while healthy. None elsewhere.
    device: Optional[str] = None


class ServicesHealthResponse(BaseModel):
    """Response containing status of all services"""
    services: List[ServiceStatus]


async def check_postgres(db: AsyncSession) -> ServiceStatus:
    """Check PostgreSQL database connectivity"""
    try:
        result = await db.execute(text("SELECT 1"))
        result.scalar()
        return ServiceStatus(
            name="postgres",
            status="healthy",
            message="Database connection successful"
        )
    except Exception as e:
        logger.error("PostgreSQL health check failed", error=str(e))
        return ServiceStatus(
            name="postgres",
            status="unhealthy",
            message=f"Database error: {str(e)}"
        )


def check_redis() -> ServiceStatus:
    """Check Redis connectivity"""
    try:
        queue = RedisQueue("health-check")
        queue.client.ping()
        return ServiceStatus(
            name="redis",
            status="healthy",
            message="Redis connection successful"
        )
    except Exception as e:
        logger.error("Redis health check failed", error=str(e))
        return ServiceStatus(
            name="redis",
            status="unhealthy",
            message=f"Redis error: {str(e)}"
        )


async def check_http_service(name: str, url: str) -> ServiceStatus:
    """Check HTTP service availability"""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(url)
            if response.status_code < 500:
                return ServiceStatus(
                    name=name,
                    status="healthy",
                    message=f"Service responding (HTTP {response.status_code})"
                )
            else:
                return ServiceStatus(
                    name=name,
                    status="unhealthy",
                    message=f"Service error (HTTP {response.status_code})"
                )
    except httpx.TimeoutException:
        logger.warning("HTTP health check timeout", service=name, url=url)
        return ServiceStatus(
            name=name,
            status="unhealthy",
            message="Connection timeout"
        )
    except Exception as e:
        logger.error("HTTP health check failed", service=name, url=url, error=str(e))
        return ServiceStatus(
            name=name,
            status="unhealthy",
            message=f"Connection failed: {str(e)}"
        )


def check_cold_tier_watchdog() -> ServiceStatus:
    """Check cold-tier watchdog status from Redis.

    The watchdog writes `cold_tier:status` on every tick with a TTL of
    3x its tick interval. A missing key means the watchdog hasn't ticked
    recently (container down or Wasabi unreachable for multiple cycles).
    """
    try:
        queue = RedisQueue("health-check")
        raw = queue.client.get("cold_tier:status")
        if not raw:
            return ServiceStatus(
                name="cold-tier-watchdog",
                status="unhealthy",
                message="No recent status in Redis (watchdog down or never ticked)",
            )
        payload = json.loads(raw)
        state = payload.get("status")
        if state == "idle":
            return ServiceStatus(
                name="cold-tier-watchdog",
                status="healthy",
                message="Cold tier disabled (COLD_TIER_ENABLED=false)",
            )
        if state == "ok":
            hot_gb = payload.get("hot_gb", "?")
            budget_gb = payload.get("budget_gb", "?")
            objects_hot = payload.get("objects_hot", 0)
            objects_cold = payload.get("objects_cold", 0)
            total = objects_hot + objects_cold
            pct_cold = (objects_cold / total * 100) if total else 0.0
            ts = payload.get("timestamp", "?")
            # Over budget right after a tick is normal, the objects were
            # tagged seconds ago and MinIO has not run its scanner yet. Say
            # so, otherwise a healthy row reads as a contradiction.
            waiting = (
                ", tagged and waiting for the storage scanner to move them"
                if payload.get("waiting_for_ilm") else ""
            )
            return ServiceStatus(
                name="cold-tier-watchdog",
                status="healthy",
                message=(
                    f"Last tick {ts}: "
                    f"{hot_gb} GB used of {budget_gb} GB budget, "
                    f"{objects_hot} hot / {objects_cold} cold ({pct_cold:.1f}% cold)"
                    f"{waiting}"
                ),
            )
        err = payload.get("error", "unknown error")
        return ServiceStatus(
            name="cold-tier-watchdog",
            status="unhealthy",
            message=f"Last tick failed: {err}",
        )
    except Exception as e:
        logger.error("Cold-tier watchdog health check failed", error=str(e))
        return ServiceStatus(
            name="cold-tier-watchdog",
            status="unhealthy",
            message=f"Redis error: {str(e)}",
        )


def check_backup() -> ServiceStatus:
    """Check automated backup status from Redis.

    The host-side backup script writes `backup:last_run` on every run with a
    3-day TTL. A missing key when backups are enabled means the cron hasn't
    run in ~3 days (failure or misconfiguration).
    """
    enabled = os.environ.get("BACKUP_ENABLED", "false").lower() == "true"
    try:
        queue = RedisQueue("health-check")
        raw = queue.client.get("backup:last_run")
        if not raw:
            if not enabled:
                return ServiceStatus(
                    name="backup",
                    status="healthy",
                    message="Backups disabled (BACKUP_ENABLED=false)",
                )
            return ServiceStatus(
                name="backup",
                status="unhealthy",
                message="No recent backup run (last expected at 02:00 UTC)",
            )
        payload = json.loads(raw)
        state = payload.get("status")
        ts = payload.get("timestamp", "?")
        duration = payload.get("duration_s", "?")
        if state == "ok":
            return ServiceStatus(
                name="backup",
                status="healthy",
                message=f"Last backup {ts} (took {duration}s)",
            )
        if state == "skipped":
            # Backup deliberately skipped (restore in progress or freshly
            # provisioned server). Surface as healthy with the reason so the
            # health page does not look broken in those windows.
            reason = payload.get("error", "skipped")
            return ServiceStatus(
                name="backup",
                status="healthy",
                message=f"Backup skipped at {ts}: {reason}",
            )
        err = payload.get("error", "unknown error")
        return ServiceStatus(
            name="backup",
            status="unhealthy",
            message=f"Last backup failed at {ts}: {err}",
        )
    except Exception as e:
        logger.error("Backup health check failed", error=str(e))
        return ServiceStatus(
            name="backup",
            status="unhealthy",
            message=f"Redis error: {str(e)}",
        )


def check_heartbeat(
    name: str,
    heartbeat_key: str,
    queue_name: Optional[str] = None,
    device_key: Optional[str] = None,
) -> ServiceStatus:
    """
    Check a worker through its Redis heartbeat.

    The worker stamps the key at the top of every loop iteration (see
    shared.queue.consume_forever and consume_forever_priority), so a
    fresh stamp proves the loop is actually alive. An earlier version of
    this endpoint asked whether the worker's queue was readable, which
    only ever caught Redis being down: it reported three workers healthy
    on a server running none of them.

    With a queue_name the message carries the backlog waiting for that
    worker. Ingestion has none to report, it watches the filesystem and
    publishes rather than consumes, and naming the queue it publishes to
    would show the detection backlog on the ingestion row.

    With a device_key the row carries the device the ML worker loaded its
    model on (see RedisQueue.record_device), but only when the row is
    healthy. The key has no TTL, so on a dead worker it would repeat what
    was true before the crash.
    """
    try:
        queue = RedisQueue(queue_name or "health-check")
        depth = queue.queue_depth() if queue_name else None
        # Same tolerant parse as the delivery liveness check, so a
        # missing key and an unreadable value classify identically
        last_seen = parse_heartbeat(queue.client.get(heartbeat_key))
        if last_seen is None:
            return ServiceStatus(
                name=name,
                status="unhealthy",
                message="No heartbeat recorded (worker never started)",
            )
        age = datetime.now(timezone.utc) - last_seen
        age_seconds = int(age.total_seconds())
        if age_seconds < 0:
            # A stamp from the future means clock skew, not an outage
            age_label = "just now"
        elif age_seconds < 120:
            age_label = f"{age_seconds} s ago"
        else:
            age_label = f"{age_seconds // 60} min ago"
        depth_label = f" (queue depth {depth})" if depth is not None else ""
        if age.total_seconds() > HEARTBEAT_STALE_AFTER_MINUTES * 60:
            return ServiceStatus(
                name=name,
                status="unhealthy",
                message=(
                    f"Last heartbeat {age_label}, stale after "
                    f"{HEARTBEAT_STALE_AFTER_MINUTES} min{depth_label}"
                ),
            )
        device = queue.client.get(device_key) if device_key else None
        return ServiceStatus(
            name=name,
            status="healthy",
            message=f"Last heartbeat {age_label}{depth_label}",
            device=device,
        )
    except Exception as e:
        logger.error("Heartbeat health check failed", service=name, error=str(e))
        return ServiceStatus(
            name=name,
            status="unhealthy",
            message=f"Heartbeat check error: {str(e)}",
        )


@router.get("/services", response_model=ServicesHealthResponse)
async def get_services_health(
    current_user: User = Depends(require_server_admin),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get health status of all system services (server admin only)

    Checks connectivity to infrastructure services (PostgreSQL, Redis, MinIO)
    and attempts to verify worker services are accessible.

    Args:
        current_user: Current authenticated server admin
        db: Database session

    Returns:
        Status of all services
    """
    logger.info("Health check requested", user_id=current_user.id)

    # Check all services
    services = []

    # Infrastructure services
    services.append(await check_postgres(db))
    services.append(check_redis())
    services.append(await check_http_service("minio", "http://minio:9000/minio/health/live"))

    # API (self)
    services.append(ServiceStatus(
        name="api",
        status="healthy",
        message="Service is running"
    ))

    # Frontend
    services.append(await check_http_service("frontend", "http://frontend:80"))

    # Every worker row is a real heartbeat, stamped by the worker itself at
    # the top of its own loop. Ingestion passes no queue: it watches the
    # filesystem, so there is no backlog of its own to report.
    services.append(check_heartbeat("ingestion", HEARTBEAT_KEY_INGESTION))
    services.append(check_heartbeat("detection", HEARTBEAT_KEY_DETECTION, QUEUE_IMAGE_INGESTED, DEVICE_KEY_DETECTION))
    services.append(check_heartbeat("classification", HEARTBEAT_KEY_CLASSIFICATION, QUEUE_DETECTION_COMPLETE, DEVICE_KEY_CLASSIFICATION))
    services.append(check_heartbeat("notifications", HEARTBEAT_KEY_NOTIFICATIONS, QUEUE_NOTIFICATION_EVENTS))
    services.append(check_heartbeat("notifications-email", HEARTBEAT_KEY_NOTIFICATIONS_EMAIL, QUEUE_NOTIFICATION_EMAIL))
    services.append(check_heartbeat("notifications-telegram", HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM, QUEUE_NOTIFICATION_TELEGRAM))
    services.append(check_heartbeat("notifications-earthranger", HEARTBEAT_KEY_NOTIFICATIONS_EARTHRANGER, QUEUE_NOTIFICATION_EARTHRANGER))
    services.append(check_cold_tier_watchdog())
    services.append(check_backup())

    logger.info(
        "Health check completed",
        healthy_count=sum(1 for s in services if s.status == "healthy"),
        total_count=len(services)
    )

    return ServicesHealthResponse(services=services)
