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
from shared.models import (
    DetectionAlertRule,
    Deployment,
    ProjectMembership,
    Site,
    TheftWatchRule,
    User,
    UserInvitation,
)
from auth.permissions import require_project_access, require_project_admin_access
from auth.project_access import get_site_scope
from utils.deployment_edits import recompute_site_location
from utils.site_scope import site_in_scope
from utils.tags import normalize_tags, rename_tag_in_list

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
    notes: Optional[str] = None


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
    site_scope: Optional[List[int]] = Depends(get_site_scope),
    db: AsyncSession = Depends(get_async_session),
):
    """List the project's sites with aggregate counts and last activity."""
    scope_sql = " AND s.id = ANY(:scope)" if site_scope is not None else ""
    params: Dict[str, Any] = {"project_id": project_id}
    if site_scope is not None:
        params["scope"] = site_scope
    rows = (
        await db.execute(
            text(f"""
                SELECT s.id, s.uuid, s.name, s.habitat_type, s.tags, s.notes,
                       ST_Y(s.location::geometry) AS lat,
                       ST_X(s.location::geometry) AS lon,
                       count(DISTINCT d.id) AS deployment_count,
                       count(DISTINCT d.camera_id) AS camera_count,
                       count(i.id) AS image_count,
                       max(i.captured_at) AS last_activity
                FROM sites s
                LEFT JOIN deployments d ON d.site_id = s.id
                LEFT JOIN images i ON i.deployment_id = d.id
                WHERE s.project_id = :project_id{scope_sql}
                GROUP BY s.id
                ORDER BY s.name
            """),
            params,
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
            notes=r["notes"],
        )
        for r in rows
    ]


@router.get("/tags", response_model=List[str])
async def get_site_tags(
    project_id: int,
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
    db: AsyncSession = Depends(get_async_session),
):
    """All unique tags across sites in this project, sorted, used for TagInput autocomplete."""
    query = select(Site.tags).where(
        Site.project_id == project_id,
        Site.tags.isnot(None),
    )
    if site_scope is not None:
        query = query.where(Site.id.in_(site_scope))
    result = await db.execute(query)
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


# Bulk-edit endpoints. Declared before /{site_id} so FastAPI matches the
# literal segment first (otherwise "bulk-add-tags" gets coerced to site_id:
# int and 422s, same gotcha as the camera bulk routes).

class BulkSiteIdsRequest(BaseModel):
    """Common payload prefix: every bulk action operates on a list of sites."""
    site_ids: List[int]


class BulkTagsRequest(BulkSiteIdsRequest):
    tags: List[str]


class BulkSetNotesRequest(BulkSiteIdsRequest):
    # Empty string is a valid clear; the frontend confirms the destructive
    # nature in the dialog before firing.
    notes: str


class BulkSetHabitatRequest(BulkSiteIdsRequest):
    # Empty string clears the habitat type on every selected site.
    habitat_type: str = Field(max_length=100)


class BulkUpdateResponse(BaseModel):
    updated_count: int


async def _load_bulk_sites(
    db: AsyncSession, project_id: int, site_ids: List[int],
) -> List[Site]:
    """Fetch the sites for a bulk request and reject empty lists, stale IDs,
    or sites outside the project. The route dependency already verified
    project-admin access, so membership in the project is the only check left."""
    if not site_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="site_ids must not be empty",
        )

    requested = set(site_ids)
    result = await db.execute(
        select(Site).where(Site.id.in_(requested), Site.project_id == project_id)
    )
    sites = list(result.scalars().all())

    found = {s.id for s in sites}
    missing = sorted(requested - found)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown site IDs in this project: {missing}",
        )

    return sites


@router.post("/bulk-add-tags", response_model=BulkUpdateResponse)
async def bulk_add_tags(
    project_id: int,
    request: BulkTagsRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Append the given tags to every selected site. Existing tags are kept,
    duplicates collapse via normalize_tags."""
    if not request.tags:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tags must not be empty",
        )

    sites = await _load_bulk_sites(db, project_id, request.site_ids)
    incoming = normalize_tags(request.tags)
    for site in sites:
        site.tags = normalize_tags(list(site.tags or []) + incoming)

    await db.commit()
    return BulkUpdateResponse(updated_count=len(sites))


@router.post("/bulk-remove-tags", response_model=BulkUpdateResponse)
async def bulk_remove_tags(
    project_id: int,
    request: BulkTagsRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Remove the given tags from every selected site. Tags not present are
    a no-op for that row; the request never errors on a missing tag."""
    if not request.tags:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tags must not be empty",
        )

    sites = await _load_bulk_sites(db, project_id, request.site_ids)
    to_remove = set(normalize_tags(request.tags))
    for site in sites:
        site.tags = [t for t in (site.tags or []) if t not in to_remove]

    await db.commit()
    return BulkUpdateResponse(updated_count=len(sites))


class RenameTagRequest(BaseModel):
    old_tag: str
    new_tag: str


class DeleteTagRequest(BaseModel):
    tag: str


async def _sites_with_tags(db: AsyncSession, project_id: int) -> List[Site]:
    """Every site in the project that carries at least one tag. Loaded in
    Python because the tag lives in a JSON list; projects hold tens of
    sites, not thousands."""
    result = await db.execute(
        select(Site).where(Site.project_id == project_id, Site.tags.isnot(None))
    )
    return list(result.scalars().all())


@router.post("/tags/rename", response_model=BulkUpdateResponse)
async def rename_site_tag(
    project_id: int,
    request: RenameTagRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Rename a tag on every site in the project that carries it, in one
    transaction. Renaming onto an existing tag merges the two."""
    old = normalize_tags([request.old_tag])
    new = normalize_tags([request.new_tag])
    if not old or not new:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both the current and the new tag are required",
        )

    updated = 0
    for site in await _sites_with_tags(db, project_id):
        if old[0] in (site.tags or []):
            site.tags = rename_tag_in_list(site.tags, old[0], new[0])
            updated += 1

    await db.commit()
    logger.info(
        "Renamed site tag", project_id=project_id,
        old_tag=old[0], new_tag=new[0], updated_count=updated,
    )
    return BulkUpdateResponse(updated_count=updated)


@router.post("/tags/delete", response_model=BulkUpdateResponse)
async def delete_site_tag(
    project_id: int,
    request: DeleteTagRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Remove a tag from every site in the project that carries it, in one
    transaction."""
    norm = normalize_tags([request.tag])
    if not norm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A tag is required",
        )

    updated = 0
    for site in await _sites_with_tags(db, project_id):
        if norm[0] in (site.tags or []):
            site.tags = [t for t in site.tags if t != norm[0]]
            updated += 1

    await db.commit()
    logger.info(
        "Deleted site tag", project_id=project_id,
        tag=norm[0], updated_count=updated,
    )
    return BulkUpdateResponse(updated_count=updated)


@router.post("/bulk-set-notes", response_model=BulkUpdateResponse)
async def bulk_set_notes(
    project_id: int,
    request: BulkSetNotesRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Replace notes on every selected site with the given string. Empty
    string clears the field."""
    sites = await _load_bulk_sites(db, project_id, request.site_ids)
    for site in sites:
        site.notes = request.notes or None

    await db.commit()
    return BulkUpdateResponse(updated_count=len(sites))


@router.post("/bulk-set-habitat", response_model=BulkUpdateResponse)
async def bulk_set_habitat(
    project_id: int,
    request: BulkSetHabitatRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Set habitat_type on every selected site. Empty string clears it."""
    sites = await _load_bulk_sites(db, project_id, request.site_ids)
    for site in sites:
        site.habitat_type = request.habitat_type.strip() or None

    await db.commit()
    return BulkUpdateResponse(updated_count=len(sites))


@router.get("/{site_id}", response_model=SiteDetail)
async def get_site(
    project_id: int,
    site_id: int,
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
    db: AsyncSession = Depends(get_async_session),
):
    """One site with its deployments."""
    # 404 rather than 403 so restricted viewers cannot enumerate sites
    if not site_in_scope(site_id, site_scope):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
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
        site.tags = normalize_tags(body.tags)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another site in this project already has that name",
        )
    return await _build_detail(db, project_id, site_id)


def _updated_scope(site_ids: List[int], site_id: int, replacement_id: Optional[int]) -> List[int]:
    """The list with site_id removed, or swapped for replacement_id, deduplicated."""
    result: List[int] = []
    for s in site_ids:
        mapped = replacement_id if s == site_id else s
        if mapped is not None and mapped not in result:
            result.append(mapped)
    return result


async def _remove_site_from_scopes(
    db: AsyncSession,
    project_id: int,
    site_id: int,
    replacement_id: Optional[int] = None,
) -> None:
    """
    Take a site that is about to be deleted (or merged, then replacement_id
    is the target) out of every JSON site_ids list that references it:
    detection alert rules, theft watch rules, viewer memberships, and unused
    invitations. The lists have no foreign key, so without this a rule scoped
    only to the site would silently match nothing forever.

    A rule whose list ends up empty is paused (is_active=False), so the rules
    page shows what happened instead of an active rule that never fires. A
    membership or invitation that ends up empty stays [], which every scope
    reader treats as "sees nothing" (fail closed); the admin re-scopes the
    viewer.
    """
    scoped = [
        (DetectionAlertRule, True),
        (TheftWatchRule, True),
        (ProjectMembership, False),
        (UserInvitation, False),
    ]
    for model, has_active_flag in scoped:
        query = select(model).where(
            model.project_id == project_id,
            model.site_ids.is_not(None),
        )
        if model is UserInvitation:
            query = query.where(UserInvitation.used == False)  # noqa: E712
        rows = (await db.execute(query)).scalars().all()
        for row in rows:
            if site_id not in (row.site_ids or []):
                continue
            new_ids = _updated_scope(row.site_ids, site_id, replacement_id)
            row.site_ids = new_ids
            if not new_ids and has_active_flag:
                row.is_active = False
            logger.info(
                "Removed site from scope list",
                model=model.__name__,
                row_id=row.id,
                site_id=site_id,
                replacement_id=replacement_id,
                now_empty=not new_ids,
            )


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
    await _remove_site_from_scopes(db, project_id, source.id, replacement_id=target.id)
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
    (deployments.site_id is set to NULL by the foreign key). Rules and viewer
    scopes that referenced the site are cleaned in the same transaction.
    """
    site = await _site_in_project(db, project_id, site_id)
    await _remove_site_from_scopes(db, project_id, site_id)
    await db.delete(site)
    await db.commit()
    logger.info("Deleted site", site_id=site_id, project_id=project_id)
