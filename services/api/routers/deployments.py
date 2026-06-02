"""
Deployment endpoints.

A deployment is one camera at one site for a time range, with no free-text
metadata. The only human-editable field is its site assignment (the manual
pin): assigning a site marks site_source='manual' so GPS ingestion stops
re-resolving it. Reads happen via the site detail (sites.py) and the camera
deployment history (cameras.py); this router only holds the PATCH.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
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


class UpdateDeploymentRequest(BaseModel):
    # Reassign the deployment to a site (the manual pin). Send null to unassign.
    # Omit to leave unchanged. Setting it (incl. null) marks the deployment
    # site_source='manual' so ingestion stops re-resolving it. Presence is read
    # via model_fields_set.
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
    # the request, not on its value. Any human assignment makes the deployment
    # manual so ingestion stops re-resolving its site.
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
