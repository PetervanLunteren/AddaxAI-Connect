"""
Remove bulk-upload copies of photos that a camera already sent over 4G.

Before v0.21 the bulk upload missed these doubles. A burst camera puts two or
three files in one camera second, and its 4G copy of the first photo has
another name and size, so the byte check could not see it. On pwn 1719 and on
spw 111 photos ended up in the project twice.

Per camera, the images of its old bulk jobs are compared with its live images
at the same seconds, with the rule the upload uses now (files_already_present
in shared/shared/bulk_dedup.py). The bulk copy goes, the live photo stays,
with its alerts and verifications. All old jobs of a camera are compared at
once, because two SD folders can cover the same days and must not both claim
one live photo.

Only jobs processed before the rule existed are looked at. A newer job left
these copies out at upload, so comparing it again would remove real burst
frames. The newer worker writes skip_reasons into the job summary; a job
without it is old.

Safe to run again:
  - An image that is verified or has a human observation is never deleted.
    It is listed, to decide by hand.
  - Before deleting, the exact image ids are written into each job's
    manifest, for all jobs of a camera at once. A second run deletes only
    what is left of those lists and never computes the doubles again, which
    after a partial run would remove too much.

Usage (on a server, dry run first):
    docker compose exec -T api python /app/scripts/remove_live_twins.py
    docker compose exec -T api python /app/scripts/remove_live_twins.py --apply
    docker compose exec -T api python /app/scripts/remove_live_twins.py --project-id 1
"""
import argparse
import asyncio
import sys
from datetime import datetime
from typing import Iterable, List, Sequence, Set, Tuple

# Add parent directory to path for imports (matches the other scripts).
sys.path.insert(0, "/app")

from shared.bulk_dedup import files_already_present  # noqa: E402

# Manifest key that holds the image ids picked for deletion in a job.
MARKER = "live_twins_removed"

# (image id, filename, captured_at)
BulkImage = Tuple[int, str, datetime]


def pick_twins(
    bulk_images: Sequence[BulkImage],
    live_images: Iterable[Tuple[str, datetime]],
    protected_ids: Set[int],
) -> Tuple[List[int], List[int]]:
    """
    Return (ids to delete, ids kept because people worked on them).

    The bulk images play the folder, the live images the project, so the
    bulk images the upload would now skip are the doubles.
    """
    files = [(name, captured_at) for _id, name, captured_at in bulk_images]
    twins = [bulk_images[i][0] for i in files_already_present(files, list(live_images))]
    return (
        [i for i in twins if i not in protected_ids],
        [i for i in twins if i in protected_ids],
    )


def is_old_job(manifest: dict) -> bool:
    """Processed before the upload left out 4G copies (no skip_reasons yet)."""
    return "skip_reasons" not in (manifest.get("process_summary") or {})


async def run(apply: bool, project_id: int | None) -> None:
    from collections import defaultdict

    from sqlalchemy import select

    from routers.image_admin import delete_images_by_ids
    from shared.database import AsyncSessionLocal
    from shared.models import BulkUploadJob, HumanObservation, Image

    async with AsyncSessionLocal() as db:
        query = select(BulkUploadJob).where(
            BulkUploadJob.status.in_(("done", "cancelled", "failed"))
        ).order_by(BulkUploadJob.id)
        if project_id is not None:
            query = query.where(BulkUploadJob.project_id == project_id)
        jobs = (await db.execute(query)).scalars().all()

        # Pick, per camera, for the old jobs that have no list yet.
        to_pick = defaultdict(list)
        for job in jobs:
            manifest = job.manifest or {}
            if MARKER not in manifest and is_old_job(manifest):
                to_pick[job.camera_id].append(job)

        for camera_id, camera_jobs in to_pick.items():
            job_of = {}
            bulk = []
            for job in camera_jobs:
                rows = (await db.execute(
                    select(Image.id, Image.filename, Image.captured_at)
                    .where(Image.bulk_upload_job_id == job.id)
                )).all()
                for image_id, name, captured_at in rows:
                    job_of[image_id] = job
                    bulk.append((image_id, name, captured_at))
            if not bulk:
                continue
            seconds = {captured_at for _id, _name, captured_at in bulk}
            live = (await db.execute(
                select(Image.filename, Image.captured_at).where(
                    Image.camera_id == camera_id,
                    Image.origin == "live",
                    Image.captured_at.in_(seconds),
                )
            )).all()
            bulk_ids = list(job_of)
            protected = set((await db.execute(
                select(Image.id).where(Image.id.in_(bulk_ids), Image.is_verified.is_(True))
            )).scalars().all()) | set((await db.execute(
                select(HumanObservation.image_id).where(HumanObservation.image_id.in_(bulk_ids))
            )).scalars().all())

            to_delete, kept = pick_twins(bulk, [tuple(row) for row in live], protected)
            per_job = defaultdict(list)
            for image_id in to_delete:
                per_job[job_of[image_id].id].append(image_id)
            for job in camera_jobs:
                print(f"job {job.id} {job.original_filename} (camera {camera_id}): "
                      f"{sum(1 for j in job_of.values() if j is job)} imported, "
                      f"{len(per_job[job.id])} doubles to remove")
            for image_id in kept:
                print(f"  kept, worked on by a person: image {image_id}")
            if apply:
                # Write every list of this camera first, so a second run
                # deletes only these.
                for job in camera_jobs:
                    job.manifest = {**(job.manifest or {}), MARKER: per_job[job.id]}
                await db.commit()

        if not apply:
            print("Dry run, nothing written. Run with --apply to delete.")
            return

        total_deleted = 0
        for job in jobs:
            await db.refresh(job)
            picked = (job.manifest or {}).get(MARKER) or []
            if not picked:
                continue
            still_there = list((await db.execute(
                select(Image.id).where(Image.id.in_(picked))
            )).scalars().all())
            deleted, errors, _emptied = await delete_images_by_ids(db, still_there)
            total_deleted += deleted
            for error in errors:
                print(f"  {error}")
        print(f"Deleted {total_deleted} images.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="delete; without it this is a dry run")
    parser.add_argument("--project-id", type=int, help="limit to one project")
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.project_id))


if __name__ == "__main__":
    main()
