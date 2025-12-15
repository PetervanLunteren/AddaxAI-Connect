"""
Request logging middleware for FastAPI.

Generates unique request_id for each request and injects it into log context.
Logs all incoming requests and outgoing responses with timing information.
"""
import time
import uuid
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from shared.logger import get_logger, set_request_id, set_user_id, clear_context


logger = get_logger("api.middleware")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs all HTTP requests and responses.

    Features:
    - Generates unique request_id for each request
    - Injects request_id into log context
    - Logs request method, path, client IP
    - Logs response status code and duration
    - Injects user_id if authenticated
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate unique request ID
        request_id = str(uuid.uuid4())

        # Inject into log context
        set_request_id(request_id)

        # Extract user ID if authenticated (FastAPI-Users stores user in request.state)
        if hasattr(request.state, "user") and request.state.user:
            set_user_id(str(request.state.user.id))

        # Start timer
        start_time = time.time()

        # Log incoming request
        logger.info(
            "Incoming request",
            method=request.method,
            path=request.url.path,
            query=str(request.url.query) if request.url.query else None,
            client=request.client.host if request.client else None,
        )

        # Process request
        try:
            response = await call_next(request)
        except Exception as exc:
            # Log unhandled exception
            duration = time.time() - start_time
            logger.error(
                "Request failed with exception",
                method=request.method,
                path=request.url.path,
                duration_ms=round(duration * 1000, 2),
                error=str(exc),
                exc_info=True,
            )
            # Clear context before re-raising
            clear_context()
            raise

        # Calculate duration
        duration = time.time() - start_time

        # Log outgoing response
        logger.info(
            "Outgoing response",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round(duration * 1000, 2),
        )

        # Add request_id to response headers for client-side tracking
        response.headers["X-Request-ID"] = request_id

        # Clear log context after request
        clear_context()

        return response
