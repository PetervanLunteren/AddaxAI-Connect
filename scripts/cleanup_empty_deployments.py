"""
Delete empty deployment rows (debris).

A deployment is one camera at one site for a time range, built from photos. GPS
settling on a camera's first day, and (before the ingestion fix) daily reports
that carry GPS but no photo, could open a deployment that gets closed before any
image lands in it. The result is a closed deployment with zero images: debris
that inflates deployment counts and clutters the Deployments page.

This deletes those rows. It is conservative and safe:
  - only deployments with ZERO images (nothing references them)
  - only CLOSED deployments (end_date IS NOT NULL), so a camera that is
    reporting but has not photographed yet keeps its current open deployment
  - real deployments already hold all photos and sites, so nothing is lost

A debris deployment can be the only deployment a site has. That happens when a
bad GPS fix drops a camera more than the site threshold away from its real spot,
opening a short empty deployment that backfill_sites then clusters into its own
site. Deleting the deployment used to leave that site behind with zero cameras,
zero deployments, and zero images, pinned at the glitch coordinate. So after the
deletes, any site whose last deployment just went is removed too. A site that
never had a deployment (a user creates one in the UI before a camera arrives) is
never in scope here, so manual empty sites are left alone.

Idempotent and re-runnable. Run --dry-run first.

Usage:
    python cleanup_empty_deployments.py --dry-run      # list what would go, write nothing
    python cleanup_empty_deployments.py                # delete
    python cleanup_empty_deployments.py --project-id 3 # limit to one project
"""
import argparse
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports (matches the other scripts).
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger

settings = get_settings()
logger = get_logger("cleanup_empty_deployments")


def find_empty_deployments(session: Session, project_id):
    """Closed deployments with no images, oldest first per camera."""
    where_project = "AND c.project_id = :project_id" if project_id is not None else ""
    rows = session.execute(
        text(f"""
            SELECT d.id, c.device_id, d.deployment_number,
                   d.start_date, d.end_date, d.site_id
            FROM deployments d
            JOIN cameras c ON c.id = d.camera_id
            WHERE d.end_date IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM images i WHERE i.deployment_id = d.id)
              {where_project}
            ORDER BY c.device_id, d.deployment_number
        """),
        {"project_id": project_id},
    ).mappings().all()
    return rows


def find_sites_left_empty(session: Session, dep_ids):
    """Sites whose every deployment is in dep_ids, so deleting those rows leaves
    the site with none. A site with another deployment outside the set survives;
    a site that never had a deployment is not considered, since it has no row in
    dep_ids pointing at it."""
    if not dep_ids:
        return []
    return session.execute(
        text("""
            SELECT DISTINCT s.id, s.name
            FROM sites s
            JOIN deployments d ON d.site_id = s.id AND d.id = ANY(:dep_ids)
            WHERE NOT EXISTS (
                SELECT 1 FROM deployments other
                WHERE other.site_id = s.id
                  AND other.id <> ALL(:dep_ids)
            )
            ORDER BY s.id
        """),
        {"dep_ids": list(dep_ids)},
    ).mappings().all()


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete empty (zero-image) deployment rows.")
    parser.add_argument("--dry-run", action="store_true",
                        help="List the deployments that would be deleted without writing.")
    parser.add_argument("--project-id", type=int, default=None,
                        help="Limit to a single project id.")
    args = parser.parse_args()

    mode = "DRY RUN (no writes)" if args.dry_run else "APPLY"
    logger.info("Starting empty-deployment cleanup", mode=mode, project_id=args.project_id)

    engine = create_engine(settings.database_url)
    with Session(engine) as session:
        rows = find_empty_deployments(session, args.project_id)
        dep_ids = [r["id"] for r in rows]
        empty_sites = find_sites_left_empty(session, dep_ids)

        print(f"\n=== {mode}: {len(rows)} empty deployment(s) ===")
        for r in rows:
            print(
                f"  id={r['id']:>4}  camera={r['device_id']}  "
                f"dep#{r['deployment_number']}  "
                f"{r['start_date']} -> {r['end_date']}  site_id={r['site_id']}"
            )

        print(f"=== sites left empty by the above: {len(empty_sites)} ===")
        for s in empty_sites:
            print(f"  site id={s['id']:>4}  \"{s['name']}\"")

        if rows and not args.dry_run:
            session.execute(
                text("DELETE FROM deployments WHERE id = ANY(:ids)"),
                {"ids": dep_ids},
            )
            site_ids = [s["id"] for s in empty_sites]
            if site_ids:
                # Re-check NOT EXISTS at delete time, so a deployment that landed
                # on one of these sites between the scan and now keeps the site.
                session.execute(
                    text("""
                        DELETE FROM sites
                        WHERE id = ANY(:ids)
                          AND NOT EXISTS (
                              SELECT 1 FROM deployments d WHERE d.site_id = sites.id
                          )
                    """),
                    {"ids": site_ids},
                )
            session.commit()
            print(f"\nDeleted {len(dep_ids)} deployment(s) and {len(site_ids)} empty site(s).")
        elif args.dry_run:
            session.rollback()
            print("\nDry run, nothing written.")
        else:
            print("\nNothing to delete.")

    logger.info("Empty-deployment cleanup complete",
                deployments_deleted=0 if args.dry_run else len(dep_ids),
                sites_deleted=0 if args.dry_run else len(empty_sites),
                mode=mode)


if __name__ == "__main__":
    main()
