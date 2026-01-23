"""
Health check endpoints for monitoring system services.

Provides service status information for server admins.
"""
import httpx
from typing import List, Literal
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
    services.append(await check_http_service("prometheus", "http://prometheus:9090/-/healthy"))
    services.append(await check_http_service("loki", "http://loki:3100/ready"))

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

    logger.info(
        "Health check completed",
        healthy_count=sum(1 for s in services if s.status == "healthy"),
        total_count=len(services)
    )

    return ServicesHealthResponse(services=services)
