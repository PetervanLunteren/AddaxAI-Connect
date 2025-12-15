"""
Structured logging module for AddaxAI Connect.

Provides JSON-formatted logging with support for correlation IDs (request_id, image_id)
and context injection. Integrates with Loki for centralized log aggregation.

Usage:
    from shared.logger import get_logger

    logger = get_logger("my-service")
    logger.info("Processing started", image_id="abc-123")
    logger.error("Processing failed", error=str(e), exc_info=True)
"""

import logging
import sys
from contextvars import ContextVar
from typing import Any, Dict, Optional

from pythonjsonlogger import jsonlogger

from shared.config import get_settings

# Context variables for correlation IDs
request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
image_id_var: ContextVar[Optional[str]] = ContextVar("image_id", default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar("user_id", default=None)


class ContextInjectorFilter(logging.Filter):
    """Injects correlation IDs from context into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Inject request_id if present in context
        request_id = request_id_var.get()
        if request_id:
            record.request_id = request_id  # type: ignore

        # Inject image_id if present in context
        image_id = image_id_var.get()
        if image_id:
            record.image_id = image_id  # type: ignore

        # Inject user_id if present in context
        user_id = user_id_var.get()
        if user_id:
            record.user_id = user_id  # type: ignore

        return True


class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """Custom JSON formatter with consistent field names."""

    def add_fields(
        self,
        log_record: Dict[str, Any],
        record: logging.LogRecord,
        message_dict: Dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)

        # Add standard fields
        log_record["timestamp"] = self.formatTime(record, self.datefmt)
        log_record["level"] = record.levelname
        log_record["logger"] = record.name

        # Add correlation IDs if present
        if hasattr(record, "request_id"):
            log_record["request_id"] = record.request_id
        if hasattr(record, "image_id"):
            log_record["image_id"] = record.image_id
        if hasattr(record, "user_id"):
            log_record["user_id"] = record.user_id

        # Add exception info if present
        if record.exc_info:
            log_record["exc_info"] = self.formatException(record.exc_info)


class StructuredLogger:
    """
    Wrapper around logging.Logger that accepts keyword arguments.

    This allows structlog-style logging:
        logger.info("Message", key1="value1", key2="value2")

    Instead of the standard library's:
        logger.info("Message", extra={"key1": "value1", "key2": "value2"})
    """

    def __init__(self, logger: logging.Logger):
        self._logger = logger

    def _log(self, level: int, msg: str, *args: Any, **kwargs: Any) -> None:
        """Internal log method that handles kwargs."""
        # Separate exc_info from other kwargs
        exc_info = kwargs.pop("exc_info", False)

        # All remaining kwargs go into extra
        extra = kwargs if kwargs else {}

        # Call the underlying logger with extra parameter
        self._logger.log(level, msg, *args, extra=extra, exc_info=exc_info)

    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log debug message with optional kwargs."""
        self._log(logging.DEBUG, msg, *args, **kwargs)

    def info(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log info message with optional kwargs."""
        self._log(logging.INFO, msg, *args, **kwargs)

    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log warning message with optional kwargs."""
        self._log(logging.WARNING, msg, *args, **kwargs)

    def error(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log error message with optional kwargs."""
        self._log(logging.ERROR, msg, *args, **kwargs)

    def critical(self, msg: str, *args: Any, **kwargs: Any) -> None:
        """Log critical message with optional kwargs."""
        self._log(logging.CRITICAL, msg, *args, **kwargs)


def get_logger(service_name: str) -> StructuredLogger:
    """
    Get a configured logger for a service.

    Args:
        service_name: Name of the service (e.g., "api", "detection", "ingestion")

    Returns:
        Configured logger instance with JSON formatting and context injection

    Example:
        >>> logger = get_logger("api")
        >>> logger.info("Server started", port=8000)
        {"timestamp": "2025-12-15T10:30:00.000Z", "level": "INFO", ...}
    """
    settings = get_settings()

    # Create logger
    logger = logging.getLogger(service_name)

    # Avoid adding handlers multiple times
    if logger.handlers:
        return logger

    # Set log level from environment
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logger.setLevel(log_level)

    # Create handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    # Add context injector filter
    context_filter = ContextInjectorFilter()
    handler.addFilter(context_filter)

    # Set formatter based on LOG_FORMAT setting
    if settings.log_format.lower() == "json":
        # JSON formatter for production
        formatter = CustomJsonFormatter(
            "%(timestamp)s %(level)s %(logger)s %(message)s",
            rename_fields={"logger": "service"},
            static_fields={"service": service_name},
        )
    else:
        # Human-readable formatter for development
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    handler.setFormatter(formatter)
    logger.addHandler(handler)

    # Don't propagate to root logger (avoid duplicate logs)
    logger.propagate = False

    return StructuredLogger(logger)


def set_request_id(request_id: str) -> None:
    """
    Set request_id in context for current async task.

    Args:
        request_id: Unique identifier for this request (e.g., UUID)

    Example:
        >>> set_request_id("550e8400-e29b-41d4-a716-446655440000")
    """
    request_id_var.set(request_id)


def set_image_id(image_id: str) -> None:
    """
    Set image_id in context for current async task.

    Args:
        image_id: Unique identifier for the image being processed

    Example:
        >>> set_image_id("img-abc-123")
    """
    image_id_var.set(image_id)


def set_user_id(user_id: str) -> None:
    """
    Set user_id in context for current async task.

    Args:
        user_id: Unique identifier for the authenticated user

    Example:
        >>> set_user_id("user-456")
    """
    user_id_var.set(user_id)


def clear_context() -> None:
    """
    Clear all correlation IDs from context.

    Useful at the end of request processing to avoid leaking IDs
    between requests in async environments.
    """
    request_id_var.set(None)
    image_id_var.set(None)
    user_id_var.set(None)
