"""
Camera group endpoints for managing shared independence interval pools.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, Camera, CameraGroup
from shared.database import get_async_session
from auth.permissions import require_project_admin_access


router = APIRouter(prefix="/api/projects/{project_id}/camera-groups", tags=["camera-groups"])


# --- Schemas ---

class CameraGroupOut(BaseModel):
    id: int
    name: str
    camera_ids: List[int]
    created_at: str

class CameraGroupCreate(BaseModel):
    name: str
    camera_ids: Optional[List[int]] = None

class CameraGroupRename(BaseModel):
    name: str

class CameraGroupSetCameras(BaseModel):
    camera_ids: List[int]


# --- Helpers ---

async def _get_group_or_404(
    db: AsyncSession, group_id: int, project_id: int
) -> CameraGroup:
    result = await db.execute(
        select(CameraGroup).where(
            CameraGroup.id == group_id,
            CameraGroup.project_id == project_id,
        )
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Camera group not found")
    return group


async def _validate_camera_ids(
    db: AsyncSession, camera_ids: List[int], project_id: int, exclude_group_id: Optional[int] = None
) -> None:
    """Validate that camera IDs belong to the project and aren't in another group."""
    if not camera_ids:
        return

    result = await db.execute(
        select(Camera).where(Camera.id.in_(camera_ids))
    )
    cameras = result.scalars().all()

    found_ids = {c.id for c in cameras}
    missing = set(camera_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Camera IDs not found: {sorted(missing)}"
        )

    for cam in cameras:
        if cam.project_id != project_id:
            raise HTTPException(
                status_code=400,
                detail=f"Camera {cam.id} does not belong to this project"
            )
        if cam.camera_group_id is not None and cam.camera_group_id != exclude_group_id:
            raise HTTPException(
                status_code=400,
                detail=f"Camera {cam.id} ({cam.name}) is already in another group"
            )


def _group_to_out(group: CameraGroup) -> CameraGroupOut:
    return CameraGroupOut(
        id=group.id,
        name=group.name,
        camera_ids=[c.id for c in group.cameras],
        created_at=group.created_at.isoformat(),
    )


# --- Endpoints ---

@router.get("", response_model=List[CameraGroupOut])
async def list_camera_groups(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    result = await db.execute(
        select(CameraGroup).where(CameraGroup.project_id == project_id)
    )
    groups = result.scalars().all()
    # Eagerly load cameras for each group
    for group in groups:
        await db.refresh(group, ["cameras"])
    return [_group_to_out(g) for g in groups]


@router.post("", response_model=CameraGroupOut, status_code=201)
async def create_camera_group(
    project_id: int,
    body: CameraGroupCreate,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    # Check name uniqueness
    existing = await db.execute(
        select(CameraGroup).where(
            CameraGroup.project_id == project_id,
            CameraGroup.name == body.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A group with this name already exists")

    # Validate camera IDs if provided
    if body.camera_ids:
        await _validate_camera_ids(db, body.camera_ids, project_id)

    group = CameraGroup(project_id=project_id, name=body.name)
    db.add(group)
    await db.flush()

    # Assign cameras
    if body.camera_ids:
        result = await db.execute(
            select(Camera).where(Camera.id.in_(body.camera_ids))
        )
        for cam in result.scalars().all():
            cam.camera_group_id = group.id

    await db.commit()
    await db.refresh(group, ["cameras"])
    return _group_to_out(group)


@router.patch("/{group_id}", response_model=CameraGroupOut)
async def rename_camera_group(
    project_id: int,
    group_id: int,
    body: CameraGroupRename,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    group = await _get_group_or_404(db, group_id, project_id)

    # Check name uniqueness (exclude self)
    existing = await db.execute(
        select(CameraGroup).where(
            CameraGroup.project_id == project_id,
            CameraGroup.name == body.name,
            CameraGroup.id != group_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A group with this name already exists")

    group.name = body.name
    await db.commit()
    await db.refresh(group, ["cameras"])
    return _group_to_out(group)


@router.delete("/{group_id}", status_code=204)
async def delete_camera_group(
    project_id: int,
    group_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    group = await _get_group_or_404(db, group_id, project_id)
    await db.delete(group)
    await db.commit()


@router.put("/{group_id}/cameras", response_model=CameraGroupOut)
async def set_group_cameras(
    project_id: int,
    group_id: int,
    body: CameraGroupSetCameras,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    group = await _get_group_or_404(db, group_id, project_id)

    # Validate new camera IDs
    await _validate_camera_ids(db, body.camera_ids, project_id, exclude_group_id=group_id)

    # Remove all current cameras from this group
    result = await db.execute(
        select(Camera).where(Camera.camera_group_id == group_id)
    )
    for cam in result.scalars().all():
        cam.camera_group_id = None

    # Assign new cameras
    if body.camera_ids:
        result = await db.execute(
            select(Camera).where(Camera.id.in_(body.camera_ids))
        )
        for cam in result.scalars().all():
            cam.camera_group_id = group_id

    await db.commit()
    await db.refresh(group, ["cameras"])
    return _group_to_out(group)
