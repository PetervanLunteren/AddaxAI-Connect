"""
How the API changes deployments: it writes a statement and rebuilds the
camera. Every correction goes through here (Edit and Add deployment, "It
stayed", Undo), so the rules of an edit live in one module and the routers
only translate requests.

A statement is the stored decision of a person: this camera stood at this
site in this period. On screen it is called a correction.

Rows of the deployments table are made, removed and given their period, pin
and photos only by shared/deployment_rebuild.py. It runs on the request's
own session (through run_sync), so a correction and its rebuild are saved
together or not at all. Nothing here commits: the caller does.
"""
from datetime import date, datetime, timezone
from typing import Any, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deployment_build import period_of_days
from shared.deployment_rebuild import rebuild_camera
from shared.geo import is_auto_site_name
from shared.logger import get_logger
from shared.models import Camera, Deployment, DeploymentStatement, Image, Site
from utils.server_time import server_today

logger = get_logger("api.deployment_edits")

# How DeploymentStatement.changes stores its names.
CHANGES_SEPARATOR = ","


async def rebuild(db: AsyncSession, camera_ids: Iterable[int]) -> None:
    """Rebuild these cameras' deployments on the request's session."""
    for camera_id in sorted(set(camera_ids)):
        await db.run_sync(lambda session, cid=camera_id: rebuild_camera(session, cid))


async def newest_photo_at(db: AsyncSession, camera_id: int) -> Optional[datetime]:
    return (
        await db.execute(select(func.max(Image.captured_at)).where(Image.camera_id == camera_id))
    ).scalar_one_or_none()


async def state(
    db: AsyncSession,
    camera_id: int,
    site_id: int,
    from_at: datetime,
    until_at: Optional[datetime],
    user_id: int,
    replaces: Iterable[DeploymentStatement] = (),
    keeps_start: bool = False,
    keeps_end: bool = False,
    changes: Iterable[str] = (),
) -> int:
    """
    Record that the camera stood at the site from from_at until until_at, and
    rebuild it. Returns the statement's id, so the screen can offer Undo at
    once.

    With until_at None the camera is still there: the period is fixed up to
    its newest photo, and after that the GPS carries on, so a later move is
    still seen. `replaces` are the statements this one takes the place of
    (Edit deployment): they are marked removed, with this statement as what
    replaced them, so Undo brings them back. keeps_start and keeps_end mark
    an end the person moved: the deployment never joins a neighbour at the
    same site across it. `changes` names what a person changed (site,
    first_day, last_day), for the line on the deployment card.
    """
    fixed_until_at = await newest_photo_at(db, camera_id) if until_at is None else None
    statement = DeploymentStatement(
        camera_id=camera_id,
        site_id=site_id,
        from_at=from_at,
        until_at=until_at,
        fixed_until_at=fixed_until_at,
        keeps_start=keeps_start,
        keeps_end=keeps_end,
        changes=CHANGES_SEPARATOR.join(changes) or None,
        source="person",
        created_by_user_id=user_id,
    )
    db.add(statement)
    await db.flush()
    now = datetime.now(timezone.utc)
    for old in replaces:
        old.removed_at = now
        old.removed_by_user_id = user_id
        old.replaced_by_statement_id = statement.id
    await db.flush()
    await rebuild(db, [camera_id])
    return statement.id


def changes_of(statement: DeploymentStatement) -> Optional[List[str]]:
    """What a person changed with this statement, None when it was not
    recorded (an upload, the carried over history)."""
    return statement.changes.split(CHANGES_SEPARATOR) if statement.changes else None


# Days a person can set. Before 2000 no camera trap of a project here took
# photos, and a year typed digit by digit (0002, 0202) would otherwise claim
# the camera's whole history.
FIRST_SETTABLE_DAY = date(2000, 1, 1)


async def check_days(db: AsyncSession, from_date: date, until_date: Optional[date]) -> None:
    """No day after today. A deployment that starts later would count as
    where the camera stands now (the current deployment is the one that
    started last), and a last day still to come would count trap-nights
    that have not happened."""
    today = await server_today(db)
    for day in (from_date, until_date):
        if day is not None and not FIRST_SETTABLE_DAY <= day <= today:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Days must lie between 1 January 2000 and today",
            )
    if until_date is not None and until_date < from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The last day cannot be before the first day",
        )


async def camera_in_project(db: AsyncSession, project_id: int, camera_id: int) -> Camera:
    camera = (
        await db.execute(select(Camera).where(Camera.id == camera_id, Camera.project_id == project_id))
    ).scalar_one_or_none()
    if camera is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    return camera


async def deployment_in_project(db: AsyncSession, project_id: int, deployment_id: int) -> Deployment:
    deployment = (
        await db.execute(
            select(Deployment).join(Camera, Camera.id == Deployment.camera_id)
            .where(Deployment.id == deployment_id, Camera.project_id == project_id)
        )
    ).scalar_one_or_none()
    if deployment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found")
    return deployment


async def _camera_site_ids(db: AsyncSession, camera_id: int) -> set[Optional[int]]:
    return set((
        await db.execute(select(Deployment.site_id).where(Deployment.camera_id == camera_id))
    ).scalars())


async def set_deployment(
    db: AsyncSession,
    project_id: int,
    camera_id: int,
    site_id: int,
    from_date: date,
    until_date: Optional[date],
    deployment_id: Optional[int],
    user_id: int,
) -> int:
    """Edit deployment (deployment_id given) or Add deployment: the checks,
    the statement, the rebuild, and sites left empty. Returns the statement
    id. Save commits afterwards, the preview rolls back."""
    await camera_in_project(db, project_id, camera_id)
    site = (
        await db.execute(select(Site).where(Site.id == site_id, Site.project_id == project_id))
    ).scalar_one_or_none()
    if site is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    await check_days(db, from_date, until_date)

    from_at, until_at = period_of_days(from_date, until_date)
    sites_before = await _camera_site_ids(db, camera_id)
    replaced, edited = await _statements_of(db, camera_id, deployment_id)
    # A day the person typed stays an end: a shortened deployment splits in
    # two instead of the GPS joining the rest back, and effort counts to a
    # typed last day. An end left as it was still joins (only the site
    # changed: a false trip folds back into one). An added deployment has
    # its last day typed when it has one.
    keeps_start = edited is not None and from_date != edited.start_date
    keeps_end = until_date != edited.end_date if edited is not None else until_date is not None
    # A day left as it was keeps the deployment's own time, as "It stayed"
    # states it. A move happens during a day: cut at midnight, the photos
    # of that morning at the old spot would be left as a deployment of
    # their own.
    if edited is not None and not keeps_start:
        from_at = edited.start_at
    if edited is not None and not keeps_end:
        until_at = edited.end_at
    # What the person changed, for the line on the card. Adding a deployment
    # sets all three.
    changes = [name for name, changed in [
        ("site", edited is None or site_id != edited.site_id),
        ("first_day", edited is None or keeps_start),
        ("last_day", edited is None or keeps_end),
    ] if changed]
    statement_id = await state(db, camera_id, site_id, from_at, until_at, user_id,
                               replaces=replaced, keeps_start=keeps_start, keeps_end=keeps_end,
                               changes=changes)
    await drop_unnamed_sites_left_empty(db, sites_before)
    return statement_id


async def _statements_of(
    db: AsyncSession, camera_id: int, deployment_id: Optional[int],
) -> tuple[List[DeploymentStatement], Optional[Deployment]]:
    """The deployment being edited (None when adding one), and the live
    statements that made it: the camera's statements whose period overlaps
    it, none for a deployment the GPS made."""
    if deployment_id is None:
        return [], None
    deployment = (await db.execute(
        select(Deployment).where(Deployment.id == deployment_id, Deployment.camera_id == camera_id)
    )).scalar_one_or_none()
    if deployment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found")
    if deployment.site_source != 'manual':
        return [], deployment
    rows = (await db.execute(
        select(DeploymentStatement).where(
            DeploymentStatement.camera_id == camera_id,
            DeploymentStatement.removed_at.is_(None),
        )
    )).scalars().all()

    def overlaps(s: DeploymentStatement) -> bool:
        # An open statement holds up to fixed_until_at, the camera's newest
        # photo when it was made; after that the GPS may have moved the
        # camera on, so it does not reach every later deployment. Set to
        # start after that photo, it holds nothing yet and is known by its
        # start alone, which lies in the deployment it made.
        s_end = s.until_at or s.fixed_until_at
        starts_before_end = deployment.end_at is None or s.from_at < deployment.end_at
        ends_after_start = s_end is None or s_end > deployment.start_at
        starts_inside = s.until_at is None and s.from_at >= deployment.start_at
        return starts_before_end and (ends_after_start or starts_inside)
    return [s for s in rows if overlaps(s)], deployment


async def remove_statement(db: AsyncSession, project_id: int, statement_id: int, user_id: int) -> None:
    """Undo of a correction. The row stays, marked removed with who and
    when, and the camera is rebuilt: what the GPS or an older statement says
    for that time shows again. An edit undone brings back what it replaced."""
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Correction not found")
    row.removed_at = datetime.now(timezone.utc)
    row.removed_by_user_id = user_id
    replaced = (await db.execute(
        select(DeploymentStatement).where(DeploymentStatement.replaced_by_statement_id == statement_id)
    )).scalars().all()
    for old in replaced:
        old.removed_at = None
        old.removed_by_user_id = None
        old.replaced_by_statement_id = None
    await db.flush()
    await rebuild(db, [row.camera_id])


async def take_back_move(db: AsyncSession, deployment: Deployment, user_id: int) -> int:
    """"Wrong, it stayed": the GPS saw a move that did not happen. One
    statement over this deployment and the one before it, at the site before
    the move: the camera stood there all along. The rebuild folds the two
    into one, and a site the app made for the false place goes when nothing
    else uses it. Returns the statement id."""
    before_move = await previous_deployment(db, deployment)
    if before_move is None or before_move.site_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is no deployment right before this one, so there is no move to take back",
        )
    false_site = deployment.site_id
    statement_id = await state(
        db, deployment.camera_id, before_move.site_id, before_move.start_at, deployment.end_at, user_id,
    )
    await drop_unnamed_sites_left_empty(db, [false_site])
    return statement_id


async def camera_deployment_rows(
    db: AsyncSession, camera_id: int, site_scope: Optional[List[int]] = None,
) -> List[dict[str, Any]]:
    """A camera's deployments, oldest first, as plain values: the fields of
    the camera panel's cards (CameraDeploymentResponse). One reader for the
    panel and the preview of an edit, so both show a deployment the same
    way. With a site scope only the periods at those sites."""
    scope_sql = " AND d.site_id = ANY(:scope)" if site_scope is not None else ""
    params: dict[str, Any] = {"camera_id": camera_id}
    if site_scope is not None:
        params["scope"] = site_scope
    rows = (
        await db.execute(
            text(f"""
                SELECT d.id, d.deployment_number, d.site_id, s.name AS site_name,
                       ST_Y(d.location::geometry) AS lat,
                       ST_X(d.location::geometry) AS lon,
                       d.start_date, d.end_date,
                       count(i.id) AS image_count,
                       min(i.captured_at)::date AS first_photo_day,
                       max(i.captured_at)::date AS last_photo_day
                FROM deployments d
                LEFT JOIN sites s ON s.id = d.site_id
                LEFT JOIN images i ON i.deployment_id = d.id
                WHERE d.camera_id = :camera_id{scope_sql}
                GROUP BY d.id, s.name
                ORDER BY d.start_at, d.id
            """),
            params,
        )
    ).mappings().all()
    return [
        {
            "id": r["id"],
            "deployment_number": r["deployment_number"],
            "site_id": r["site_id"],
            "site_name": r["site_name"],
            "latitude": float(r["lat"]) if r["lat"] is not None else None,
            "longitude": float(r["lon"]) if r["lon"] is not None else None,
            "start_date": r["start_date"].isoformat() if r["start_date"] else None,
            "end_date": r["end_date"].isoformat() if r["end_date"] else None,
            "image_count": r["image_count"],
            # The days of its first and last photo, camera clock; None
            # without photos. The days above are where it starts and ends,
            # which a person may have set before or after them.
            "first_photo_day": r["first_photo_day"].isoformat() if r["first_photo_day"] else None,
            "last_photo_day": r["last_photo_day"].isoformat() if r["last_photo_day"] else None,
        }
        for r in rows
    ]


async def previous_deployment(db: AsyncSession, deployment: Deployment) -> Optional[Deployment]:
    """The deployment of the same camera that ends where this one starts."""
    return (
        await db.execute(
            select(Deployment).where(
                Deployment.camera_id == deployment.camera_id,
                Deployment.end_at == deployment.start_at,
            )
        )
    ).scalars().first()


async def site_is_used(db: AsyncSession, site_id: int) -> bool:
    """Whether deployments or statements still point at the site."""
    return bool((
        await db.execute(
            text("""
                SELECT EXISTS (SELECT 1 FROM deployments WHERE site_id = :id)
                    OR EXISTS (SELECT 1 FROM deployment_statements WHERE site_id = :id)
            """),
            {"id": site_id},
        )
    ).scalar())


async def drop_unnamed_sites_left_empty(db: AsyncSession, site_ids: Iterable[Optional[int]]) -> None:
    """After a correction, delete each of these sites that nothing uses any
    more and that still has the name the app gave it. Nobody named it, so
    it was only the app's guess for a place that turned out wrong (a false
    move, a camera put on the wrong site). A site a person named is never
    deleted by the app."""
    for site_id in {s for s in site_ids if s is not None}:
        site = await db.get(Site, site_id)
        if site is not None and is_auto_site_name(site.name) and not await site_is_used(db, site_id):
            await db.delete(site)
            logger.info("Deleted an unnamed site nothing uses any more", site_id=site_id)
    await db.flush()
