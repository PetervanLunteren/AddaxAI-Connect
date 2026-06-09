"""
Backfill Sites from existing deployments, and link images to deployments.

Phase 1 of the Site-as-first-class-concept work (see future-plans/site-addition.md).

This builds Sites on top of the deployment rows that backfill_deployment_periods.py
and live ingestion already create. It does NOT re-detect deployments from image GPS.

For each project it:
  1. Groups the project's deployments into Sites by GPS proximity (deployments
     whose locations are within SITE_THRESHOLD_METERS of each other share
     one Site).
  2. Derives a Site name from the member cameras' names:
     - one camera in the group  -> Site name = that camera's name, no deployment label
     - several cameras with a shared name prefix (Duinpoort NW + Duinpoort NO)
       -> Site name = the shared prefix ("Duinpoort"), each deployment gets the
          remainder as its label ("NW", "NO")
     - several cameras with no shared prefix -> Site name = coordinates, each
       deployment keeps its full camera name as label, flagged for manual cleanup
  3. Sets deployments.site_id (and deployments.name for the label).
  4. Sets images.deployment_id for every image whose camera + capture date falls
     inside a deployment's date range.

Idempotent and re-runnable:
  - deployments that already have a site_id are left untouched
  - a new group that sits within the merge threshold of an existing Site reuses
    that Site instead of creating a duplicate
  - images that already have a deployment_id are skipped

Usage:
    python backfill_sites.py --dry-run      # print the proposed mapping, write nothing
    python backfill_sites.py                # apply
    python backfill_sites.py --project-id 3 # limit to one project
"""
import argparse
import math
import re
import sys
import uuid
from typing import List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports (matches the other backfill scripts)
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger
from shared.geo import SITE_THRESHOLD_METERS

settings = get_settings()
logger = get_logger("backfill_sites")

# Deployments at Null Island (0, 0) or with an inverted date range are zombie
# rows that the stats and export queries already skip on read (see
# services/api/routers/statistics.py). Skip them here too, otherwise the (0, 0)
# rows all cluster together into one bogus cross-camera site and capture images
# that belong to real deployments. The deployments table is aliased as `d`.
VALID_DEPLOYMENT_SQL = (
    "NOT (ST_X(d.location::geometry) = 0 AND ST_Y(d.location::geometry) = 0) "
    "AND (d.end_date IS NULL OR d.end_date >= d.start_date)"
)


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two GPS points in meters."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def tokenize(name: str) -> List[str]:
    """Split a camera name on spaces, hyphens and underscores."""
    return [t for t in re.split(r'[\s_\-]+', (name or "").strip()) if t]


def common_prefix_tokens(token_lists: List[List[str]]) -> List[str]:
    """Longest shared leading run of tokens across all the given token lists."""
    if not token_lists:
        return []
    prefix: List[str] = []
    for i in range(min(len(t) for t in token_lists)):
        column = {t[i] for t in token_lists}
        if len(column) == 1:
            prefix.append(token_lists[0][i])
        else:
            break
    return prefix


def remainder_label(name: str, prefix_len: int) -> str:
    """Camera name with the shared prefix tokens removed, joined back to a label."""
    return " ".join(tokenize(name)[prefix_len:])


class Group:
    """A set of deployments that resolve to one Site."""

    def __init__(self, lat: float, lon: float):
        self.members: list = []          # rows: id, camera_id, camera_name, lat, lon
        self.lat = lat
        self.lon = lon
        self.existing_site_id: Optional[int] = None
        self.existing_site_name: Optional[str] = None

    def add(self, row) -> None:
        self.members.append(row)
        n = len(self.members)
        self.lat = sum(m.lat for m in self.members) / n
        self.lon = sum(m.lon for m in self.members) / n

    def center_distance(self, lat: float, lon: float) -> float:
        return haversine_meters(self.lat, self.lon, lat, lon)


def load_projects(session: Session, project_id: Optional[int]) -> List[int]:
    if project_id is not None:
        return [project_id]
    rows = session.execute(text("SELECT id FROM projects ORDER BY id")).all()
    return [r.id for r in rows]


def load_deployments(session: Session, project_id: int) -> list:
    """Project deployments with decoded coordinates and the camera's label.

    The label is the camera's old friendly name when the drop-Camera.name
    migration preserved one in `cameras.notes` (line "Previous friendly name:
    <X>"), otherwise the device_id. Reusing the preserved name lets the site
    naming heuristic still produce human-readable sites ("Duinpoort" out of
    "Duinpoort NW" + "Duinpoort NO") on data that predates the column drop.
    """
    sql = text(f"""
        SELECT d.id, d.camera_id, d.site_id,
               COALESCE(
                   trim((regexp_match(c.notes, 'Previous friendly name:\\s*([^\\n]+)'))[1]),
                   c.device_id
               ) AS camera_name,
               ST_Y(d.location::geometry) AS lat,
               ST_X(d.location::geometry) AS lon
        FROM deployments d
        JOIN cameras c ON c.id = d.camera_id
        WHERE c.project_id = :project_id
          AND {VALID_DEPLOYMENT_SQL}
        ORDER BY d.camera_id, d.id
    """)
    return session.execute(sql, {"project_id": project_id}).all()


def load_existing_sites(session: Session, project_id: int) -> list:
    sql = text("""
        SELECT id, name,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lon
        FROM sites
        WHERE project_id = :project_id
    """)
    return session.execute(sql, {"project_id": project_id}).all()


def cluster_deployments(deployments: list) -> List[Group]:
    """Greedy clustering of the deployments that have no site yet, within SITE_THRESHOLD_METERS."""
    groups: List[Group] = []
    for row in deployments:
        if row.site_id is not None:
            continue  # already assigned, leave it
        best = None
        best_dist = float("inf")
        for g in groups:
            dist = g.center_distance(row.lat, row.lon)
            if dist <= SITE_THRESHOLD_METERS and dist < best_dist:
                best, best_dist = g, dist
        if best is None:
            best = Group(row.lat, row.lon)
            groups.append(best)
        best.add(row)
    return groups


def derive_name_and_labels(group: Group):
    """
    Return (site_name, {deployment_id: label}, flagged).

    flagged is True when the cameras share no name prefix, so a human should
    rename the site later.
    """
    camera_names = sorted({m.camera_name for m in group.members})
    if len(camera_names) == 1:
        return camera_names[0], {m.id: None for m in group.members}, False

    prefix = common_prefix_tokens([tokenize(n) for n in camera_names])
    if prefix:
        site_name = " ".join(prefix)
        labels = {m.id: (remainder_label(m.camera_name, len(prefix)) or None) for m in group.members}
        return site_name, labels, False

    site_name = f"Site at {group.lat:.4f}, {group.lon:.4f}"
    labels = {m.id: m.camera_name for m in group.members}
    return site_name, labels, True


def unique_name(name: str, used: set) -> str:
    """Avoid the (project_id, name) unique constraint by suffixing a counter."""
    if name not in used:
        return name
    n = 2
    while f"{name} ({n})" in used:
        n += 1
    return f"{name} ({n})"


def process_project(session: Session, project_id: int, dry_run: bool) -> dict:
    deployments = load_deployments(session, project_id)
    if not deployments:
        return {"sites_created": 0, "sites_reused": 0, "deployments_linked": 0, "flagged": 0}

    existing_sites = load_existing_sites(session, project_id)
    used_names = {s.name for s in existing_sites}
    groups = cluster_deployments(deployments)

    stats = {"sites_created": 0, "sites_reused": 0, "deployments_linked": 0, "flagged": 0}
    print(f"\n=== project {project_id}: {len(deployments)} deployments, "
          f"{len(groups)} new group(s), {len(existing_sites)} existing site(s) ===")

    for group in groups:
        # Reuse an existing site if the group sits within the merge threshold.
        reuse = None
        for s in existing_sites:
            if haversine_meters(group.lat, group.lon, s.lat, s.lon) <= SITE_THRESHOLD_METERS:
                reuse = s
                break

        if reuse is not None:
            site_id = reuse.id
            site_name = reuse.name
            prefix = common_prefix_tokens([tokenize(reuse.name)])
            labels = {m.id: (remainder_label(m.camera_name, len(prefix)) or None) for m in group.members}
            flagged = False
            stats["sites_reused"] += 1
            tag = f"reuse site #{site_id}"
        else:
            site_name, labels, flagged = derive_name_and_labels(group)
            site_name = unique_name(site_name, used_names)
            used_names.add(site_name)
            site_id = None  # assigned on insert
            stats["sites_created"] += 1
            tag = "NEW site"

        if flagged:
            stats["flagged"] += 1

        flag_txt = "  [FLAG: no shared prefix, rename manually]" if flagged else ""
        print(f"  {tag}: \"{site_name}\" @ ({group.lat:.5f}, {group.lon:.5f}){flag_txt}")
        for m in group.members:
            lbl = labels.get(m.id)
            print(f"      deployment #{m.id}  camera \"{m.camera_name}\"  -> label {lbl!r}")

        if not dry_run:
            if site_id is None:
                site_id = session.execute(
                    text("""
                        INSERT INTO sites (uuid, project_id, name, location, created_at)
                        VALUES (:uuid, :project_id, :name,
                                ST_GeogFromText(:wkt), now())
                        RETURNING id
                    """),
                    {
                        "uuid": str(uuid.uuid4()),
                        "project_id": project_id,
                        "name": site_name,
                        "wkt": f"POINT({group.lon} {group.lat})",
                    },
                ).scalar_one()
            for m in group.members:
                # COALESCE keeps a label a human already set; otherwise the
                # derived orientation label ("NW", "North") lands here. None for
                # a single-camera site leaves it blank.
                session.execute(
                    text("""
                        UPDATE deployments
                        SET site_id = :sid, name = COALESCE(name, :label)
                        WHERE id = :did
                    """),
                    {"sid": site_id, "did": m.id, "label": labels.get(m.id)},
                )

    # Link this project's images to the deployment covering their capture date.
    # Periods are non-overlapping per camera, so each image matches at most one.
    link_filter = f"""
        FROM images i
        JOIN deployments d ON d.camera_id = i.camera_id
            AND i.captured_at::date >= d.start_date
            AND (d.end_date IS NULL OR i.captured_at::date <= d.end_date)
            AND {VALID_DEPLOYMENT_SQL}
        JOIN cameras c ON c.id = i.camera_id
        WHERE i.deployment_id IS NULL
          AND c.project_id = :project_id
    """
    to_link = session.execute(
        text(f"SELECT COUNT(*) AS n {link_filter}"), {"project_id": project_id}
    ).scalar_one()
    stats["deployments_linked"] = to_link
    print(f"  images to link to a deployment: {to_link}")

    if not dry_run and to_link:
        session.execute(
            text(f"""
                UPDATE images SET deployment_id = d.id
                FROM deployments d
                JOIN cameras c ON c.id = d.camera_id
                WHERE images.camera_id = d.camera_id
                  AND images.deployment_id IS NULL
                  AND images.captured_at::date >= d.start_date
                  AND (d.end_date IS NULL OR images.captured_at::date <= d.end_date)
                  AND {VALID_DEPLOYMENT_SQL}
                  AND c.project_id = :project_id
            """),
            {"project_id": project_id},
        )

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill Sites and link images to deployments.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the proposed mapping without writing anything.")
    parser.add_argument("--project-id", type=int, default=None,
                        help="Limit to a single project id.")
    args = parser.parse_args()

    mode = "DRY RUN (no writes)" if args.dry_run else "APPLY"
    logger.info("Starting site backfill", mode=mode, project_id=args.project_id)

    engine = create_engine(settings.database_url)
    totals = {"sites_created": 0, "sites_reused": 0, "deployments_linked": 0, "flagged": 0}

    with Session(engine) as session:
        for project_id in load_projects(session, args.project_id):
            stats = process_project(session, project_id, args.dry_run)
            for k in totals:
                totals[k] += stats[k]

        if args.dry_run:
            session.rollback()
        else:
            session.commit()

    print("\n=== summary ===")
    print(f"  sites created : {totals['sites_created']}")
    print(f"  sites reused  : {totals['sites_reused']}")
    print(f"  flagged sites : {totals['flagged']}")
    print(f"  images linked : {totals['deployments_linked']}")
    print(f"  mode          : {mode}")
    logger.info("Site backfill complete", **totals, mode=mode)


if __name__ == "__main__":
    main()
