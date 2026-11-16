"""
Remove bulk-upload copies of photos that a camera already sent over 4G.

Before v0.21 the bulk upload missed these doubles. A burst camera puts two or
three files in one camera second, and its 4G copy of the first photo has
another name and size, so the byte check could not see it. On pwn 1719 and on
spw 111 photos ended up in the project twice.

Per finished bulk job, the job's images are compared with the live images of
the same camera at the same seconds, with the rule the upload uses now
(files_already_present in shared/shared/bulk_dedup.py). The bulk copy goes,
the live photo stays, with its alerts and verifications.

Safe to run again:
  - An image that is verified or has a human observation is never deleted.
    It is listed, to decide by hand.
  - Before deleting, the exact image ids are written into the job's manifest.
    A second run deletes only what is left of that list and never computes
    the doubles again, which after a partial run would remove too much.

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


async def run(apply: bool, project_id: int | None) -> None:
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

        total_deleted = 0
        for job in jobs:
            manifest = dict(job.manifest or {})
            label = f"job {job.id} {job.original_filename} (camera {job.camera_id})"

            if MARKER in manifest:
                to_delete = list(manifest[MARKER])
                print(f"{label}: picked before, {len(to_delete)} ids")
            else:
                bulk = (await db.execute(
                    select(Image.id, Image.filename, Image.captured_at)
                    .where(Image.bulk_upload_job_id == job.id)
                )).all()
                if not bulk:
                    continue
                seconds = {captured_at for _id, _name, captured_at in bulk}
                live = (await db.execute(
                    select(Image.filename, Image.captured_at).where(
                        Image.camera_id == job.camera_id,
                        Image.origin == "live",
                        Image.captured_at.in_(seconds),
                    )
                )).all()
                bulk_ids = [row[0] for row in bulk]
                protected = set((await db.execute(
                    select(Image.id).where(Image.id.in_(bulk_ids), Image.is_verified.is_(True))
                )).scalars().all()) | set((await db.execute(
                    select(HumanObservation.image_id).where(HumanObservation.image_id.in_(bulk_ids))
                )).scalars().all())

                to_delete, kept = pick_twins(
                    [tuple(row) for row in bulk], [tuple(row) for row in live], protected,
                )
                print(f"{label}: {len(bulk)} imported, {len(to_delete)} doubles to remove")
                for image_id in kept:
                    print(f"  kept, worked on by a person: image {image_id}")
                if not to_delete or not apply:
                    continue
                # Write the list first, so a second run deletes only these.
                job.manifest = {**manifest, MARKER: to_delete}
                await db.commit()

            if not apply:
                continue
            still_there = list((await db.execute(
                select(Image.id).where(Image.id.in_(to_delete))
            )).scalars().all())
            deleted, errors, _emptied = await delete_images_by_ids(db, still_there)
            total_deleted += deleted
            for error in errors:
                print(f"  {error}")

        if apply:
            print(f"Deleted {total_deleted} images.")
        else:
            print("Dry run, nothing written. Run with --apply to delete.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="delete; without it this is a dry run")
    parser.add_argument("--project-id", type=int, help="limit to one project")
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.project_id))


if __name__ == "__main__":
    main()
