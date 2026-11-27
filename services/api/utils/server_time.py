"""
The server's timezone and its today. Camera clocks, due dates and day bounds
are read against this timezone, never against the machine's or the
browser's clock.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import ServerSettings


async def get_server_timezone(db: AsyncSession) -> str:
    """Get server timezone, defaulting to UTC if not configured."""
    result = await db.execute(select(ServerSettings).limit(1))
    settings = result.scalar_one_or_none()
    return settings.timezone if settings and settings.timezone else "UTC"


async def server_today(db: AsyncSession) -> date:
    """Today under the server timezone: the reference for what is past,
    today or future, whatever clock the machine or the browser runs on."""
    return datetime.now(ZoneInfo(await get_server_timezone(db))).date()
