"""
Deployment endpoints.

A deployment is one camera at one site for a time range, with no free-text
metadata. The only human-editable field is its site assignment. Assigning a
site (one at a time or in bulk) sets site_source='manual', which records that a
human chose the site rather than GPS. site_source has no effect on ingestion,
it only drives the GPS-guessed vs human-confirmed badge and filter on the
Deployments page. This router serves the project-wide list, the bulk reassign,
the single PATCH and the thumbnail sample.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import Camera, Deployment, Image, Site, User
from auth.permissions import require_project_access, require_project_admin_access

logger = get_logger("api.deployments")

router = APIRouter(
    prefix="/api/projects/{project_id}/deployments",
    tags=["deployments"],
)


class DeploymentListItem(BaseModel):
    """One deployment in the project-wide list: which camera stood at which site,
    for how long, with how many photos, and whether the site is auto or manual."""
    id: int
    deployment_number: int
    camera_id: int
    camera_label: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    image_count: int
    site_source: str = 'auto'


@router.get("", response_model=List[DeploymentListItem])
async def list_deployments(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
):
    """
    Every deployment in the project, newest first. One row is one camera at one
    site for a time range. The frontend filters and sorts this list client-side.
    """
    rows = (
        await db.execute(
            text("""
                SELECT d.id, d.deployment_number, d.camera_id,
                       c.device_id AS camera_label,
                       d.site_id, s.name AS site_name,
                       ST_Y(d.location::geometry) AS lat,
                       ST_X(d.location::geometry) AS lon,
                       d.start_date, d.end_date, d.site_source,
                       count(i.id) AS image_count
                FROM deployments d
                JOIN cameras c ON c.id = d.camera_id
                LEFT JOIN sites s ON s.id = d.site_id
                LEFT JOIN images i ON i.deployment_id = d.id
                WHERE c.project_id = :project_id
                GROUP BY d.id, c.device_id, s.name
                ORDER BY d.start_date DESC NULLS LAST, d.id DESC
            """),
            {"project_id": project_id},
        )
    ).mappings().all()

    return [
        DeploymentListItem(
            id=r["id"],
            deployment_number=r["deployment_number"],
            camera_id=r["camera_id"],
            camera_label=r["camera_label"],
            site_id=r["site_id"],
            site_name=r["site_name"],
            latitude=float(r["lat"]) if r["lat"] is not None else None,
            longitude=float(r["lon"]) if r["lon"] is not None else None,
            start_date=r["start_date"].isoformat() if r["start_date"] else None,
            end_date=r["end_date"].isoformat() if r["end_date"] else None,
            image_count=r["image_count"],
            site_source=r["site_source"],
        )
        for r in rows
    ]


class BulkAssignSiteRequest(BaseModel):
    # The deployments to reassign and the site to put them on (null = unassign).
    # Every deployment must belong to the project; the site, when given, too.
    deployment_ids: List[int]
    site_id: Optional[int] = None


class BulkAssignSiteResponse(BaseModel):
    updated: int


@router.post("/bulk-site", response_model=BulkAssignSiteResponse)
async def bulk_assign_site(
    project_id: int,
    request: BulkAssignSiteRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    Reassign many deployments to one site at once. Like the single PATCH, this is
    a human correction, so every touched deployment becomes site_source='manual'
    (marking it human-confirmed for the badge and filter). All-or-nothing: if any
    deployment is not in the project, or the site is not, nothing changes (404).
    """
    if not request.deployment_ids:
        return BulkAssignSiteResponse(updated=0)

    if request.site_id is not None:
        site = (
            await db.execute(
                select(Site).where(
                    Site.id == request.site_id, Site.project_id == project_id
                )
            )
        ).scalar_one_or_none()
        if site is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Site not found",
            )

    deployments = (
        await db.execute(
            select(Deployment)
            .join(Camera, Camera.id == Deployment.camera_id)
            .where(
                Deployment.id.in_(request.deployment_ids),
                Camera.project_id == project_id,
            )
        )
    ).scalars().all()

    # A mismatch means some id is missing or in another project. Refuse the whole
    # batch so a partial reassignment never silently happens.
    if len(deployments) != len(set(request.deployment_ids)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more deployments not found in this project",
        )

    for deployment in deployments:
        deployment.site_id = request.site_id
        deployment.site_source = 'manual'

    await db.commit()
    return BulkAssignSiteResponse(updated=len(deployments))


class UpdateDeploymentRequest(BaseModel):
    # Reassign the deployment to a site. Send null to unassign. Omit to leave
    # unchanged. Setting it (incl. null) marks the deployment site_source='manual'
    # to record it was human-confirmed. Presence is read via model_fields_set.
    site_id: Optional[int] = None


class DeploymentDetail(BaseModel):
    id: int
    deployment_number: int
    camera_id: int
    site_id: Optional[int] = None
    site_source: str = 'auto'


@router.patch("/{deployment_id}", response_model=DeploymentDetail)
async def update_deployment(
    project_id: int,
    deployment_id: int,
    request: UpdateDeploymentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    Reassign a deployment's site. The deployment must belong to a camera in
    `project_id`; a mismatch returns 404 so existence does not leak.
    """
    row = (
        await db.execute(
            select(Deployment, Camera.project_id)
            .join(Camera, Camera.id == Deployment.camera_id)
            .where(Deployment.id == deployment_id)
        )
    ).first()
    if row is None or row[1] != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found",
        )

    deployment: Deployment = row[0]

    # site_id is meaningful even when null (unassign), so act on its presence in
    # the request, not on its value. Any human assignment marks the deployment
    # site_source='manual' to record it was human-confirmed.
    if 'site_id' in request.model_fields_set:
        if request.site_id is not None:
            site = (
                await db.execute(
                    select(Site).where(
                        Site.id == request.site_id, Site.project_id == project_id
                    )
                )
            ).scalar_one_or_none()
            if site is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Site not found",
                )
        deployment.site_id = request.site_id
        deployment.site_source = 'manual'

    await db.commit()
    await db.refresh(deployment)

    return DeploymentDetail(
        id=deployment.id,
        deployment_number=deployment.deployment_number,
        camera_id=deployment.camera_id,
        site_id=deployment.site_id,
        site_source=deployment.site_source,
    )


class DeploymentThumbnails(BaseModel):
    uuids: List[str]


@router.get("/{deployment_id}/thumbnails", response_model=DeploymentThumbnails)
async def deployment_thumbnails(
    project_id: int,
    deployment_id: int,
    limit: int = Query(6, ge=1, le=12),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
):
    """
    A random sample of image UUIDs from this deployment, so the UI can show a
    few thumbnails as visual confirmation of the location. Skips hidden images
    and images without stored files. 404 if the deployment is not in the project.
    """
    row = (
        await db.execute(
            select(Deployment.id, Camera.project_id)
            .join(Camera, Camera.id == Deployment.camera_id)
            .where(Deployment.id == deployment_id)
        )
    ).first()
    if row is None or row[1] != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found",
        )

    uuids = (
        await db.execute(
            select(Image.uuid)
            .where(
                Image.deployment_id == deployment_id,
                Image.is_hidden == False,  # noqa: E712
                Image.storage_path.isnot(None),
            )
            .order_by(func.random())
            .limit(limit)
        )
    ).scalars().all()
    return DeploymentThumbnails(uuids=list(uuids))
