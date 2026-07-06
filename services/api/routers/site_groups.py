"""
Site group endpoints ("Merged sites").

A site group pools several sites into one place for the independence interval.
Cameras at a single site already pool automatically; a group is only for
merging distinct sites, e.g. both ends of a wildlife crossing.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, Site, SiteGroup
from shared.database import get_async_session
from auth.permissions import require_project_admin_access


router = APIRouter(prefix="/api/projects/{project_id}/site-groups", tags=["site-groups"])


# --- Schemas ---

class SiteGroupOut(BaseModel):
    id: int
    name: str
    site_ids: List[int]
    created_at: str

class SiteGroupCreate(BaseModel):
    name: str
    site_ids: Optional[List[int]] = None

class SiteGroupRename(BaseModel):
    name: str

class SiteGroupSetSites(BaseModel):
    site_ids: List[int]


# --- Helpers ---

async def _get_group_or_404(
    db: AsyncSession, group_id: int, project_id: int
) -> SiteGroup:
    result = await db.execute(
        select(SiteGroup).where(
            SiteGroup.id == group_id,
            SiteGroup.project_id == project_id,
        )
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Site group not found")
    return group


async def _validate_site_ids(
    db: AsyncSession, site_ids: List[int], project_id: int, exclude_group_id: Optional[int] = None
) -> None:
    """Validate that site IDs belong to the project and aren't in another group."""
    if not site_ids:
        return

    result = await db.execute(
        select(Site).where(Site.id.in_(site_ids))
    )
    sites = result.scalars().all()

    found_ids = {s.id for s in sites}
    missing = set(site_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Site IDs not found: {sorted(missing)}"
        )

    for site in sites:
        if site.project_id != project_id:
            raise HTTPException(
                status_code=400,
                detail=f"Site {site.id} does not belong to this project"
            )
        if site.site_group_id is not None and site.site_group_id != exclude_group_id:
            raise HTTPException(
                status_code=400,
                detail=f"Site {site.id} ({site.name}) is already in another group"
            )


def _group_to_out(group: SiteGroup) -> SiteGroupOut:
    return SiteGroupOut(
        id=group.id,
        name=group.name,
        site_ids=[s.id for s in group.sites],
        created_at=group.created_at.isoformat(),
    )


# --- Endpoints ---

@router.get("", response_model=List[SiteGroupOut])
async def list_site_groups(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    result = await db.execute(
        select(SiteGroup).where(SiteGroup.project_id == project_id)
    )
    groups = result.scalars().all()
    # Eagerly load sites for each group
    for group in groups:
        await db.refresh(group, ["sites"])
    return [_group_to_out(g) for g in groups]


@router.post("", response_model=SiteGroupOut, status_code=201)
async def create_site_group(
    project_id: int,
    body: SiteGroupCreate,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    # Check name uniqueness
    existing = await db.execute(
        select(SiteGroup).where(
            SiteGroup.project_id == project_id,
            SiteGroup.name == body.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A group with this name already exists")

    # Validate site IDs if provided
    if body.site_ids:
        await _validate_site_ids(db, body.site_ids, project_id)

    group = SiteGroup(project_id=project_id, name=body.name)
    db.add(group)
    await db.flush()

    # Assign sites
    if body.site_ids:
        result = await db.execute(
            select(Site).where(Site.id.in_(body.site_ids))
        )
        for site in result.scalars().all():
            site.site_group_id = group.id

    await db.commit()
    await db.refresh(group, ["sites"])
    return _group_to_out(group)


@router.patch("/{group_id}", response_model=SiteGroupOut)
async def rename_site_group(
    project_id: int,
    group_id: int,
    body: SiteGroupRename,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    group = await _get_group_or_404(db, group_id, project_id)

    # Check name uniqueness (exclude self)
    existing = await db.execute(
        select(SiteGroup).where(
            SiteGroup.project_id == project_id,
            SiteGroup.name == body.name,
            SiteGroup.id != group_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A group with this name already exists")

    group.name = body.name
    await db.commit()
    await db.refresh(group, ["sites"])
    return _group_to_out(group)


@router.delete("/{group_id}", status_code=204)
async def delete_site_group(
    project_id: int,
    group_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    group = await _get_group_or_404(db, group_id, project_id)
    await db.delete(group)
    await db.commit()


@router.put("/{group_id}/sites", response_model=SiteGroupOut)
async def set_group_sites(
    project_id: int,
    group_id: int,
    body: SiteGroupSetSites,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    group = await _get_group_or_404(db, group_id, project_id)

    # Validate new site IDs
    await _validate_site_ids(db, body.site_ids, project_id, exclude_group_id=group_id)

    # Remove all current sites from this group
    result = await db.execute(
        select(Site).where(Site.site_group_id == group_id)
    )
    for site in result.scalars().all():
        site.site_group_id = None

    # Assign new sites
    if body.site_ids:
        result = await db.execute(
            select(Site).where(Site.id.in_(body.site_ids))
        )
        for site in result.scalars().all():
            site.site_group_id = group_id

    await db.commit()
    await db.refresh(group, ["sites"])
    return _group_to_out(group)
