"""
Deployment merge logic.

A deployment is one camera at one site for a continuous time range. A now-fixed
ingestion bug could split one continuous placement into two same-site deployments
with no real gap between them (a junk (0,0) GPS reading from a daily report, which
opened a deployment that closed the day before it started). Those are not two
deployments in any real sense, just debris that shows a phantom relocation on the
Deployments page.

This module enforces one invariant: a camera never has two contiguous same-site
deployments. It merges any such pair, extending the earlier deployment to cover
the later one, moving the later's images onto it, and deleting the later row. The
no-gap guard (DEPLOYMENT_MERGE_GAP_DAYS) is what keeps a genuine remove-and-
redeploy at the same site safe: that has a real, multi-day gap and is never merged.

The SQL here is the single source of truth. The sync helper below runs it from
the one-off backfill script; the async deployment router runs the same SQL on its
own session for the live reassignment hook, mirroring how _recompute_site_location
exists in both a sync (ingestion) and an async (API) form.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from .geo import RECOMPUTE_SITE_LOCATION_SQL

# Two same-site deployments for one camera are the same placement when the later
# one starts no more than this many days after the earlier one ends. The bug
# produced an exact next-day split (ends 22 Apr, next starts 23 Apr), so 1 day
# catches it; a real removal and redeployment leaves a multi-day gap and is never
# merged. Postgres `date + int` adds days, so the guard reads naturally below.
DEPLOYMENT_MERGE_GAP_DAYS = 1

# The earliest mergeable (earlier -> later) pair for one camera, or no row. Both
# deployments share a non-null site, so unassigned deployments and a real move to
# a different site never match. The earlier must be closed (an open deployment can
# only be the later half, absorbed so the survivor stays open). A pair can start
# on the same date (a move undone the same day splits into two same-day rows);
# the id tiebreak keeps the earlier/later roles unambiguous there. Bind
# :camera_id and :gap_days.
#
# The :gap_days cast to int is required: asyncpg sends bound params untyped, so
# `date + :gap_days` is the ambiguous `date + unknown` (date + int vs date +
# interval). psycopg2 sends a typed int and does not need it, but the cast keeps
# one SQL string working under both drivers (the API uses asyncpg, the script
# uses psycopg2).
FIND_NEXT_MERGEABLE_PAIR_SQL = """
    SELECT earlier.id AS earlier_id,
           later.id   AS later_id,
           earlier.site_id AS site_id
    FROM deployments earlier
    JOIN deployments later
      ON later.camera_id = earlier.camera_id
     AND later.site_id   = earlier.site_id
    WHERE earlier.camera_id = :camera_id
      AND earlier.site_id IS NOT NULL
      AND earlier.end_date IS NOT NULL
      AND (later.start_date > earlier.start_date
           OR (later.start_date = earlier.start_date AND later.id > earlier.id))
      AND later.start_date <= earlier.end_date + (:gap_days)::int
    ORDER BY earlier.start_date, later.start_date
    LIMIT 1
"""

# Extend the earlier deployment over the later one: take the later's end_date
# (NULL if the later is still open, so the survivor stays open) and keep the
# human-confirmed flag if either deployment carried it. Bind :earlier, :later.
EXTEND_EARLIER_SQL = """
    UPDATE deployments earlier
    SET end_date = later.end_date,
        site_source = CASE
            WHEN earlier.site_source = 'manual' OR later.site_source = 'manual'
            THEN 'manual' ELSE earlier.site_source
        END
    FROM deployments later
    WHERE earlier.id = :earlier AND later.id = :later
"""

# Move the later deployment's images onto the survivor. Must run before the
# delete: the images FK is ON DELETE SET NULL, so deleting first would orphan
# them. Bind :earlier, :later.
RELINK_IMAGES_SQL = """
    UPDATE images SET deployment_id = :earlier WHERE deployment_id = :later
"""

DELETE_LATER_SQL = "DELETE FROM deployments WHERE id = :later"


def merge_camera_contiguous(session: Session, camera_id: int) -> int:
    """
    Merge every contiguous same-site deployment pair for one camera, then
    recompute the affected sites' pins. Returns how many deployments were merged
    away (deleted). Idempotent: a camera with no mergeable pair is a no-op.

    Runs as a fixpoint, because extending one pair can make the next deployment
    contiguous (chains like #1 + #2 + #3), so it loops until no pair remains.
    """
    merged = 0
    affected_sites: set[int] = set()
    while True:
        pair = session.execute(
            text(FIND_NEXT_MERGEABLE_PAIR_SQL),
            {"camera_id": camera_id, "gap_days": DEPLOYMENT_MERGE_GAP_DAYS},
        ).mappings().first()
        if pair is None:
            break
        params = {"earlier": pair["earlier_id"], "later": pair["later_id"]}
        session.execute(text(EXTEND_EARLIER_SQL), params)
        session.execute(text(RELINK_IMAGES_SQL), params)
        session.execute(text(DELETE_LATER_SQL), {"later": pair["later_id"]})
        affected_sites.add(pair["site_id"])
        merged += 1

    for site_id in affected_sites:
        session.execute(text(RECOMPUTE_SITE_LOCATION_SQL), {"site_id": site_id})
    return merged
