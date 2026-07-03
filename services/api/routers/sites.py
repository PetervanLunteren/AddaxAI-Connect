"""
Site endpoints.

A site is a physical place that groups deployments (one camera at the site for
a time range). See future-plans/site-addition.md. Reads are open to any project
member; create, rename, merge and delete require project admin.
"""
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.elements import WKTElement
from pydantic import BaseModel, Field
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import Site, Deployment, User
from auth.permissions import require_project_access, require_project_admin_access
from utils.deployment_edits import recompute_site_location

logger = get_logger("api.sites")

router = APIRouter(
    prefix="/api/projects/{project_id}/sites",
    tags=["sites"],
)


class SiteListItem(BaseModel):
    id: int
    uuid: str
    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    habitat_type: Optional[str] = None
    camera_count: int
    deployment_count: int
    image_count: int
    # Naive camera-clock timestamp of the most recent image at this site.
    last_activity: Optional[str] = None
    tags: Optional[List[str]] = None


class DeploymentSummary(BaseModel):
    id: int
    deployment_number: int
    camera_id: int
    camera_name: str
    # The deployment's own GPS point, used as the default when creating a new
    # site from this deployment.
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    image_count: int


class SiteDetail(BaseModel):
    id: int
    uuid: str
    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    habitat_type: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    camera_count: int
    deployment_count: int
    image_count: int
    deployments: List[DeploymentSummary]


class CreateSiteRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    habitat_type: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = None


class UpdateSiteRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    habitat_type: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


def _normalize_tags(tags: Optional[List[str]]) -> List[str]:
    """Normalize tags: lowercase, strip, deduplicate, remove empties and commas.
    Same shape used for camera tags."""
    if not tags:
        return []
    seen: set = set()
    result: List[str] = []
    for raw in tags:
        tag = raw.strip().lower().replace(',', '')
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


class MergeSiteRequest(BaseModel):
    # Merge this site INTO target_site_id: every deployment moves to the
    # target and this site is deleted.
    target_site_id: int


async def _site_in_project(db: AsyncSession, project_id: int, site_id: int) -> Site:
    site = (
        await db.execute(
            select(Site).where(Site.id == site_id, Site.project_id == project_id)
        )
    ).scalar_one_or_none()
    if site is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return site


async def _build_detail(db: AsyncSession, project_id: int, site_id: int) -> SiteDetail:
    """Site row plus its deployments and aggregate counts."""
    head = (
        await db.execute(
            text("""
                SELECT s.id, s.uuid, s.name, s.habitat_type, s.notes, s.tags,
                       ST_Y(s.location::geometry) AS lat,
                       ST_X(s.location::geometry) AS lon
                FROM sites s
                WHERE s.id = :site_id AND s.project_id = :project_id
            """),
            {"site_id": site_id, "project_id": project_id},
        )
    ).mappings().first()
    if head is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    dep_rows = (
        await db.execute(
            text("""
                SELECT d.id, d.deployment_number, d.camera_id, c.device_id AS camera_name,
                       d.start_date, d.end_date,
                       ST_Y(d.location::geometry) AS lat,
                       ST_X(d.location::geometry) AS lon,
                       count(i.id) AS image_count
                FROM deployments d
                JOIN cameras c ON c.id = d.camera_id
                LEFT JOIN images i ON i.deployment_id = d.id
                WHERE d.site_id = :site_id
                GROUP BY d.id, c.device_id
                ORDER BY c.device_id, d.deployment_number
            """),
            {"site_id": site_id},
        )
    ).mappings().all()

    deployments = [
        DeploymentSummary(
            id=r["id"],
            deployment_number=r["deployment_number"],
            camera_id=r["camera_id"],
            camera_name=r["camera_name"],
            latitude=float(r["lat"]) if r["lat"] is not None else None,
            longitude=float(r["lon"]) if r["lon"] is not None else None,
            start_date=r["start_date"].isoformat() if r["start_date"] else None,
            end_date=r["end_date"].isoformat() if r["end_date"] else None,
            image_count=r["image_count"],
        )
        for r in dep_rows
    ]

    return SiteDetail(
        id=head["id"],
        uuid=head["uuid"],
        name=head["name"],
        latitude=float(head["lat"]) if head["lat"] is not None else None,
        longitude=float(head["lon"]) if head["lon"] is not None else None,
        habitat_type=head["habitat_type"],
        notes=head["notes"],
        tags=head["tags"],
        camera_count=len({d.camera_id for d in deployments}),
        deployment_count=len(deployments),
        image_count=sum(d.image_count for d in deployments),
        deployments=deployments,
    )


@router.get("", response_model=List[SiteListItem])
async def list_sites(
    project_id: int,
    user: User = Depends(require_project_access),
    db: AsyncSession = Depends(get_async_session),
):
    """List the project's sites with aggregate counts and last activity."""
    rows = (
        await db.execute(
            text("""
                SELECT s.id, s.uuid, s.name, s.habitat_type, s.tags,
                       ST_Y(s.location::geometry) AS lat,
                       ST_X(s.location::geometry) AS lon,
                       count(DISTINCT d.id) AS deployment_count,
                       count(DISTINCT d.camera_id) AS camera_count,
                       count(i.id) AS image_count,
                       max(i.captured_at) AS last_activity
                FROM sites s
                LEFT JOIN deployments d ON d.site_id = s.id
                LEFT JOIN images i ON i.deployment_id = d.id
                WHERE s.project_id = :project_id
                GROUP BY s.id
                ORDER BY s.name
            """),
            {"project_id": project_id},
        )
    ).mappings().all()

    return [
        SiteListItem(
            id=r["id"],
            uuid=r["uuid"],
            name=r["name"],
            latitude=float(r["lat"]) if r["lat"] is not None else None,
            longitude=float(r["lon"]) if r["lon"] is not None else None,
            habitat_type=r["habitat_type"],
            camera_count=r["camera_count"],
            deployment_count=r["deployment_count"],
            image_count=r["image_count"],
            last_activity=r["last_activity"].isoformat() if r["last_activity"] else None,
            tags=r["tags"],
        )
        for r in rows
    ]


@router.get("/tags", response_model=List[str])
async def get_site_tags(
    project_id: int,
    user: User = Depends(require_project_access),
    db: AsyncSession = Depends(get_async_session),
):
    """All unique tags across sites in this project, sorted, used for TagInput autocomplete."""
    result = await db.execute(
        select(Site.tags).where(
            Site.project_id == project_id,
            Site.tags.isnot(None),
        )
    )
    all_tags: set = set()
    for (tags,) in result.all():
        if tags:
            for tag in tags:
                if tag and isinstance(tag, str):
                    all_tags.add(tag.strip().lower())
    return sorted(all_tags)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SiteDetail)
async def create_site(
    project_id: int,
    body: CreateSiteRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a site at the given coordinates."""
    site = Site(
        uuid=str(uuid.uuid4()),
        project_id=project_id,
        name=body.name.strip(),
        location=WKTElement(f"POINT({body.longitude} {body.latitude})", srid=4326),
        habitat_type=body.habitat_type,
        notes=body.notes,
    )
    db.add(site)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'A site named "{body.name.strip()}" already exists in this project',
        )
    await db.refresh(site)
    logger.info("Created site", site_id=site.id, project_id=project_id, site_name=site.name)
    return await _build_detail(db, project_id, site.id)


@router.get("/{site_id}", response_model=SiteDetail)
async def get_site(
    project_id: int,
    site_id: int,
    user: User = Depends(require_project_access),
    db: AsyncSession = Depends(get_async_session),
):
    """One site with its deployments."""
    return await _build_detail(db, project_id, site_id)


@router.patch("/{site_id}", response_model=SiteDetail)
async def update_site(
    project_id: int,
    site_id: int,
    body: UpdateSiteRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Rename a site or edit its habitat type / notes / tags."""
    site = await _site_in_project(db, project_id, site_id)
    if body.name is not None:
        site.name = body.name.strip()
    if body.habitat_type is not None:
        site.habitat_type = body.habitat_type or None
    if body.notes is not None:
        site.notes = body.notes or None
    if body.tags is not None:
        site.tags = _normalize_tags(body.tags)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another site in this project already has that name",
        )
    return await _build_detail(db, project_id, site_id)


@router.post("/{site_id}/merge", response_model=SiteDetail)
async def merge_site(
    project_id: int,
    site_id: int,
    body: MergeSiteRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Merge this site into target_site_id: move every deployment to the target,
    then delete this site. Returns the target site.
    """
    if body.target_site_id == site_id:
        raise HTTPException(status_code=400, detail="Cannot merge a site into itself")
    source = await _site_in_project(db, project_id, site_id)
    target = await _site_in_project(db, project_id, body.target_site_id)

    await db.execute(
        update(Deployment).where(Deployment.site_id == source.id).values(site_id=target.id)
    )
    await db.delete(source)
    # The target absorbed the source's deployments, so recompute its pin.
    await db.flush()
    await recompute_site_location(db, target.id)
    await db.commit()
    logger.info(
        "Merged site",
        source_site_id=site_id,
        target_site_id=target.id,
        project_id=project_id,
    )
    return await _build_detail(db, project_id, target.id)


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    project_id: int,
    site_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Delete a site. Its deployments keep their rows but lose the site link
    (deployments.site_id is set to NULL by the foreign key).
    """
    site = await _site_in_project(db, project_id, site_id)
    await db.delete(site)
    await db.commit()
    logger.info("Deleted site", site_id=site_id, project_id=project_id)
