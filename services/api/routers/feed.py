"""
Camera updates feed endpoints.

The feed is the user-facing face of the site/deployment automation. Ingestion
decides sites and deployments on its own and writes one feed_events row per
created deployment (camera_first_seen or camera_moved). The feed lists those
decisions; a project admin can act on an entry with exactly one of four
actions:

- rename_site: give the auto-named site a real name
- set_site: the guess was wrong, put the deployment on another existing site
- new_site: this spot deserves its own site (co-located cameras)
- not_moved: the "move" was GPS noise, fold the deployment back where it was

Entries never block ingestion and ignoring them is harmless. Re-resolving is
allowed (a user can change their mind, the last action wins). An entry's
site_id is updated by set_site / new_site / not_moved so the feed always shows
where the camera is now, not the superseded guess.

feed_seen drives the unseen badge: events created after the user's stamp
count as unseen. Reads are open to any project member; resolving requires
project admin.
"""
import uuid as uuid_module
from typing import List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.elements import WKTElement
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import Deployment, FeedEvent, FeedSeen, Image, Site, User
from auth.permissions import require_project_access, require_project_admin_access
from utils.deployment_edits import reassign_deployment_site
from utils.feed import nearby_sites

logger = get_logger("api.feed")

router = APIRouter(
    prefix="/api/projects/{project_id}/feed",
    tags=["feed"],
)

FEED_LIMIT = 100


class FeedCandidate(BaseModel):
    site_id: int
    name: str
    distance_m: float


class FeedEventItem(BaseModel):
    id: int
    event_type: str  # 'camera_first_seen' | 'camera_moved'
    created_at: str
    camera_id: int
    camera_label: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    # The site's name when the event happened, frozen at write time. The
    # context line uses this; site_name (live) feeds the resolution line.
    original_site_name: Optional[str] = None
    from_site_id: Optional[int] = None
    from_site_name: Optional[str] = None
    distance_m: Optional[float] = None
    # Whether the site was auto-created for this event. The "new site" action
    # only shows when it was not (on a fresh site it equals renaming it).
    site_created: bool = False
    # For thumbnails and the deployment-bound actions; null once the
    # deployment was merged away.
    deployment_id: Optional[int] = None
    # The camera's placement location for this entry (the deployment's pin).
    # Anchors "Show location": it survives renames, reassignments and site
    # merges, unlike the site reference.
    deployment_lat: Optional[float] = None
    deployment_lon: Optional[float] = None
    # Sites within the threshold of the deployment location, nearest first,
    # for the "different site" picker. Includes the currently assigned site.
    candidates: List[FeedCandidate] = []
    resolved_action: Optional[str] = None
    resolved_at: Optional[str] = None
    resolved_by_email: Optional[str] = None
    # Whether this user had already seen the entry on an earlier visit. The
    # UI shows fresh entries prominently and collapses seen ones; the seen
    # stamp is written when the panel closes, so the split is stable while
    # the panel is open.
    seen: bool = False


@router.get("", response_model=List[FeedEventItem])
async def list_feed(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
):
    """The project's most recent camera updates, newest first."""
    rows = (
        await db.execute(
            text("""
                SELECT e.id, e.event_type, e.created_at, e.camera_id,
                       c.device_id AS camera_label,
                       e.site_id, s.name AS site_name, e.original_site_name,
                       e.from_site_id, fs.name AS from_site_name,
                       e.distance_m, e.site_created, e.deployment_id,
                       e.resolved_action, e.resolved_at,
                       u.email AS resolved_by_email,
                       (fsn.last_seen_at IS NOT NULL
                        AND e.created_at <= fsn.last_seen_at) AS seen,
                       ST_Y(d.location::geometry) AS dep_lat,
                       ST_X(d.location::geometry) AS dep_lon
                FROM feed_events e
                JOIN cameras c ON c.id = e.camera_id
                LEFT JOIN sites s ON s.id = e.site_id
                LEFT JOIN sites fs ON fs.id = e.from_site_id
                LEFT JOIN deployments d ON d.id = e.deployment_id
                LEFT JOIN users u ON u.id = e.resolved_by_user_id
                LEFT JOIN feed_seen fsn ON fsn.project_id = e.project_id
                                       AND fsn.user_id = :user_id
                WHERE e.project_id = :project_id
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT :limit
            """),
            {"project_id": project_id, "limit": FEED_LIMIT, "user_id": user.id},
        )
    ).mappings().all()

    # One sites query for the whole page; candidate lists are computed in
    # Python per entry (a project has tens of sites, not thousands).
    sites = (
        await db.execute(
            text("""
                SELECT id, name,
                       ST_Y(location::geometry) AS lat,
                       ST_X(location::geometry) AS lon
                FROM sites WHERE project_id = :project_id
            """),
            {"project_id": project_id},
        )
    ).mappings().all()
    site_dicts = [dict(s) for s in sites]

    items = []
    for r in rows:
        candidates = []
        if r["dep_lat"] is not None:
            candidates = nearby_sites(r["dep_lat"], r["dep_lon"], site_dicts)
        items.append(FeedEventItem(
            id=r["id"],
            event_type=r["event_type"],
            created_at=r["created_at"].isoformat(),
            camera_id=r["camera_id"],
            camera_label=r["camera_label"],
            site_id=r["site_id"],
            site_name=r["site_name"],
            original_site_name=r["original_site_name"],
            from_site_id=r["from_site_id"],
            from_site_name=r["from_site_name"],
            distance_m=r["distance_m"],
            site_created=r["site_created"],
            deployment_id=r["deployment_id"],
            deployment_lat=float(r["dep_lat"]) if r["dep_lat"] is not None else None,
            deployment_lon=float(r["dep_lon"]) if r["dep_lon"] is not None else None,
            candidates=[FeedCandidate(**c) for c in candidates],
            resolved_action=r["resolved_action"],
            resolved_at=r["resolved_at"].isoformat() if r["resolved_at"] else None,
            resolved_by_email=r["resolved_by_email"],
            seen=r["seen"],
        ))
    return items


class UnseenResponse(BaseModel):
    count: int


@router.get("/unseen", response_model=UnseenResponse)
async def unseen_count(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
):
    """How many feed entries this user has not seen yet (the sidebar badge)."""
    last_seen = (
        await db.execute(
            select(FeedSeen.last_seen_at).where(
                FeedSeen.user_id == user.id, FeedSeen.project_id == project_id
            )
        )
    ).scalar_one_or_none()

    query = select(func.count(FeedEvent.id)).where(FeedEvent.project_id == project_id)
    if last_seen is not None:
        query = query.where(FeedEvent.created_at > last_seen)
    count = (await db.execute(query)).scalar_one()
    return UnseenResponse(count=count)


@router.post("/seen", status_code=status.HTTP_204_NO_CONTENT)
async def mark_seen(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
):
    """Stamp now as this user's last feed visit, clearing the badge."""
    await db.execute(
        pg_insert(FeedSeen)
        .values(user_id=user.id, project_id=project_id, last_seen_at=func.now())
        .on_conflict_do_update(
            index_elements=[FeedSeen.user_id, FeedSeen.project_id],
            set_={"last_seen_at": func.now()},
        )
    )
    await db.commit()


class EventThumbnails(BaseModel):
    uuids: List[str]


@router.get("/{event_id}/thumbnails", response_model=EventThumbnails)
async def event_thumbnails(
    project_id: int,
    event_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_access),
):
    """
    Photos for an entry whose deployment was merged away (an undone move):
    the camera's newest images up to the event moment. Mirrors the deployment
    thumbnail rules (hidden and file-less images skipped, processing status
    irrelevant); the images list endpoint is not usable here because it only
    returns fully processed images.
    """
    event = (
        await db.execute(
            select(FeedEvent).where(
                FeedEvent.id == event_id, FeedEvent.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feed entry not found",
        )

    # captured_at is camera wall-clock naive under the server timezone;
    # localize the aware event stamp before comparing (see DEVELOPERS.md).
    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    cutoff = event.created_at.astimezone(tz).replace(tzinfo=None)

    uuids = (
        await db.execute(
            select(Image.uuid)
            .where(
                Image.camera_id == event.camera_id,
                Image.is_hidden == False,  # noqa: E712
                Image.storage_path.isnot(None),
                Image.captured_at <= cutoff,
            )
            .order_by(Image.captured_at.desc())
            .limit(3)
        )
    ).scalars().all()
    return EventThumbnails(uuids=list(uuids))


class ResolveFeedEventRequest(BaseModel):
    action: Literal['rename_site', 'set_site', 'new_site', 'not_moved']
    # rename_site and new_site need `name`; set_site needs `site_id`.
    name: Optional[str] = None
    site_id: Optional[int] = None


class ResolveFeedEventResponse(BaseModel):
    # How many deployments the action merged away (not_moved folds the split
    # deployment back into its predecessor, so usually 1 there; 0 elsewhere).
    merged: int = 0


async def _site_in_project(db: AsyncSession, project_id: int, site_id: int) -> Site:
    site = (
        await db.execute(
            select(Site).where(Site.id == site_id, Site.project_id == project_id)
        )
    ).scalar_one_or_none()
    if site is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Site not found",
        )
    return site


async def _drop_site_if_event_orphaned_it(db: AsyncSession, event: FeedEvent) -> None:
    """
    Delete the site this event auto-created when the correction just emptied
    it. Undoing a move (or picking a different site) would otherwise leave the
    auto-created site behind with zero cameras, exactly the phantom-site
    debris the feed exists to prevent. Only fires for the site this event
    made (site_created) and only when no deployment points at it anymore.
    Call after the reassign and before event.site_id is overwritten.
    """
    if not event.site_created or event.site_id is None:
        return
    remaining = (
        await db.execute(
            select(func.count(Deployment.id)).where(Deployment.site_id == event.site_id)
        )
    ).scalar_one()
    if remaining == 0:
        await db.execute(delete(Site).where(Site.id == event.site_id))
        logger.info("Deleted orphaned auto-created site", site_id=event.site_id)


async def _deployment_or_conflict(db: AsyncSession, event: FeedEvent) -> Deployment:
    """The event's deployment, or 409 when it was merged away since."""
    deployment = (
        await db.execute(
            select(Deployment).where(Deployment.id == event.deployment_id)
        )
    ).scalar_one_or_none() if event.deployment_id else None
    if deployment is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This deployment no longer exists, the entry is out of date",
        )
    return deployment


def _required_name(request: ResolveFeedEventRequest) -> str:
    name = (request.name or '').strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A site name is required for this action",
        )
    return name


@router.post("/{event_id}/resolve", response_model=ResolveFeedEventResponse)
async def resolve_event(
    project_id: int,
    event_id: int,
    request: ResolveFeedEventRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access),
):
    """
    Act on a feed entry. Each action wraps existing site/deployment plumbing;
    the entry records which action was taken and by whom.
    """
    event = (
        await db.execute(
            select(FeedEvent).where(
                FeedEvent.id == event_id, FeedEvent.project_id == project_id
            )
        )
    ).scalar_one_or_none()
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feed entry not found",
        )

    merged = 0
    if request.action == 'rename_site':
        if event.site_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This site no longer exists, the entry is out of date",
            )
        site = await _site_in_project(db, project_id, event.site_id)
        site.name = _required_name(request)

    elif request.action == 'set_site':
        if request.site_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A site is required for this action",
            )
        deployment = await _deployment_or_conflict(db, event)
        await _site_in_project(db, project_id, request.site_id)
        merged = await reassign_deployment_site(db, deployment, request.site_id)
        await _drop_site_if_event_orphaned_it(db, event)
        event.site_id = request.site_id

    elif request.action == 'new_site':
        name = _required_name(request)
        deployment = await _deployment_or_conflict(db, event)
        loc = (
            await db.execute(
                text("""
                    SELECT ST_Y(location::geometry) AS lat,
                           ST_X(location::geometry) AS lon
                    FROM deployments WHERE id = :dep_id
                """),
                {"dep_id": deployment.id},
            )
        ).fetchone()
        site = Site(
            uuid=str(uuid_module.uuid4()),
            project_id=project_id,
            name=name,
            location=WKTElement(f"POINT({loc.lon} {loc.lat})", srid=4326),
        )
        db.add(site)
        # The unique (project_id, name) constraint fires at this flush, not at
        # commit, so map it to the same 409 the commit handler gives.
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another site in this project already has that name",
            )
        merged = await reassign_deployment_site(db, deployment, site.id)
        event.site_id = site.id

    else:  # not_moved
        if event.from_site_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The previous site is not known, the entry cannot be undone",
            )
        deployment = await _deployment_or_conflict(db, event)
        await _site_in_project(db, project_id, event.from_site_id)
        # Putting the deployment back on its previous site makes it contiguous
        # with its predecessor, so the merge folds it (and its images) back.
        merged = await reassign_deployment_site(db, deployment, event.from_site_id)
        await _drop_site_if_event_orphaned_it(db, event)
        event.site_id = event.from_site_id

    event.resolved_action = request.action
    event.resolved_at = func.now()
    event.resolved_by_user_id = user.id
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another site in this project already has that name",
        )
    logger.info(
        "Resolved feed event",
        event_id=event_id,
        project_id=project_id,
        action=request.action,
        merged=merged,
    )
    return ResolveFeedEventResponse(merged=merged)
