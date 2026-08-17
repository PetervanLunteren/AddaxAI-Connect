"""Tests for the structured logger wrapper."""
import logging

import pytest

from shared.logger import _RESERVED_LOGRECORD_KEYS, get_logger


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


class _Capture(logging.Handler):
    """Collects records off one logger. get_logger sets propagate=False,
    so caplog, which listens on the root logger, sees nothing."""

    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


@pytest.fixture
def captured():
    """(structured logger, handler holding its records)."""
    log = get_logger("test-reserved-keys")
    handler = _Capture()
    log._logger.addHandler(handler)
    log._logger.setLevel(logging.DEBUG)
    yield log, handler
    log._logger.removeHandler(handler)


class TestReservedKeys:
    """A logger must never be able to break the code that calls it.

    Passing a name the standard library owns on a LogRecord, `message`
    being the easy one to reach for, used to raise KeyError from inside
    logging. It bit twice, both times inside an error handler, so the
    line you actually needed was replaced by a complaint about logging
    (found 17 Aug 2026 on the bulk-upload and Telegram workers).

    `msg` is deliberately not covered: it is the wrapper's own positional
    parameter, so passing it raises TypeError at the call site, which
    names the problem plainly and cannot reach this code.
    """

    @pytest.mark.parametrize(
        "key", ["message", "args", "name", "levelname", "module", "filename", "lineno"]
    )
    def test_reserved_key_does_not_raise(self, key, captured):
        log, _ = captured
        log.error("Handled a bad payload", **{key: {"a": 1}})

    def test_reserved_key_is_renamed_and_still_logged(self, captured):
        log, handler = captured
        log.error("Bad payload", message={"a": 1})
        record = handler.records[-1]
        assert record.getMessage() == "Bad payload"   # the real message survives
        assert record.message_ == {"a": 1}            # the value is kept, renamed

    def test_ordinary_fields_keep_their_names(self, captured):
        """The rename must be narrow. These are used across every service
        and a renamed key would break log filters everywhere."""
        log, handler = captured
        log.info("Processing", image_id="abc", user_id=7, payload={"x": 1}, worker="detection")
        record = handler.records[-1]
        assert record.image_id == "abc"
        assert record.user_id == 7
        assert record.payload == {"x": 1}
        assert record.worker == "detection"

    def test_common_field_names_are_not_reserved(self):
        for key in ["image_id", "user_id", "payload", "worker", "queue", "error", "status"]:
            assert key not in _RESERVED_LOGRECORD_KEYS

    def test_exc_info_still_reaches_logging(self, captured):
        """exc_info is popped before the rename, so it must keep working."""
        log, handler = captured
        try:
            raise RuntimeError("boom")
        except RuntimeError:
            log.error("Failed", exc_info=True, message="x")
        assert handler.records[-1].exc_info is not None
