"""Tests for the structured logger wrapper."""
from shared.logger import get_logger


def test_exception_logs_inside_except_block():
    """logger.exception must work like logging.Logger.exception. Several
    alert error handlers rely on it; before the method existed they
    raised AttributeError instead of logging (found 10 Aug 2026)."""
    logger = get_logger("test-logger")
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        logger.exception("Something failed", worker="notifications-email")


def test_exception_outside_except_block_does_not_raise():
    get_logger("test-logger").exception("No active exception")
