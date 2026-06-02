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

        print(f"\n=== {mode}: {len(rows)} empty deployment(s) ===")
        for r in rows:
            print(
                f"  id={r['id']:>4}  camera={r['device_id']}  "
                f"dep#{r['deployment_number']}  "
                f"{r['start_date']} -> {r['end_date']}  site_id={r['site_id']}"
            )

        if rows and not args.dry_run:
            ids = [r["id"] for r in rows]
            session.execute(
                text("DELETE FROM deployments WHERE id = ANY(:ids)"),
                {"ids": ids},
            )
            session.commit()
            print(f"\nDeleted {len(ids)} deployment(s).")
        elif args.dry_run:
            session.rollback()
            print("\nDry run, nothing written.")
        else:
            print("\nNothing to delete.")


if __name__ == "__main__":
    main()
