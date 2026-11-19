"""
Deployment endpoints.

A deployment is one camera at one site for a time range. Deployments are
rebuilt from photo GPS plus fixed periods (statements, see
shared/deployment_rebuild.py). This router serves the project-wide list, the
fixed periods of a camera (list, set, remove) and the thumbnail sample.
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import Camera, Deployment, DeploymentStatement, Image, Site, User
from auth.permissions import require_project_access, require_project_admin_access
from auth.project_access import get_site_scope
from utils.deployment_edits import rebuild, state
from utils.site_scope import site_in_scope

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
    site_scope: Optional[List[int]] = Depends(get_site_scope),
):
    """
    Every deployment in the project, newest first. One row is one camera at one
    site for a time range. The frontend filters and sorts this list client-side.
    Site-restricted viewers only see deployments at their sites; deployments
    without a site fail the scope test, fail closed.
    """
    scope_sql = " AND d.site_id = ANY(:scope)" if site_scope is not None else ""
    params: Dict[str, Any] = {"project_id": project_id}
    if site_scope is not None:
        params["scope"] = site_scope
    rows = (
        await db.execute(
            text(f"""
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
                WHERE c.project_id = :project_id{scope_sql}
                GROUP BY d.id, c.device_id, s.name
                ORDER BY d.start_date DESC NULLS LAST, d.id DESC
            """),
            params,
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


class StatementItem(BaseModel):
    """One fixed period: a decision about where the camera stood."""
    id: int
    site_id: int
    site_name: str
    from_date: str
    # The last day, or None when the camera is still there.
    until_date: Optional[str] = None
    # 'person', 'upload' or 'carried_over'.
    source: str
    created_by: Optional[str] = None
    created_at: str


class SetDeploymentRequest(BaseModel):
    camera_id: int
    site_id: int
    from_date: date
    # The last day the camera stood there. None means it still stands there.
    until_date: Optional[date] = None


class SetDeploymentResponse(BaseModel):
    # How many deployments fewer the camera has afterwards: periods at the
    # same site back to back become one.
    merged: int = 0


def period_of_days(from_date: date, until_date: Optional[date]) -> tuple[datetime, Optional[datetime]]:
    """Days as a period of camera clock time: from the start of the first day
    to the start of the day after the last. The same rule as uploads and the
    carry-over, so a day belongs to one deployment."""
    from_at = datetime.combine(from_date, time.min)
    until_at = datetime.combine(until_date + timedelta(days=1), time.min) if until_date else None
    return from_at, until_at


async def _camera_in_project(db: AsyncSession, project_id: int, camera_id: int) -> Camera:
    camera = (
        await db.execute(select(Camera).where(Camera.id == camera_id, Camera.project_id == project_id))
    ).scalar_one_or_none()
    if camera is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    return camera


async def _deployment_count(db: AsyncSession, camera_id: int) -> int:
    return (
        await db.execute(select(func.count(Deployment.id)).where(Deployment.camera_id == camera_id))
    ).scalar_one()


@router.get("/statements", response_model=List[StatementItem])
async def list_statements(
    project_id: int,
    camera_id: int = Query(...),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """The camera's fixed periods that are in force, newest first."""
    await _camera_in_project(db, project_id, camera_id)
    rows = (
        await db.execute(
            select(DeploymentStatement, Site.name, User.email)
            .join(Site, Site.id == DeploymentStatement.site_id)
            .outerjoin(User, User.id == DeploymentStatement.created_by_user_id)
            .where(
                DeploymentStatement.camera_id == camera_id,
                DeploymentStatement.removed_at.is_(None),
            )
            .order_by(DeploymentStatement.id.desc())
        )
    ).all()
    return [
        StatementItem(
            id=st.id,
            site_id=st.site_id,
            site_name=site_name,
            from_date=st.from_at.date().isoformat(),
            until_date=(st.until_at - timedelta(days=1)).date().isoformat() if st.until_at else None,
            source=st.source,
            created_by=email,
            created_at=st.created_at.isoformat(),
        )
        for st, site_name, email in rows
    ]


@router.post("/statements", response_model=SetDeploymentResponse)
async def set_deployment(
    project_id: int,
    request: SetDeploymentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    Set where a camera stood: at this site from this day, until this day or
    still. Written as a statement, so the GPS does not change that period.
    Change site on a deployment, placing a camera without GPS and correcting
    the past all go through here.
    """
    await _camera_in_project(db, project_id, request.camera_id)
    site = (
        await db.execute(select(Site).where(Site.id == request.site_id, Site.project_id == project_id))
    ).scalar_one_or_none()
    if site is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    if request.until_date is not None and request.until_date < request.from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The last day cannot be before the first day",
        )

    from_at, until_at = period_of_days(request.from_date, request.until_date)
    before = await _deployment_count(db, request.camera_id)
    await state(db, request.camera_id, request.site_id, from_at, until_at, user.id)
    merged = max(0, before - await _deployment_count(db, request.camera_id))
    await db.commit()
    logger.info(
        "Set deployment", project_id=project_id, camera_id=request.camera_id,
        site_id=request.site_id, from_date=str(request.from_date), until_date=str(request.until_date),
    )
    return SetDeploymentResponse(merged=merged)


@router.delete("/statements/{statement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_statement(
    project_id: int,
    statement_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """Take a fixed period back. The row stays, marked removed with who and
    when, and the camera is rebuilt: what the GPS or an older period says for
    that time shows again."""
    row = (
        await db.execute(
            select(DeploymentStatement)
            .join(Camera, Camera.id == DeploymentStatement.camera_id)
            .where(
                DeploymentStatement.id == statement_id,
                Camera.project_id == project_id,
                DeploymentStatement.removed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fixed period not found")
    row.removed_at = datetime.now(timezone.utc)
    row.removed_by_user_id = user.id
    await db.flush()
    await rebuild(db, [row.camera_id])
    await db.commit()
    logger.info("Removed fixed period", project_id=project_id, statement_id=statement_id)


class DeploymentThumbnails(BaseModel):
    uuids: List[str]


@router.get("/{deployment_id}/thumbnails", response_model=DeploymentThumbnails)
async def deployment_thumbnails(
    project_id: int,
    deployment_id: int,
    limit: int = Query(6, ge=1, le=12),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
):
    """
    A random sample of image UUIDs from this deployment, so the UI can show a
    few thumbnails as visual confirmation of the location. Skips hidden images
    and images without stored files. 404 if the deployment is not in the project
    or outside a restricted viewer's sites.
    """
    row = (
        await db.execute(
            select(Deployment.id, Deployment.site_id, Camera.project_id)
            .join(Camera, Camera.id == Deployment.camera_id)
            .where(Deployment.id == deployment_id)
        )
    ).first()
    if row is None or row[2] != project_id or not site_in_scope(row[1], site_scope):
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
