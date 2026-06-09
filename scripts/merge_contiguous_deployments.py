"""
Merge contiguous same-site deployments (debris from the old GPS split bug).

A deployment is one camera at one site for a continuous time range. A now-fixed
ingestion bug (a junk (0,0) GPS reading from a daily report) could split one
continuous placement into two same-site deployments with no real gap between them
(e.g. ends 22 Apr, next starts 23 Apr). Those are not two deployments in any real
sense, just a phantom relocation on the Deployments page.

This merges every such pair: it extends the earlier deployment over the later one,
moves the later's images onto it, deletes the later row, and recomputes the site
pin. The merge logic lives in shared.deployments (single source of truth, also
used by the live reassignment hook in the API).

Conservative and safe:
  - only same-camera, same non-null site deployments (a real move to a different
    site is never touched)
  - only when there is no real gap (the later starts within
    DEPLOYMENT_MERGE_GAP_DAYS of the earlier's end), so a genuine remove-and-
    redeploy at the same site (which has a multi-day gap) is never merged
  - nothing is lost: the survivor keeps every image and covers the full period

Idempotent and re-runnable. Run --dry-run first.

Usage:
    python merge_contiguous_deployments.py --dry-run      # report, write nothing
    python merge_contiguous_deployments.py                # merge
    python merge_contiguous_deployments.py --project-id 3 # limit to one project
"""
import argparse
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports (matches the other scripts).
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger
from shared.deployments import merge_camera_contiguous

settings = get_settings()
logger = get_logger("merge_contiguous_deployments")


def list_cameras(session: Session, project_id):
    where_project = "WHERE project_id = :project_id" if project_id is not None else ""
    return session.execute(
        text(f"SELECT id, device_id FROM cameras {where_project} ORDER BY id"),
        {"project_id": project_id},
    ).mappings().all()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge a camera's contiguous same-site deployments."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would merge without writing.")
    parser.add_argument("--project-id", type=int, default=None,
                        help="Limit to a single project id.")
    args = parser.parse_args()

    mode = "DRY RUN (no writes)" if args.dry_run else "APPLY"
    logger.info("Starting contiguous-deployment merge", mode=mode, project_id=args.project_id)

    engine = create_engine(settings.database_url)
    with Session(engine) as session:
        cameras_affected = 0
        total_merged = 0
        for cam in list_cameras(session, args.project_id):
            merged = merge_camera_contiguous(session, cam["id"])
            if merged:
                cameras_affected += 1
                total_merged += merged
                print(f"  camera {cam['device_id']}: merged {merged} deployment(s)")

        print(f"\n=== {mode} ===")
        print(f"  cameras affected        : {cameras_affected}")
        print(f"  deployments merged away : {total_merged}")

        if args.dry_run:
            session.rollback()
            print("\nDry run, nothing written.")
        else:
            session.commit()
            print("\nDone.")

    logger.info("Contiguous-deployment merge complete",
                cameras_affected=cameras_affected, merged=total_merged, mode=mode)


if __name__ == "__main__":
    main()
