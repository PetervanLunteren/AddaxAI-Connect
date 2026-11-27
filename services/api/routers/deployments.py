"""
Deployment endpoints.

A deployment is one camera at one site for a time range. Deployments are
rebuilt from photo GPS plus statements (shared/deployment_rebuild.py). This
router serves the project-wide list, the corrections (list, set, preview,
undo), the answers to a suspicious deployment (right, wrong) and a few
photos of a deployment. The rules of an edit are in utils/deployment_edits.py.
"""
from datetime import date, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.deployment_queries import SHORT_TRIP_SQL
from shared.logger import get_logger
from shared.models import Camera, Deployment, DeploymentStatement, Image, Site, User
from auth.permissions import require_project_access, require_project_admin_access
from auth.project_access import get_site_scope
from utils import deployment_edits
from utils.deployment_edits import camera_deployment_rows
from routers.cameras import CameraDeploymentResponse
from utils.site_scope import site_in_scope

logger = get_logger("api.deployments")

router = APIRouter(
    prefix="/api/projects/{project_id}/deployments",
    tags=["deployments"],
)


class DeploymentListItem(BaseModel):
    """One deployment in the project-wide list: which camera stood at which site,
    for how long, with how many photos, and whether a statement made it
    (site_source 'manual') or the GPS (auto)."""
    id: int
    camera_id: int
    camera_label: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    start_at: str
    end_at: Optional[str] = None
    image_count: int
    site_source: str = 'auto'
    # Looks like a GPS error (SHORT_TRIP_SQL). Suspicious while nobody
    # answered it.
    short_trip: bool
    # When a person said this deployment is right, NULL = nobody answered.
    # checked_by is their email.
    checked_at: Optional[str] = None
    checked_by: Optional[str] = None


@router.get("", response_model=List[DeploymentListItem])
async def list_deployments(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
):
    """
    Every deployment in the project, oldest first, for the Deployments page
    and the deployment cards. Site-restricted viewers only see deployments
    at their sites; deployments without a site fail the scope test, fail
    closed.
    """
    scope_sql = " AND d.site_id = ANY(:scope)" if site_scope is not None else ""
    params: Dict[str, Any] = {"project_id": project_id}
    if site_scope is not None:
        params["scope"] = site_scope
    rows = (
        await db.execute(
            text(f"""
                SELECT d.id, d.camera_id,
                       c.device_id AS camera_label,
                       d.site_id, s.name AS site_name,
                       ST_Y(d.location::geometry) AS lat,
                       ST_X(d.location::geometry) AS lon,
                       d.start_date, d.end_date, d.start_at, d.end_at,
                       d.site_source, d.checked_at, u.email AS checked_by,
                       {SHORT_TRIP_SQL} AS short_trip,
                       (SELECT count(*) FROM images i WHERE i.deployment_id = d.id) AS image_count
                FROM deployments d
                JOIN cameras c ON c.id = d.camera_id
                LEFT JOIN sites s ON s.id = d.site_id
                LEFT JOIN users u ON u.id = d.checked_by_user_id
                WHERE c.project_id = :project_id{scope_sql}
                ORDER BY d.start_at, d.id
            """),
            params,
        )
    ).mappings().all()

    return [
        DeploymentListItem(
            id=r["id"],
            camera_id=r["camera_id"],
            camera_label=r["camera_label"],
            site_id=r["site_id"],
            site_name=r["site_name"],
            latitude=float(r["lat"]) if r["lat"] is not None else None,
            longitude=float(r["lon"]) if r["lon"] is not None else None,
            start_date=r["start_date"].isoformat() if r["start_date"] else None,
            end_date=r["end_date"].isoformat() if r["end_date"] else None,
            start_at=r["start_at"].isoformat(),
            end_at=r["end_at"].isoformat() if r["end_at"] else None,
            image_count=r["image_count"],
            site_source=r["site_source"],
            short_trip=r["short_trip"],
            checked_at=r["checked_at"].isoformat() if r["checked_at"] else None,
            checked_by=r["checked_by"],
        )
        for r in rows
    ]


class StatementItem(BaseModel):
    """One correction in force: a decision about where the camera stood."""
    id: int
    camera_id: int
    camera_label: str
    site_id: int
    site_name: str
    from_date: str
    # The last day, or None when the camera is still there.
    until_date: Optional[str] = None
    # 'person', 'upload' or 'carried_over'.
    source: str
    created_by: Optional[str] = None
    created_at: str
    # What a person changed with Edit or Add deployment: "site", "first_day",
    # "last_day". None for other corrections and older ones.
    changes: Optional[List[str]] = None


class SetDeploymentRequest(BaseModel):
    camera_id: int
    site_id: int
    from_date: date
    # The last day the camera stood there. None means it still stands there.
    until_date: Optional[date] = None
    # The deployment this edits (Edit deployment), None when adding one. The
    # corrections that made it are replaced, so the days the edit leaves out
    # go back to the app.
    deployment_id: Optional[int] = None


class DeploymentPreview(BaseModel):
    """What Save would do: the camera's deployments now and after it, in the
    shape of the camera panel's cards. Nothing is written to make
    it (see preview_deployment)."""
    before: List[CameraDeploymentResponse]
    after: List[CameraDeploymentResponse]


class SetDeploymentResponse(BaseModel):
    # The statement written, for Undo (DELETE .../statements/{id}).
    statement_id: int


@router.get("/statements", response_model=List[StatementItem])
async def list_statements(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """The project's corrections in force, newest first, for the Deployments
    page and the deployment cards."""
    rows = (await db.execute(
        select(DeploymentStatement, Camera.device_id, Site.name, User.email)
        .join(Camera, Camera.id == DeploymentStatement.camera_id)
        .join(Site, Site.id == DeploymentStatement.site_id)
        .outerjoin(User, User.id == DeploymentStatement.created_by_user_id)
        .where(Camera.project_id == project_id, DeploymentStatement.removed_at.is_(None))
        .order_by(DeploymentStatement.id.desc())
    )).all()
    return [
        StatementItem(
            id=st.id,
            camera_id=st.camera_id,
            camera_label=camera_label,
            site_id=st.site_id,
            site_name=site_name,
            from_date=st.from_at.date().isoformat(),
            until_date=(st.until_at - timedelta(days=1)).date().isoformat() if st.until_at else None,
            source=st.source,
            created_by=email,
            created_at=st.created_at.isoformat(),
            changes=deployment_edits.changes_of(st),
        )
        for st, camera_label, site_name, email in rows
    ]


async def _apply(db: AsyncSession, project_id: int, request: SetDeploymentRequest, user_id: int) -> int:
    return await deployment_edits.set_deployment(
        db, project_id, request.camera_id, request.site_id, request.from_date, request.until_date,
        request.deployment_id, user_id,
    )


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
    statement_id = await _apply(db, project_id, request, user.id)
    await db.commit()
    logger.info(
        "Set deployment", project_id=project_id, camera_id=request.camera_id,
        site_id=request.site_id, from_date=str(request.from_date), until_date=str(request.until_date),
    )
    return SetDeploymentResponse(statement_id=statement_id)


@router.post("/statements/preview", response_model=DeploymentPreview)
async def preview_deployment(
    project_id: int,
    request: SetDeploymentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    What Save would do to the camera's deployments, without saving: the same
    edit in a transaction that is rolled back. So the preview is the
    rebuild's own answer, never a guess in the browser. Everything is read
    and built before the rollback, which expires every object of the
    session (the user too); after it only plain values are touched.
    """
    user_id = user.id
    try:
        before = await camera_deployment_rows(db, request.camera_id)
        await _apply(db, project_id, request, user_id)
        preview = DeploymentPreview(
            before=[CameraDeploymentResponse(**row) for row in before],
            after=[CameraDeploymentResponse(**row) for row in await camera_deployment_rows(db, request.camera_id)],
        )
    finally:
        await db.rollback()
    return preview


@router.delete("/statements/{statement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_statement(
    project_id: int,
    statement_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """Undo of one correction."""
    await deployment_edits.remove_statement(db, project_id, statement_id, user.id)
    await db.commit()
    logger.info("Removed a correction", project_id=project_id, statement_id=statement_id)


# The question of a suspicious deployment, in its window on the Deployments
# page: did the camera really go there. Right only records who said so; it
# changes nothing. Wrong writes a correction instead. Nobody has to answer:
# a question that is never answered just gets older.


class CheckedRequest(BaseModel):
    checked: bool


@router.put("/{deployment_id}/checked", status_code=status.HTTP_204_NO_CONTENT)
async def set_checked(
    project_id: int,
    deployment_id: int,
    request: CheckedRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """Record that a person said this deployment is right, or take that back."""
    deployment = await deployment_edits.deployment_in_project(db, project_id, deployment_id)
    deployment.checked_at = func.now() if request.checked else None
    deployment.checked_by_user_id = user.id if request.checked else None
    await db.commit()
    logger.info("Set deployment checked", project_id=project_id, deployment_id=deployment_id,
                checked=request.checked)


@router.post("/{deployment_id}/not-moved", response_model=SetDeploymentResponse)
async def not_moved(
    project_id: int,
    deployment_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """"Wrong, it stayed": take back a move the GPS saw (take_back_move)."""
    deployment = await deployment_edits.deployment_in_project(db, project_id, deployment_id)
    statement_id = await deployment_edits.take_back_move(db, deployment, user.id)
    await db.commit()
    logger.info("It did not move", project_id=project_id, deployment_id=deployment_id)
    return SetDeploymentResponse(statement_id=statement_id)


class DeploymentPhoto(BaseModel):
    uuid: str
    captured_at: str  # camera clock


class DeploymentThumbnails(BaseModel):
    photos: List[DeploymentPhoto]


@router.get("/{deployment_id}/thumbnails", response_model=DeploymentThumbnails)
async def deployment_thumbnails(
    project_id: int,
    deployment_id: int,
    order: Literal["first", "last"],
    limit: int = Query(1, ge=1, le=12),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
):
    """
    The first or the last photos of this deployment, with their capture
    time: the window of a deployment shows the last photo before a move next
    to the first one after it. Skips hidden images and images without
    stored files. 404 if the deployment is not in the project or outside a
    restricted viewer's sites.
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

    sort = Image.captured_at.asc() if order == "first" else Image.captured_at.desc()
    rows = (
        await db.execute(
            select(Image.uuid, Image.captured_at)
            .where(
                Image.deployment_id == deployment_id,
                Image.is_hidden == False,  # noqa: E712
                Image.storage_path.isnot(None),
            )
            .order_by(sort)
            .limit(limit)
        )
    ).all()
    return DeploymentThumbnails(
        photos=[DeploymentPhoto(uuid=u, captured_at=t.isoformat()) for u, t in rows],
    )
