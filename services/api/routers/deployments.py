"""
Deployment endpoints.

A deployment is one camera at one site for a time range, with no free-text
metadata. Deployments are created by ingestion and corrected via the camera
updates feed; this router serves the project-wide list, the single PATCH used
by the camera-slideout escape hatch, and the thumbnail sample. Assigning a
site sets site_source='manual', which records that a human chose the site
rather than GPS. site_source has no effect on ingestion.
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
from utils.deployment_edits import reassign_deployment_site

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


class UpdateDeploymentRequest(BaseModel):
    # Reassign the deployment to a site. Send null to unassign. Omit to leave
    # unchanged. Setting it (incl. null) marks the deployment site_source='manual'
    # to record it was human-confirmed. Presence is read via model_fields_set.
    site_id: Optional[int] = None


class UpdateDeploymentResponse(BaseModel):
    # How many deployments the reassignment merged away. The edited deployment
    # itself may be the one merged into a neighbour, so we do not echo it back;
    # the frontend invalidates and refetches the list regardless.
    merged: int = 0


@router.patch("/{deployment_id}", response_model=UpdateDeploymentResponse)
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
    merged = 0
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
        # The merge inside can delete the edited deployment itself, which is
        # why we no longer refresh and return it.
        merged = await reassign_deployment_site(db, deployment, request.site_id)

    await db.commit()
    return UpdateDeploymentResponse(merged=merged)


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
