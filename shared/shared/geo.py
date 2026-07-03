"""
Shared geographic constants and helpers for the spatial model.
"""

# The single distance threshold that drives sites and deployments.
#
# A site is a physical place: two GPS readings within this distance are the same
# site. A deployment is one camera at one site for a continuous period, so a new
# deployment starts when a camera's reading falls outside its current site (more
# than this distance away). One number governs both. There is no separate
# relocation threshold.
#
# 250 m is set from measured noise. Across ~1000 images from cameras that were
# never moved, per-camera GPS noise has a median near 9 m but a fat tail that
# reaches 215 m on the noisiest camera. The old 100 m sat inside that tail and
# split stationary cameras into phantom deployments (observed jumps of 106 to
# 147 m). 250 m clears the full observed tail with margin, so noise no longer
# relocates a camera. The cost is that two real stations closer than 250 m share
# one site, but GPS noise that large cannot separate them anyway. Those cameras
# still stay distinct: one site can hold several cameras, each its own deployment,
# keyed by device_id, not by GPS. Not per-project configurable in v1; can become
# a Project field later.
SITE_THRESHOLD_METERS = 250.0

# How many consecutive out-of-range GPS readings near the same new spot are
# required before ingestion believes a camera relocated and opens a new
# deployment. A lone outlier (a single bad GPS fix) is attached to the current
# deployment instead of spawning a phantom site. 2 kills the single-outlier
# case; the cost is that a real move sending only one reading before the camera
# dies attaches to the old deployment. See update_or_create_site_and_deployment.
RELOCATION_CONFIRMATIONS = 2

def next_mean_pin(
    lat: float, lon: float, count: int, new_lat: float, new_lon: float
) -> tuple[float, float, int]:
    """
    Fold one GPS reading into a deployment pin that is the running mean of
    ``count`` readings so far, returning (mean_lat, mean_lon, count + 1).

    The pin starts as the first fix, which is typically the worst reading (the
    camera has just connected to the cell network). Averaging every later
    within-threshold reading makes the pin converge on the true position, which
    matters beyond cosmetics: the relocation check measures new readings
    against this pin, so a bad anchor eats into the SITE_THRESHOLD_METERS
    margin and can raise phantom move candidates. Each new reading carries
    1/(count+1) weight, so the pin stabilises by itself and no cutoff is
    needed; a single outlier from the noise tail moves a mature pin by
    centimetres.

    Longitudes are unwrapped before averaging so two readings straddling the
    antimeridian (+179.999 and -179.999) do not average to ~0.
    """
    n = count + 1
    if new_lon - lon > 180:
        new_lon -= 360
    elif lon - new_lon > 180:
        new_lon += 360
    mean_lon = lon + (new_lon - lon) / n
    if mean_lon > 180:
        mean_lon -= 360
    elif mean_lon < -180:
        mean_lon += 360
    return lat + (new_lat - lat) / n, mean_lon, n


# A site's pin is the centroid of its deployments' locations. Run this after a
# site's deployment membership changes (a deployment is created at, reassigned
# to, merged into, or removed from it), and after a deployment's own pin moved
# (the running mean above). It is a no-op for a site with no deployments, which
# keeps its current location. Bind :site_id. Works from both
# the sync ingestion session and the async API session.
RECOMPUTE_SITE_LOCATION_SQL = """
    UPDATE sites s
    SET location = c.centroid
    FROM (
        SELECT ST_Centroid(ST_Collect(location::geometry))::geography AS centroid
        FROM deployments
        WHERE site_id = :site_id
    ) c
    WHERE s.id = :site_id AND c.centroid IS NOT NULL
"""
