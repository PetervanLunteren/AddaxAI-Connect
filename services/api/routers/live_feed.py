"""
Live feed endpoints.

A project-scoped, near-real-time view of the most recent items flowing in:
successful images by their pipeline status, and rejected files resolved to the
project (e.g. an image sent at setup before the GPS fix). Rejections are read
from the rejections table, not by scanning the filesystem.
"""
import os
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User, Image, Camera, Rejection
from shared.database import get_async_session
from shared.logger import get_logger
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids, narrow_to_project


router = APIRouter(prefix="/api/projects/{project_id}/live-feed", tags=["live-feed"])
logger = get_logger("api.live_feed")


class LiveFeedItem(BaseModel):
    """One entry in the feed: either an ingested image or a rejected file."""
    kind: Literal["image", "rejection"]
    timestamp: str  # server wall-clock (ingested_at / rejected_at), ISO 8601
    device_id: Optional[str] = None
    filename: str

    # image only
    uuid: Optional[str] = None
    status: Optional[str] = None  # pending | processing | detected | classifying | classified | failed
    captured_at: Optional[str] = None  # camera clock, naive ISO
    thumbnail_url: Optional[str] = None

    # rejection only
    rejection_id: Optional[int] = None
    reason: Optional[str] = None
    details: Optional[str] = None
    image_url: Optional[str] = None


@router.get("", response_model=List[LiveFeedItem])
async def get_live_feed(
    project_id: int,
    limit: int = Query(20, ge=1, le=50),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Most recent items for the project, newest first.

    Merges the latest images (by server arrival time) with the latest rejections
    resolved to the project, then returns the newest `limit` across both.
    """
    narrow_to_project(accessible_project_ids, project_id)  # raises 403 if no access

    # Latest images for the project's cameras, by server arrival time.
    image_rows = (
        await db.execute(
            select(Image, Camera.device_id)
            .join(Camera, Image.camera_id == Camera.id)
            .where(Camera.project_id == project_id)
            .order_by(Image.ingested_at.desc())
            .limit(limit)
        )
    ).all()

    # Latest rejections resolved to the project.
    rejection_rows = (
        await db.execute(
            select(Rejection)
            .where(Rejection.project_id == project_id)
            .order_by(Rejection.rejected_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    items: list[tuple] = []  # (sort_key_datetime, LiveFeedItem)

    for image, device_id in image_rows:
        items.append((
            image.ingested_at,
            LiveFeedItem(
                kind="image",
                timestamp=image.ingested_at.isoformat(),
                device_id=device_id,
                filename=image.filename,
                uuid=image.uuid,
                status=image.status,
                captured_at=image.captured_at.isoformat() if image.captured_at else None,
                thumbnail_url=f"/api/images/{image.uuid}/thumbnail",
            ),
        ))

    for r in rejection_rows:
        items.append((
            r.rejected_at,
            LiveFeedItem(
                kind="rejection",
                timestamp=r.rejected_at.isoformat(),
                device_id=r.device_id,
                filename=r.filename,
                rejection_id=r.id,
                reason=r.reason,
                details=r.details,
                captured_at=r.captured_at.isoformat() if r.captured_at else None,
                image_url=f"/api/projects/{project_id}/live-feed/rejections/{r.id}/image",
            ),
        ))

    items.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in items[:limit]]


@router.get("/rejections/{rejection_id}/image")
async def get_rejection_image(
    project_id: int,
    rejection_id: int,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Stream a rejected file's bytes from disk (full image on click).

    Rejected files live under <upload_root>/rejected/, not in MinIO. Access is
    gated on the rejection belonging to a project the user can see.
    """
    narrow_to_project(accessible_project_ids, project_id)  # raises 403 if no access

    rejection = (
        await db.execute(select(Rejection).where(Rejection.id == rejection_id))
    ).scalar_one_or_none()

    if rejection is None or rejection.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rejection not found")

    # Path-traversal guard: the file must sit under <upload_root>/rejected/.
    upload_root = Path(os.getenv("FTPS_UPLOAD_DIR", "/uploads")).resolve()
    rejected_root = (upload_root / "rejected").resolve()
    target = Path(rejection.disk_path).resolve()
    if rejected_root not in target.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")

    if not target.is_file():
        # File was cleaned up (30-day retention) or reprocessed.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File no longer available")

    media_type = "image/jpeg"
    if target.suffix.lower() == ".png":
        media_type = "image/png"

    return FileResponse(
        str(target),
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )
