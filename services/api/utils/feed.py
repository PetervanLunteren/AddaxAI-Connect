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
