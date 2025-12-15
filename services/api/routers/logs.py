"""
Logs API endpoint for frontend logging.

Allows frontend to send logs to backend for centralized logging in Loki.
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict, Any
from slowapi import Limiter
from slowapi.util import get_remote_address

from shared.logger import get_logger
from auth.users import current_active_user
from shared.models import User


router = APIRouter()
logger = get_logger("api.logs")

# Rate limiter: 100 requests per minute per IP
limiter = Limiter(key_func=get_remote_address)


class LogEntry(BaseModel):
    """
    Frontend log entry.

    Attributes:
        level: Log level (info, warn, error, debug)
        message: Log message
        context: Additional context (page URL, component, error stack, etc.)
    """

    level: str = Field(..., description="Log level")
    message: str = Field(..., description="Log message", max_length=1000)
    context: Optional[Dict[str, Any]] = Field(
        default=None, description="Additional context"
    )

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: str) -> str:
        """Validate log level is one of the allowed values."""
        allowed_levels = ["info", "warn", "error", "debug"]
        if v.lower() not in allowed_levels:
            raise ValueError(f"Level must be one of: {', '.join(allowed_levels)}")
        return v.lower()


@router.post(
    "/logs",
    status_code=201,
    summary="Submit frontend log",
    description="Allows frontend to send logs to backend for centralized logging",
)
@limiter.limit("100/minute")
async def submit_log(
    log_entry: LogEntry,
    request: Request,
    user: Optional[User] = Depends(current_active_user),
) -> Dict[str, str]:
    """
    Submit a log entry from the frontend.

    Rate limit: 100 requests per minute per IP address.

    Args:
        log_entry: Log entry to submit
        request: FastAPI request (for rate limiting)
        user: Current authenticated user (optional)

    Returns:
        Success message with request_id

    Raises:
        HTTPException: If rate limit exceeded (429)
    """
    # Extract context
    context = log_entry.context or {}

    # Add user_id if authenticated
    if user:
        context["user_id"] = user.id
        context["user_email"] = user.email

    # Add frontend marker
    context["source"] = "frontend"

    # Log based on level
    log_func = getattr(logger, log_entry.level)
    log_func(log_entry.message, **context)

    return {"status": "ok", "message": "Log submitted successfully"}
