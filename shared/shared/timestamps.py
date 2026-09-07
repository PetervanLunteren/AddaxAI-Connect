"""
ISO 8601 timestamps with an offset, for the outbound integrations.

Every platform we post to reads a timestamp without an offset as UTC,
which would shift a camera-clock reading by the site's offset. So the
builders always localise first, with one function, here.
"""
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo


def isoformat_with_offset(moment: datetime, tz: Optional[ZoneInfo] = None) -> str:
    """A naive moment is a camera-clock reading and needs the server
    timezone; an aware one is passed through."""
    if moment.tzinfo is None:
        if tz is None:
            raise ValueError("naive datetime needs a timezone")
        moment = moment.replace(tzinfo=tz)
    return moment.isoformat(timespec="seconds")
