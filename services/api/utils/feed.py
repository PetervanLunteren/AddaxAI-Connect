"""
Pure helpers for the camera updates feed.
"""
from typing import Any, Dict, List

from shared.geo import SITE_THRESHOLD_METERS, calculate_gps_distance


def nearby_sites(
    dep_lat: float, dep_lon: float, sites: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    The project's sites within SITE_THRESHOLD_METERS of a deployment location,
    nearest first. These are the alternatives a feed entry offers when the
    system's site guess was wrong; anything further away is a different place
    by definition, so it is not offered.

    Each input site needs id, name, lat, lon keys. Returns
    [{"site_id", "name", "distance_m"}].
    """
    out = []
    for site in sites:
        distance = calculate_gps_distance(dep_lat, dep_lon, site["lat"], site["lon"])
        if distance <= SITE_THRESHOLD_METERS:
            out.append({
                "site_id": site["id"],
                "name": site["name"],
                "distance_m": round(distance, 1),
            })
    out.sort(key=lambda s: s["distance_m"])
    return out


async def close_events_for_named_site(db, site_id: int, user_id: int) -> int:
    """
    Close every open feed entry whose site just got a real name.

    Naming the site is the action a "started sending" or "moved" entry asks
    for, wherever it happens (the feed, the Sites page, the site slideout),
    so all of them close as rename_site by that user. The badge is a shared
    to-do count, and a to-do that was done elsewhere must not stay on it.
    Returns how many entries were closed.
    """
    from sqlalchemy import func, update
    from shared.models import FeedEvent
    result = await db.execute(
        update(FeedEvent)
        .where(FeedEvent.site_id == site_id, FeedEvent.resolved_action.is_(None))
        .values(resolved_action='rename_site', resolved_at=func.now(), resolved_by_user_id=user_id)
    )
    return result.rowcount
