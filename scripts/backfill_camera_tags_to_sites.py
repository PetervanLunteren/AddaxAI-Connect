"""
Move existing camera tags onto their sites, then clear them off the cameras.

Tags were assigned to cameras back when a camera *was* the location. After the
site refactor, place-describing tags ("transect-a", "river", "control-plot")
belong on the Site, not the hardware. Camera tags stay a supported feature, but
only for hardware labels ("new", "old", "stationary", "moving"); the existing
production tags all predate that split and are place-specific, so this one-off
moves them to where they now belong.

For each camera that has tags:
  - union those tags onto every Site where the camera has a deployment
    (a camera that moved touches several sites; all of them collect the label)
  - merge with the site's current tags, deduped under the same normalize rules
    the API uses (lowercase, strip, drop commas and empties)
  - then clear the camera's tags

A camera with tags but no sited deployment (pure inventory, missing GPS) has
nowhere to place its tags. It is left untouched and logged, so nothing is lost;
a human can re-tag or move it once the camera gets a deployment.

Idempotent and re-runnable:
  - once a camera's tags are cleared, a re-run finds nothing to move
  - re-adding the same tags to a site is a no-op (the union dedups)

Usage:
    python backfill_camera_tags_to_sites.py --dry-run      # print the plan, write nothing
    python backfill_camera_tags_to_sites.py                # apply
    python backfill_camera_tags_to_sites.py --project-id 3 # limit to one project
"""
import argparse
import json
import sys
from typing import List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports (matches the other backfill scripts)
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger

settings = get_settings()
logger = get_logger("backfill_camera_tags_to_sites")


def normalize_tags(tags: Optional[List[str]]) -> List[str]:
    """Lowercase, strip, drop commas and empties, dedupe, preserve first-seen order.

    Same shape the API uses for camera and site tags (see cameras.py / sites.py),
    so a moved tag matches what the UI would have produced."""
    if not tags:
        return []
    seen: set = set()
    result: List[str] = []
    for raw in tags:
        if not isinstance(raw, str):
            continue
        tag = raw.strip().lower().replace(',', '')
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


def load_projects(session: Session, project_id: Optional[int]) -> List[int]:
    if project_id is not None:
        return [project_id]
    rows = session.execute(text("SELECT id FROM projects ORDER BY id")).all()
    return [r.id for r in rows]


def load_tagged_cameras(session: Session, project_id: int) -> list:
    """Cameras in the project that carry tags, with the sites they deploy to.

    site_ids is the distinct set of sites the camera has a deployment at; it is
    empty when the camera has no sited deployment (inventory or missing GPS)."""
    sql = text("""
        SELECT c.id AS camera_id,
               c.device_id AS device_id,
               c.tags AS camera_tags,
               array_remove(array_agg(DISTINCT d.site_id), NULL) AS site_ids
        FROM cameras c
        LEFT JOIN deployments d ON d.camera_id = c.id
        WHERE c.project_id = :project_id
          AND c.tags IS NOT NULL
        GROUP BY c.id, c.device_id, c.tags
        ORDER BY c.id
    """)
    return session.execute(sql, {"project_id": project_id}).all()


def load_site_tags(session: Session, site_ids: List[int]) -> dict:
    """Current tags for the given sites, as {site_id: [tags]}."""
    if not site_ids:
        return {}
    rows = session.execute(
        text("SELECT id, name, tags FROM sites WHERE id = ANY(:ids)"),
        {"ids": list(site_ids)},
    ).mappings().all()
    return {r["id"]: r for r in rows}


def process_project(session: Session, project_id: int, dry_run: bool) -> dict:
    stats = {"cameras_moved": 0, "cameras_cleared_empty": 0, "orphans": 0,
             "sites_touched": 0, "tags_added": 0}
    cameras = load_tagged_cameras(session, project_id)
    if not cameras:
        return stats

    # Accumulate per-site additions so a site written to by several cameras is
    # updated once, and clear-lists so we touch each camera once.
    additions: dict = {}            # site_id -> set(tags)
    cameras_to_clear: List[int] = []  # placed, or had only empty/junk tags

    print(f"\n=== project {project_id}: {len(cameras)} tagged camera(s) ===")
    for c in cameras:
        tags = normalize_tags(c.camera_tags)
        if not tags:
            # Empty or junk tag value (e.g. []); just clean it off.
            cameras_to_clear.append(c.camera_id)
            stats["cameras_cleared_empty"] += 1
            continue
        site_ids = list(c.site_ids or [])
        if not site_ids:
            stats["orphans"] += 1
            print(f"  ORPHAN: camera #{c.camera_id} ({c.device_id}) tags {tags} "
                  f"have no sited deployment, left on the camera")
            logger.warning("Camera tags have no site to move to, left in place",
                           camera_id=c.camera_id, device_id=c.device_id, tags=tags)
            continue
        for sid in site_ids:
            additions.setdefault(sid, set()).update(tags)
        cameras_to_clear.append(c.camera_id)
        stats["cameras_moved"] += 1
        print(f"  camera #{c.camera_id} ({c.device_id}) tags {tags} "
              f"-> site(s) {site_ids}")

    # Merge into each site's existing tags and write once per site.
    site_meta = load_site_tags(session, list(additions.keys()))
    for sid, incoming in additions.items():
        meta = site_meta.get(sid)
        existing = normalize_tags(meta["tags"] if meta else [])
        # existing first, new ones sorted for a deterministic result
        merged = normalize_tags(existing + sorted(incoming))
        added = [t for t in merged if t not in existing]
        if not added:
            continue  # site already had all of them
        stats["sites_touched"] += 1
        stats["tags_added"] += len(added)
        name = meta["name"] if meta else f"#{sid}"
        print(f"  site \"{name}\" (#{sid}): + {added}  -> {merged}")
        if not dry_run:
            session.execute(
                text("UPDATE sites SET tags = CAST(:tags AS json), updated_at = now() "
                     "WHERE id = :id"),
                {"tags": json.dumps(merged), "id": sid},
            )

    if not dry_run and cameras_to_clear:
        session.execute(
            text("UPDATE cameras SET tags = NULL WHERE id = ANY(:ids)"),
            {"ids": cameras_to_clear},
        )

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Move existing camera tags to their sites and clear the cameras.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the plan without writing anything.")
    parser.add_argument("--project-id", type=int, default=None,
                        help="Limit to a single project id.")
    args = parser.parse_args()

    mode = "DRY RUN (no writes)" if args.dry_run else "APPLY"
    logger.info("Starting camera-tag to site backfill", mode=mode, project_id=args.project_id)

    engine = create_engine(settings.database_url)
    totals = {"cameras_moved": 0, "cameras_cleared_empty": 0, "orphans": 0,
              "sites_touched": 0, "tags_added": 0}

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
    print(f"  cameras moved        : {totals['cameras_moved']}")
    print(f"  cameras cleared empty: {totals['cameras_cleared_empty']}")
    print(f"  orphans (left as-is) : {totals['orphans']}")
    print(f"  sites touched        : {totals['sites_touched']}")
    print(f"  tags added to sites  : {totals['tags_added']}")
    print(f"  mode                 : {mode}")
    logger.info("Camera-tag to site backfill complete", **totals, mode=mode)


if __name__ == "__main__":
    main()
