"""The one clock for stamps that login tokens are compared against.

A JWT carries its issue time (`iat`) in whole seconds. A stamp with
microseconds is therefore later than a token minted right after it in the same
second, and that token gets rejected as "issued before the stamp". Every stamp
a token is checked against comes from here, so both sides are whole seconds.
"""
from datetime import datetime, timezone


def now_stamp() -> datetime:
    """The current UTC time, cut down to whole seconds."""
    return datetime.now(timezone.utc).replace(microsecond=0)
