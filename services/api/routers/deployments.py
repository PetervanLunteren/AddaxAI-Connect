"""
Deployment endpoints.

A deployment is one camera at one site for a time range. Deployments are
rebuilt from photo GPS plus fixed periods (statements, see
shared/deployment_rebuild.py). This router serves the project-wide list and a
the answers of the moves check (right, it did not move), the fixed periods
(list, set, remove, many at once) and the thumbnail sample.
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import Camera, Deployment, DeploymentStatement, Image, Site, User
from auth.permissions import require_project_access, require_project_admin_access
from auth.project_access import get_site_scope
from utils.deployment_edits import drop_unnamed_sites_left_empty, previous_deployment, rebuild, state
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
    deployment_number: int
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
    last_photo_at: Optional[str] = None
    image_count: int
    site_source: str = 'auto'
    # When a person said this entry is right in the moves check,
    # NULL = nobody answered. checked_by is their email.
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
    Every deployment in the project, oldest first: the moves of the Camera
    updates page are worked out from it in the browser. Site-restricted
    viewers only see deployments at their sites; deployments without a site
    fail the scope test, fail closed.
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
                       d.start_date, d.end_date, d.start_at, d.end_at, d.last_photo_at,
                       d.site_source, d.checked_at, u.email AS checked_by,
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
            deployment_number=r["deployment_number"],
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
            last_photo_at=r["last_photo_at"].isoformat() if r["last_photo_at"] else None,
            image_count=r["image_count"],
            site_source=r["site_source"],
            checked_at=r["checked_at"].isoformat() if r["checked_at"] else None,
            checked_by=r["checked_by"],
        )
        for r in rows
    ]


class StatementItem(BaseModel):
    """One fixed period: a decision about where the camera stood."""
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


class SetDeploymentRequest(BaseModel):
    camera_id: int
    site_id: int
    from_date: date
    # The last day the camera stood there. None means it still stands there.
    until_date: Optional[date] = None


class SetDeploymentResponse(BaseModel):
    # The statement written, for Undo (DELETE .../statements/{id}).
    statement_id: int
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


async def _camera_site_ids(db: AsyncSession, camera_id: int) -> set[Optional[int]]:
    return set((
        await db.execute(select(Deployment.site_id).where(Deployment.camera_id == camera_id))
    ).scalars())


async def _deployment_in_project(db: AsyncSession, project_id: int, deployment_id: int) -> Deployment:
    deployment = (
        await db.execute(
            select(Deployment).join(Camera, Camera.id == Deployment.camera_id)
            .where(Deployment.id == deployment_id, Camera.project_id == project_id)
        )
    ).scalar_one_or_none()
    if deployment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found")
    return deployment


async def _deployment_count(db: AsyncSession, camera_id: int) -> int:
    return (
        await db.execute(select(func.count(Deployment.id)).where(Deployment.camera_id == camera_id))
    ).scalar_one()


@router.get("/statements", response_model=List[StatementItem])
async def list_statements(
    project_id: int,
    camera_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """The fixed periods in force, newest first: of one camera (the camera
    panel's Corrections), or of the whole project without camera_id (the
    Moves page)."""
    query = (
        select(DeploymentStatement, Camera.device_id, Site.name, User.email)
        .join(Camera, Camera.id == DeploymentStatement.camera_id)
        .join(Site, Site.id == DeploymentStatement.site_id)
        .outerjoin(User, User.id == DeploymentStatement.created_by_user_id)
        .where(Camera.project_id == project_id, DeploymentStatement.removed_at.is_(None))
        .order_by(DeploymentStatement.id.desc())
    )
    if camera_id is not None:
        await _camera_in_project(db, project_id, camera_id)
        query = query.where(DeploymentStatement.camera_id == camera_id)
    rows = (await db.execute(query)).all()
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
        )
        for st, camera_label, site_name, email in rows
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
    sites_before = await _camera_site_ids(db, request.camera_id)
    statement_id = await state(db, request.camera_id, request.site_id, from_at, until_at, user.id)
    await drop_unnamed_sites_left_empty(db, sites_before)
    merged = max(0, before - await _deployment_count(db, request.camera_id))
    await db.commit()
    logger.info(
        "Set deployment", project_id=project_id, camera_id=request.camera_id,
        site_id=request.site_id, from_date=str(request.from_date), until_date=str(request.until_date),
    )
    return SetDeploymentResponse(statement_id=statement_id, merged=merged)


async def _remove_statements(db: AsyncSession, project_id: int, statement_ids: List[int], user: User) -> None:
    """Take fixed periods back, all or none. The rows stay, marked removed
    with who and when, and each camera is rebuilt once: what the GPS or an
    older period says for that time shows again. The one way a correction is
    removed, for one (camera panel, check window) or many (the table)."""
    wanted = set(statement_ids)
    rows = (
        await db.execute(
            select(DeploymentStatement)
            .join(Camera, Camera.id == DeploymentStatement.camera_id)
            .where(
                DeploymentStatement.id.in_(wanted),
                Camera.project_id == project_id,
                DeploymentStatement.removed_at.is_(None),
            )
        )
    ).scalars().all()
    if not wanted or len(rows) != len(wanted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fixed period not found")
    now = datetime.now(timezone.utc)
    for row in rows:
        row.removed_at = now
        row.removed_by_user_id = user.id
    await db.flush()
    await rebuild(db, [row.camera_id for row in rows])
    await db.commit()
    logger.info("Removed fixed periods", project_id=project_id, statement_ids=sorted(wanted))


@router.delete("/statements/{statement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_statement(
    project_id: int,
    statement_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """Take one fixed period back."""
    await _remove_statements(db, project_id, [statement_id], user)


class RemoveStatementsRequest(BaseModel):
    ids: List[int]


@router.post("/statements/undo", status_code=status.HTTP_204_NO_CONTENT)
async def remove_statements(
    project_id: int,
    request: RemoveStatementsRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """Take many fixed periods back at once, from the Moves page.
    All or none: one unknown id, or one of another project, fails the call."""
    await _remove_statements(db, project_id, request.ids, user)


# Moves: where the app saw a camera move, shown on the Moves page and in
# its check. A person may say a move is
# right, which only records that they looked; it fixes nothing. Saying it is
# wrong writes a fixed period instead. Nobody has to answer: an entry that is
# never answered just gets older.


class CheckedRequest(BaseModel):
    deployment_ids: List[int]
    checked: bool


class CheckedResponse(BaseModel):
    updated: int


@router.put("/checked", response_model=CheckedResponse)
async def set_checked(
    project_id: int,
    request: CheckedRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """Record that a person said these entries are right, or take that back."""
    result = await db.execute(
        text("""
            UPDATE deployments d
            SET checked_at = CASE WHEN :checked THEN now() END,
                checked_by_user_id = CASE WHEN :checked THEN CAST(:user_id AS integer) END
            FROM cameras c
            WHERE c.id = d.camera_id AND c.project_id = :project_id AND d.id = ANY(:ids)
        """),
        {"checked": request.checked, "user_id": user.id, "project_id": project_id,
         "ids": request.deployment_ids},
    )
    await db.commit()
    logger.info("Set deployments checked", project_id=project_id, checked=request.checked,
                count=result.rowcount)
    return CheckedResponse(updated=result.rowcount)


# What needs a person, for the badge on Moves: a move nobody
# answered that came back to the site it left within SHORT_TRIP_DAYS, the
# mark of a false move. The same rule as the page (suspicious in
# components/deployments/update-items.ts); tests/db_api/test_review.py holds
# the two together. Photos without a site are not counted here: they are a
# camera's problem, shown on the Cameras page.
SHORT_TRIP_DAYS = 7
ATTENTION_COUNT_SQL = f"""
    SELECT count(*) FROM deployments d
    JOIN cameras c ON c.id = d.camera_id
    WHERE c.project_id = :project_id AND d.site_source = 'auto' AND d.checked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM deployments before_it, deployments after_it
        WHERE before_it.camera_id = d.camera_id AND before_it.end_at = d.start_at
          AND after_it.camera_id = d.camera_id AND after_it.start_at = d.end_at
          AND after_it.site_id = before_it.site_id
          AND d.end_at - d.start_at <= interval '{SHORT_TRIP_DAYS} days'
      )
"""


class AttentionCount(BaseModel):
    count: int


@router.get("/attention-count", response_model=AttentionCount)
async def attention_count(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """How many moves need a person, for the sidebar badge."""
    count = (await db.execute(text(ATTENTION_COUNT_SQL), {"project_id": project_id})).scalar_one()
    return AttentionCount(count=count)


@router.post("/{deployment_id}/not-moved", response_model=SetDeploymentResponse)
async def not_moved(
    project_id: int,
    deployment_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    The GPS saw a move that did not happen. One fixed period over both
    deployments, at the site before the move: the camera stood there all
    along. The rebuild folds the two into one, and a site the app made for
    the false place goes when nothing else uses it.
    """
    deployment = await _deployment_in_project(db, project_id, deployment_id)
    before_move = await previous_deployment(db, deployment)
    if before_move is None or before_move.site_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is no deployment right before this one, so there is no move to take back",
        )
    before = await _deployment_count(db, deployment.camera_id)
    false_site = deployment.site_id
    statement_id = await state(db, deployment.camera_id, before_move.site_id, before_move.start_at, deployment.end_at, user.id)
    await drop_unnamed_sites_left_empty(db, [false_site])
    merged = max(0, before - await _deployment_count(db, deployment.camera_id))
    await db.commit()
    logger.info("It did not move", project_id=project_id, deployment_id=deployment_id)
    return SetDeploymentResponse(statement_id=statement_id, merged=merged)


class DeploymentPhoto(BaseModel):
    uuid: str
    captured_at: str  # camera clock


class DeploymentThumbnails(BaseModel):
    photos: List[DeploymentPhoto]


@router.get("/{deployment_id}/thumbnails", response_model=DeploymentThumbnails)
async def deployment_thumbnails(
    project_id: int,
    deployment_id: int,
    limit: int = Query(6, ge=1, le=12),
    order: Literal["random", "first", "last"] = Query("random"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
):
    """
    A few photos of this deployment with their capture time: a random
    sample, the first ones or the last ones. The moves check
    shows the last photo before a move next to the first one after it.
    Skips hidden images and images without stored files. 404 if the
    deployment is not in the project or outside a restricted viewer's
    sites.
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

    sort = {
        "random": func.random(),
        "first": Image.captured_at.asc(),
        "last": Image.captured_at.desc(),
    }[order]
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
