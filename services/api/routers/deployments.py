"""
Deployment endpoints.

A deployment is one camera at one site for a time range. Deployments are
rebuilt from photo GPS plus fixed periods (statements, see
shared/deployment_rebuild.py). This router serves the project-wide list and a
camera's GPS with the reason for each cut (the Deployments page), the fixed
periods of a camera (list, set, remove) and the thumbnail sample.
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.deployment_rebuild import build_history, load_history
from shared.geo import SITE_THRESHOLD_METERS
from shared.logger import get_logger
from shared.models import Camera, Deployment, DeploymentStatement, Image, Site, User
from auth.permissions import require_project_access, require_project_admin_access
from auth.project_access import get_site_scope
from utils.deployment_edits import drop_unnamed_sites_left_empty, previous_deployment, rebuild, state
from utils.site_scope import site_in_scope
from utils.timeline_activity import daily_camera_counts, split_into_segments

logger = get_logger("api.deployments")

router = APIRouter(
    prefix="/api/projects/{project_id}/deployments",
    tags=["deployments"],
)


class DaySpan(BaseModel):
    """A run of days with photos, both ends included."""
    start: str
    end: str


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
    # Runs of days with photos, for the marks on the bars.
    photo_days: List[DaySpan] = []
    # When a person checked it on the Deployments page, NULL = still to check
    # (only shown for deployments the GPS made). checked_by is their email.
    checked_at: Optional[str] = None
    checked_by: Optional[str] = None


class UnplacedPhotos(BaseModel):
    """Photos of one camera that no deployment covers: no site yet."""
    camera_id: int
    camera_label: str
    photo_days: List[DaySpan]


class DeploymentsOverview(BaseModel):
    deployments: List[DeploymentListItem]
    # Empty for viewers limited to sites: photos without a site fail closed.
    unplaced: List[UnplacedPhotos]


def _spans(days: List[date]) -> List[DaySpan]:
    return [DaySpan(start=a.isoformat(), end=b.isoformat()) for a, b in split_into_segments(days)]


@router.get("", response_model=DeploymentsOverview)
async def list_deployments(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
):
    """
    Every deployment in the project, oldest first, with the days it has
    photos, and the photo days of each camera that have no deployment. The
    Deployments page filters this in the browser. Site-restricted viewers
    only see deployments at their sites; deployments without a site fail the
    scope test, fail closed.
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

    camera_ids = sorted({r["camera_id"] for r in rows})
    if site_scope is None:
        camera_ids = list(
            (await db.execute(select(Camera.id).where(Camera.project_id == project_id))).scalars()
        )
    days_by_deployment: Dict[int, List[date]] = {}
    unplaced_days: Dict[int, List[date]] = {}
    for day in await daily_camera_counts(db, camera_ids):
        if day["deployment_id"] is not None:
            days_by_deployment.setdefault(day["deployment_id"], []).append(day["date"])
        elif site_scope is None:
            unplaced_days.setdefault(day["camera_id"], []).append(day["date"])

    labels: Dict[int, str] = {}
    if unplaced_days:
        labels = dict((await db.execute(
            select(Camera.id, Camera.device_id).where(Camera.id.in_(list(unplaced_days)))
        )).all())

    return DeploymentsOverview(
        deployments=[
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
                photo_days=_spans(days_by_deployment.get(r["id"], [])),
                checked_at=r["checked_at"].isoformat() if r["checked_at"] else None,
                checked_by=r["checked_by"],
            )
            for r in rows
        ],
        unplaced=[
            UnplacedPhotos(camera_id=cid, camera_label=labels[cid], photo_days=_spans(days))
            for cid, days in sorted(unplaced_days.items())
        ],
    )


class ReadingDot(BaseModel):
    """Photos of one deployment at one spot (5 decimals, about a metre)."""
    deployment_id: Optional[int] = None
    latitude: float
    longitude: float
    count: int


class DeploymentStart(BaseModel):
    """How a deployment started. kind is 'first' (the camera's first photos,
    or the first after a closed fixed period), 'moved' (the GPS rule saw a
    move) or 'fixed' (a fixed period starts here)."""
    deployment_id: int
    kind: str
    distance_m: Optional[float] = None
    readings: Optional[int] = None
    first_at: Optional[str] = None


class CameraReadings(BaseModel):
    threshold_m: float
    dots: List[ReadingDot]
    starts: List[DeploymentStart]


@router.get("/cameras/{camera_id}/readings", response_model=CameraReadings)
async def camera_readings(
    project_id: int,
    camera_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    The GPS of a camera's photos and why each of its deployments starts where
    it does. The build runs again on the same input the rebuild reads
    (load_history), so the reason is never stored and never stale. A built
    deployment is matched to its row by its start, which the rebuild wrote.
    Two parts at one site that the rebuild joined keep the reason of the
    first part, which is where the row starts.
    """
    camera = await _camera_in_project(db, project_id, camera_id)
    photos, statements = await db.run_sync(lambda s: load_history(s, camera_id))
    built = build_history(photos, statements, camera.retired_at)
    row_by_start = dict((await db.execute(
        select(Deployment.start_at, Deployment.id).where(Deployment.camera_id == camera_id)
    )).all())

    starts: List[DeploymentStart] = []
    for b in built:
        row_id = row_by_start.get(b.start_at)
        if row_id is None:
            continue  # a part the rebuild joined to the one before
        if b.statement_id is not None:
            starts.append(DeploymentStart(deployment_id=row_id, kind="fixed"))
        elif b.move is not None:
            starts.append(DeploymentStart(
                deployment_id=row_id, kind="moved", distance_m=round(b.move.distance_m),
                readings=b.move.readings, first_at=b.move.first_at.isoformat(),
            ))
        else:
            starts.append(DeploymentStart(deployment_id=row_id, kind="first"))

    grouped: Dict[tuple, int] = {}
    for p in photos:
        if p.lat is not None:
            key = (p.deployment_id, round(p.lat, 5), round(p.lon, 5))
            grouped[key] = grouped.get(key, 0) + 1
    dots = [
        ReadingDot(deployment_id=d, latitude=lat, longitude=lon, count=n)
        for (d, lat, lon), n in grouped.items()
    ]
    return CameraReadings(threshold_m=SITE_THRESHOLD_METERS, dots=dots, starts=starts)


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
    sites_before = await _camera_site_ids(db, request.camera_id)
    await state(db, request.camera_id, request.site_id, from_at, until_at, user.id)
    await drop_unnamed_sites_left_empty(db, sites_before)
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


# Checking what the GPS did (the "To check" list on the Deployments page).
# To check = a deployment the GPS made that nobody checked yet, plus each
# camera with photos that have no site. Checking only records that a person
# looked; it fixes nothing. A correction writes a fixed period instead.


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
    """Mark deployments as checked, or back to check (Undo)."""
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


# The same rule as the list in the browser (components/deployments/
# review-items.ts): GPS deployments not checked, plus cameras with photos
# without a site. Hidden photos do not count, as in the list.
TO_CHECK_COUNT_SQL = """
    SELECT
      (SELECT count(*) FROM deployments d JOIN cameras c ON c.id = d.camera_id
        WHERE c.project_id = :project_id AND d.site_source = 'auto' AND d.checked_at IS NULL)
    + (SELECT count(DISTINCT i.camera_id) FROM images i JOIN cameras c ON c.id = i.camera_id
        WHERE c.project_id = :project_id AND i.deployment_id IS NULL AND NOT i.is_hidden)
"""


class ToCheckCount(BaseModel):
    count: int


@router.get("/to-check-count", response_model=ToCheckCount)
async def to_check_count(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """How many entries the To check list has, for the sidebar badge."""
    count = (await db.execute(text(TO_CHECK_COUNT_SQL), {"project_id": project_id})).scalar_one()
    return ToCheckCount(count=count)


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
    await state(db, deployment.camera_id, before_move.site_id, before_move.start_at, deployment.end_at, user.id)
    await drop_unnamed_sites_left_empty(db, [false_site])
    merged = max(0, before - await _deployment_count(db, deployment.camera_id))
    await db.commit()
    logger.info("It did not move", project_id=project_id, deployment_id=deployment_id)
    return SetDeploymentResponse(merged=merged)


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
