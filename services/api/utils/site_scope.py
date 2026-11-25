"""
Site scope helpers for site-restricted project-viewer memberships.

A scope is Optional[List[int]]. None means unrestricted (server admin,
project admin, or an unscoped viewer). A list means the caller may only
see those sites. An empty list is forbidden as a stored value (validated
here), but valid as a runtime filter after intersection, where it simply
matches nothing.

Two camera-site semantics coexist on purpose:

- Statistics and image filters use the deployment the image belongs to
  (site_image_clause) or any deployment ever at the sites
  (cameras_at_sites_clause). Time-correct: historical images count for
  the site the camera stood at when they were captured.
- Camera visibility (list, detail, export) uses the camera's current
  site, meaning its latest deployment (cameras_current_site_clause). A
  camera with no deployment or no resolved site has no current site and
  is invisible under a restricted scope, fail closed.

No FastAPI imports here so the pure helpers stay importable from the
unit tests without an app context.
"""
from typing import List, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from shared.deployment_queries import current_deployments, site_on
from shared.models import Camera, Deployment, Image, Site


def intersect_scope(
    allowed: Optional[List[int]],
    requested: Optional[List[int]],
) -> Optional[List[int]]:
    """Combine the membership scope with a user-supplied site filter.

    None on either side means "no restriction from that side". When both
    are lists the result is their intersection, which may be empty; an
    empty result must be applied as a filter (matches nothing), never
    treated as "no filter". Requested order is preserved.
    """
    if allowed is None:
        return requested
    if requested is None:
        return list(allowed)
    return [s for s in requested if s in set(allowed)]


def site_in_scope(site_id: Optional[int], scope: Optional[List[int]]) -> bool:
    """True when a single row's site passes the scope.

    A row without a resolved site (site_id None) fails a restricted
    scope, fail closed.
    """
    if scope is None:
        return True
    return site_id is not None and site_id in scope


def site_image_clause(site_id_list: List[int]):
    """Restrict images to a set of sites through each image's deployment.

    Time-correct: an image counts for the site its deployment stood at
    when captured, not the camera's current site. Images without a
    deployment are excluded, fail closed.
    """
    return Image.deployment_id.in_(
        select(Deployment.id).where(Deployment.site_id.in_(site_id_list))
    )


# The word in a site filter that asks for photos without a site (no
# deployment yet: a camera without GPS until a person sets its site).
NO_SITE = "none"


def parse_site_filter(value: Optional[str]) -> tuple[Optional[List[int]], bool]:
    """Split a comma-separated site filter into site ids and "no site".

    "3,none" gives ([3], True); "" or None gives (None, False). Ids are
    None, not [], when none were given, so "no filter" stays apart from
    "matches nothing".
    """
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    ids = [int(p) for p in parts if p != NO_SITE]
    return (ids or None), NO_SITE in parts


def image_site_filter(scope: Optional[List[int]], value: Optional[str]):
    """The site filter of an image list, or None for no filter.

    value is the comma-separated site_id parameter, which may hold
    NO_SITE for photos without a site. A viewer with a site list never
    sees those (site_image_clause fails closed), so for them NO_SITE asks
    for nothing: "none" alone matches nothing, never their whole list.
    """
    ids, asked_no_site = parse_site_filter(value)
    # "none" alone is still a filter: [] matches no site.
    requested = ids if ids is not None else ([] if asked_no_site else None)
    effective = intersect_scope(scope, requested)
    if asked_no_site and scope is None:
        unplaced = Image.deployment_id.is_(None)
        return or_(site_image_clause(effective), unplaced) if effective else unplaced
    return site_image_clause(effective) if effective is not None else None


def cameras_at_sites_clause(site_id_list: List[int]):
    """Restrict cameras to those with any deployment at the given sites."""
    return Camera.id.in_(
        select(Deployment.camera_id).where(Deployment.site_id.in_(site_id_list))
    )


def cameras_current_site_clause(site_id_list: List[int]):
    """Restrict cameras to those whose current site is in the given sites.

    Current site is the one rule of shared/deployment_queries.py, the same
    the camera list shows. A camera with no deployments, or whose current
    deployment has no site, does not match.
    """
    current = current_deployments()
    return Camera.id.in_(
        select(current.c.camera_id).where(current.c.site_id.in_(site_id_list))
    )


def site_of_camera(camera_id_col, on_date_col=None):
    """Correlated scalar subquery: the site a camera stood at, now or on a
    day. See site_on in shared/deployment_queries.py."""
    return site_on(camera_id_col, on_date_col)


def validate_membership_site_ids(
    role: str,
    site_ids: Optional[List[int]],
) -> Optional[str]:
    """Validate a membership site scope, returning an error message or None.

    Pure so it is unit-testable without a database. The check that the
    sites belong to the project needs the database and lives in
    sites_in_project.
    """
    if site_ids is None:
        return None
    # Matches Role.PROJECT_VIEWER; the literal keeps this module free of
    # FastAPI-importing modules
    if role != "project-viewer":
        return "site_ids can only be set for the project-viewer role"
    # An empty list is rejected so "all sites" has exactly one
    # representation, null
    if not site_ids:
        return "site_ids must be null for all sites, or a non-empty list"
    if not all(isinstance(s, int) and not isinstance(s, bool) for s in site_ids):
        return "site_ids must be integers"
    if len(site_ids) != len(set(site_ids)):
        return "site_ids must not repeat"
    return None


async def sites_in_project(
    db: AsyncSession, project_id: int, site_ids: List[int]
) -> bool:
    """True when every given site id belongs to the project."""
    count = (await db.execute(
        select(func.count(Site.id)).where(
            Site.id.in_(site_ids),
            Site.project_id == project_id,
        )
    )).scalar()
    return count == len(set(site_ids))
