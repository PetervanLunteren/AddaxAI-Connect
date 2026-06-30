"""
Shared geographic constants for the spatial model.
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

# A site's pin is the centroid of its deployments' locations. Run this after a
# site's deployment membership changes (a deployment is created at, reassigned
# to, merged into, or removed from it). It is a no-op for a site with no
# deployments, which keeps its current location. Bind :site_id. Works from both
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
