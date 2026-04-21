"""
Health check endpoints for monitoring system services.

Provides service status information for server admins.
"""
import json
import os
from typing import List, Literal
import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from shared.models import User
from shared.database import get_async_session
from shared.logger import get_logger
from shared.queue import RedisQueue
from auth.permissions import require_server_admin

router = APIRouter(prefix="/api/health", tags=["health"])
logger = get_logger("api.health")


class ServiceStatus(BaseModel):
    """Status information for a single service"""
    name: str
    status: Literal["healthy", "unhealthy"]
    message: str


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
            return ServiceStatus(
                name="cold-tier-watchdog",
                status="healthy",
                message=(
                    f"Last tick {ts}: "
                    f"{hot_gb} GB used of {budget_gb} GB budget, "
                    f"{objects_hot} hot / {objects_cold} cold ({pct_cold:.1f}% cold)"
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


def check_worker_service(name: str, queue_name: str) -> ServiceStatus:
    """
    Check if worker service is alive by checking queue depth.

    Note: This doesn't guarantee the worker is processing, only that
    the queue exists and is accessible. A more robust check would
    require workers to periodically update a heartbeat in Redis.
    """
    try:
        queue = RedisQueue(queue_name)
        depth = queue.queue_depth()

        # If queue is accessible, assume worker service is configured
        # We can't easily check if the worker process is actually running
        # without docker socket access
        return ServiceStatus(
            name=name,
            status="healthy",
            message=f"Queue accessible (depth: {depth})"
        )
    except Exception as e:
        logger.error("Worker health check failed", service=name, error=str(e))
        return ServiceStatus(
            name=name,
            status="unhealthy",
            message=f"Queue error: {str(e)}"
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

    # Worker services (check if their queues are accessible)
    services.append(check_worker_service("ingestion", "image-ingested"))
    services.append(check_worker_service("detection", "image-ingested"))
    services.append(check_worker_service("classification", "detection-complete"))
    services.append(check_worker_service("notifications", "notification-events"))
    services.append(check_worker_service("notifications-telegram", "notification-telegram"))
    services.append(check_cold_tier_watchdog())
    services.append(check_backup())

    logger.info(
        "Health check completed",
        healthy_count=sum(1 for s in services if s.status == "healthy"),
        total_count=len(services)
    )

    return ServicesHealthResponse(services=services)
