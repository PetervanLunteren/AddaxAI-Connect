"""
Remove second copies of photos that a Willfine camera sent twice.

On a weak mobile link a Willfine upload can break halfway. The camera then
sends the whole photo again a minute or two later, and before v0.22 both
copies became an image. On lab (Namibia, Nov 2026) 94 photos were stored
twice, mostly a truncated copy next to a complete one. Since v0.22 ingestion
holds an incomplete photo for a few minutes and keeps the best copy (see
"Broken uploads that the camera sends again" in DEVELOPERS.md). This script
cleans up what came in before that.

Same photo means the same camera, the same file name and the same camera
clock second. Only live images whose EXIF Make is Willfine are looked at.
Per photo one copy stays:

  - A copy that is verified or has a human observation is never deleted.
    When there is one, the other copies go. When there are several, they
    all stay and are listed, to decide by hand.
  - Otherwise a copy replaced by the privacy placeholder stays, so a removed
    person never comes back through its double.
  - Otherwise the biggest stored file stays, the most complete copy. When
    a size cannot be read, all copies stay and are listed, to decide by hand.

A second run finds nothing left to delete, so it is safe to run again.

Usage (on a server, dry run first):
    docker compose exec -T api python /app/scripts/remove_resent_copies.py
    docker compose exec -T api python /app/scripts/remove_resent_copies.py --apply
    docker compose exec -T api python /app/scripts/remove_resent_copies.py --project-id 4
"""
import argparse
import asyncio
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

# Add parent directory to path for imports (matches the other scripts).
sys.path.insert(0, "/app")


@dataclass(frozen=True)
class Copy:
    id: int
    size: Optional[int]       # stored bytes; None when unknown
    worked_on: bool           # verified or has a human observation
    privacy_removed: bool     # replaced by the privacy placeholder


def pick_copies(copies: Sequence[Copy]) -> Tuple[List[int], List[int]]:
    """Return (ids to keep, ids to delete) for the copies of one photo."""
    worked_on = [c.id for c in copies if c.worked_on]
    removed = [c.id for c in copies if c.privacy_removed]
    if worked_on:
        keep = worked_on
    elif removed:
        keep = removed[:1]
    elif any(c.size is None for c in copies):
        # Which copy is better is unknown, so nothing is deleted on a guess.
        keep = [c.id for c in copies]
    else:
        # The biggest file is the most complete copy; a tie keeps the oldest row.
        keep = [min(copies, key=lambda c: (-c.size, c.id)).id]
    delete = [c.id for c in copies if c.id not in keep]
    return sorted(keep), sorted(delete)


def stored_size(storage, key: str) -> Optional[int]:
    """Size from the object's metadata, without downloading it."""
    from shared.storage import BUCKET_RAW_IMAGES
    try:
        return int(storage.client.head_object(Bucket=BUCKET_RAW_IMAGES, Key=key)["ContentLength"])
    except Exception as e:
        print(f"  could not read the size of {key}: {e}")
        return None


async def run(apply: bool, project_id: Optional[int]) -> None:
    from sqlalchemy import func, select

    from routers.image_admin import delete_images_by_ids
    from shared.database import AsyncSessionLocal
    from shared.models import Camera, HumanObservation, Image
    from shared.storage import StorageClient

    storage = StorageClient()
    async with AsyncSessionLocal() as db:
        copies_of_photo = func.count().over(
            partition_by=(Image.camera_id, Image.filename, Image.captured_at)
        ).label("copies")
        inner = (
            select(Image.id, Image.camera_id, Image.filename, Image.captured_at,
                   Image.storage_path, Image.is_verified, Image.privacy_removed_at,
                   copies_of_photo)
            .join(Camera, Camera.id == Image.camera_id)
            .where(
                Image.origin == "live",
                Image.image_metadata["Make"].as_string().ilike("willfine%"),
            )
        )
        if project_id is not None:
            inner = inner.where(Camera.project_id == project_id)
        inner = inner.subquery()
        rows = (await db.execute(
            select(inner).where(inner.c.copies > 1)
            .order_by(inner.c.camera_id, inner.c.captured_at, inner.c.id)
        )).all()

        ids = [r.id for r in rows]
        observed = set((await db.execute(
            select(HumanObservation.image_id).where(HumanObservation.image_id.in_(ids))
        )).scalars().all()) if ids else set()

        photos = defaultdict(list)
        for r in rows:
            photos[(r.camera_id, r.filename, r.captured_at)].append(r)

        to_delete = defaultdict(list)
        for (camera_id, filename, captured_at), group in photos.items():
            copies = [
                Copy(
                    id=r.id,
                    size=None if r.privacy_removed_at else stored_size(storage, r.storage_path),
                    worked_on=bool(r.is_verified) or r.id in observed,
                    privacy_removed=r.privacy_removed_at is not None,
                )
                for r in group
            ]
            keep, delete = pick_copies(copies)
            sizes = ", ".join(f"{c.id}={c.size if c.size is not None else '?'}" for c in copies)
            print(f"camera {camera_id} {filename} {captured_at}: keep {keep}, delete {delete} (bytes {sizes})")
            if len(keep) > 1:
                print("  kept all: several were worked on by a person, or a size is unknown. Decide by hand")
            to_delete[camera_id].extend(delete)

        total = sum(len(v) for v in to_delete.values())
        print(f"{len(photos)} photos with more than one copy, {total} copies to delete.")
        if not apply:
            print("Dry run, nothing written. Run with --apply to delete.")
            return

        deleted = 0
        for camera_id, image_ids in to_delete.items():
            if not image_ids:
                continue
            count, errors, _emptied = await delete_images_by_ids(db, image_ids)
            deleted += count
            for error in errors:
                print(f"  {error}")
        print(f"Deleted {deleted} images.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="delete; without it this is a dry run")
    parser.add_argument("--project-id", type=int, help="limit to one project")
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.project_id))


if __name__ == "__main__":
    main()
