"""
The To do list ("Needs attention" for users): what needs somebody now, per
project, for one user.

This is the one place where the app decides what to nudge about. The top
bar shows it; nothing else in the app keeps a badge or a warning bar. A
line is the current state, not a message: it is there while its rule holds
and leaves when its problem is fixed.

Each line says what and how many (`kind`, `count`). Words and links are
the browser's (src/lib/todo-lines.ts). To add a nudge: count it here, give
it a line there.

Dismiss makes a line quiet for one person, it never hides it: the line
stays in the list as a plain row, and the number on the icon counts only
the lines that are not quiet. A dismissal remembers the items the line held
(`keys`: cameras, moves, tasks, files), and the line turns loud again when
an item appears that was not there, also the same camera failing again
after it recovered. Per person, so badge fatigue is cured without hiding a
problem from anyone else (the Discourse and Gmail read model, with the
resurfacing of Sentry's "archive until escalating" and Linear's snooze).

Who sees what:
- the camera health lines (inactive, low battery, SD nearly full, rejecting
  files): every member, for the cameras they may see; a site-restricted
  viewer only the cameras at their sites, and no rejections (a rejection
  has no site, so they see none anywhere). These are fixed in the field.
- service tasks assigned to you: you.
- the other project lines: project admins (and server admins).
- the server lines: server admins.

The camera lines read the same rows as the Cameras page
(`routers.cameras.camera_responses`), so a line and the page with its
filter always show the same cameras.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.classification_models import SPECIESNET, get_model
from shared.deployment_queries import SHORT_TRIP_SQL
from shared.models import (
    Camera, CameraServiceTask, Project, ProjectIntegration, ProjectMembership, Rejection,
    TelegramConfig, TodoDismissal, User,
)
from routers.cameras import camera_responses
from routers.health import collect_services_health
from utils.server_time import server_today

# Suspicious deployments: short trips nobody answered (SHORT_TRIP_SQL). One
# row per deployment.
SUSPICIOUS_MOVES_SQL = f"""
    SELECT c.project_id, d.camera_id, d.start_at FROM deployments d
    JOIN cameras c ON c.id = d.camera_id
    WHERE c.project_id = ANY(:project_ids) AND d.checked_at IS NULL AND {SHORT_TRIP_SQL}
"""

# Rejected files of no known camera: a camera that is not registered yet, or
# a file without a device id. Only a server admin can act on them.
UNKNOWN_FILES_DAYS = 7


class TodoItem(BaseModel):
    kind: str
    count: int
    overdue: Optional[int] = None  # my_tasks: how many of them are overdue
    target: Optional[str] = None  # integration_error: which integration
    # Dismissed by this user and nothing new since: a plain row, not counted
    # on the icon.
    quiet: bool = False
    # Loud again after a dismissal: how many of `count` came since. None
    # when the user never dismissed the line (then all of it is new).
    new: Optional[int] = None
    # What the line counts (camera ids, task ids, move and file keys), all
    # things the user can see. Dismiss sends back the keys the user saw.
    keys: List[str] = Field(default_factory=list)


class TodoProject(BaseModel):
    project_id: int
    project_name: str
    items: List[TodoItem]


class TodoResponse(BaseModel):
    projects: List[TodoProject]
    server: List[TodoItem]


@dataclass
class _Membership:
    project: Project
    is_admin: bool
    site_ids: Optional[List[int]]  # None: all sites


async def _memberships(user: User, db: AsyncSession) -> List[_Membership]:
    """The projects the user can open, with what they may see there."""
    if user.is_superuser:
        projects = (await db.execute(select(Project).order_by(Project.name))).scalars().all()
        return [_Membership(project=p, is_admin=True, site_ids=None) for p in projects]
    rows = (await db.execute(
        select(ProjectMembership, Project)
        .join(Project, ProjectMembership.project_id == Project.id)
        .where(ProjectMembership.user_id == user.id)
        .order_by(Project.name)
    )).all()
    return [
        _Membership(project=p, is_admin=m.role == 'project-admin', site_ids=m.site_ids)
        for m, p in rows
    ]


def _item(kind: str, keys, **extra) -> Optional[TodoItem]:
    """A line counting `keys`, or None when there is nothing to count."""
    keys = [str(k) for k in keys]
    return TodoItem(kind=kind, count=len(keys), keys=keys, **extra) if keys else None


Lines = Dict[Optional[int], Tuple[str, List[TodoItem]]]  # project id (None: server) -> (name, items)


async def _lines(user: User, db: AsyncSession) -> Lines:
    """Every open line of the user, per project, and the server's under None."""
    memberships = await _memberships(user, db)
    by_project = {m.project.id: m for m in memberships}
    project_ids = list(by_project)
    admin_ids = [pid for pid, m in by_project.items() if m.is_admin]
    items: Dict[int, List[TodoItem]] = {pid: [] for pid in project_ids}

    def add(project_id: int, item: Optional[TodoItem]) -> None:
        if item is not None:
            items[project_id].append(item)

    # Cameras, as the Cameras page shows them to this user.
    cameras = (await db.execute(
        select(Camera).where(Camera.project_id.in_(project_ids)).order_by(Camera.id)
    )).scalars().all() if project_ids else []
    open_ids = {pid for pid, m in by_project.items() if m.site_ids is None}
    rows = await camera_responses(db, cameras, open_ids)
    site_of: Dict[int, Optional[int]] = {}
    seen: Dict[int, list] = {pid: [] for pid in project_ids}
    for camera, row in zip(cameras, rows):
        site_of[camera.id] = row.current_site['id'] if row.current_site else None
        allowed = by_project[camera.project_id].site_ids
        if allowed is None or site_of[camera.id] in allowed:
            seen[camera.project_id].append(row)

    def cameras_where(pid: int, rule) -> List[int]:
        return [r.id for r in seen[pid] if rule(r)]

    # Service tasks: mine for everyone, the others' overdue ones for admins.
    today = await server_today(db)
    tasks = (await db.execute(
        select(CameraServiceTask.id, CameraServiceTask.camera_id, CameraServiceTask.assigned_to_user_id,
               CameraServiceTask.due_date, Camera.project_id)
        .join(Camera, Camera.id == CameraServiceTask.camera_id)
        .where(Camera.project_id.in_(project_ids))
    )).all() if project_ids else []

    def overdue(t) -> bool:
        return t.due_date is not None and t.due_date < today

    for pid in project_ids:
        m = by_project[pid]
        mine = [t for t in tasks if t.project_id == pid and t.assigned_to_user_id == user.id
                and (m.site_ids is None or site_of.get(t.camera_id) in m.site_ids)]
        add(pid, _item('my_tasks', [t.id for t in mine], overdue=sum(1 for t in mine if overdue(t))))
        if m.is_admin:
            add(pid, _item('overdue_tasks', [
                t.id for t in tasks
                if t.project_id == pid and t.assigned_to_user_id != user.id and overdue(t)]))

    # Admin lines: what only a project admin can fix.
    suspicious: List = []
    failing: List = []
    if admin_ids:
        suspicious = (await db.execute(text(SUSPICIOUS_MOVES_SQL), {"project_ids": admin_ids})).all()
        failing = (await db.execute(
            select(ProjectIntegration.project_id, ProjectIntegration.kind)
            .where(ProjectIntegration.project_id.in_(admin_ids),
                   ProjectIntegration.is_enabled.is_(True),
                   ProjectIntegration.health_status == 'error')
            .order_by(ProjectIntegration.kind)
        )).all()
    for pid in admin_ids:
        project = by_project[pid].project
        # A deployment is known by its camera and start (rowKey in rows.ts).
        add(pid, _item('suspicious_moves', [
            f"{r.camera_id}@{r.start_at.isoformat()}" for r in suspicious if r.project_id == pid]))
        add(pid, _item('unplaced_photos', cameras_where(pid, lambda r: r.unplaced_photo_count)))
        add(pid, _item('sim_expiring', cameras_where(pid, lambda r: r.sim_expiring)))
        for row in failing:
            if row.project_id == pid:
                add(pid, _item('integration_error', [row.kind], target=row.kind))
        # SpeciesNet ignores the species list, so only a fixed-class model
        # asks for one.
        if get_model(project.classification_model).kind != SPECIESNET and not project.included_species:
            add(pid, _item('choose_species', ['species']))

    # Camera health, for every member.
    for pid in project_ids:
        add(pid, _item('inactive', cameras_where(pid, lambda r: r.status == 'inactive')))
        add(pid, _item('low_battery', cameras_where(pid, lambda r: r.low_battery)))
        add(pid, _item('sd_nearly_full', cameras_where(pid, lambda r: r.sd_nearly_full)))
        # None for a site-restricted viewer, so it counts nothing for them.
        add(pid, _item('rejecting', cameras_where(pid, lambda r: r.rejecting)))

    lines: Lines = {pid: (by_project[pid].project.name, items[pid]) for pid in project_ids if items[pid]}
    server = await _server_items(user, db)
    if server:
        lines[None] = ('Server', server)
    return lines


async def _server_items(user: User, db: AsyncSession) -> List[TodoItem]:
    if not user.is_superuser:
        return []
    services = await collect_services_health(db)
    since = datetime.now(timezone.utc) - timedelta(days=UNKNOWN_FILES_DAYS)
    unknown_files = (await db.execute(
        select(Rejection.id).where(Rejection.project_id.is_(None), Rejection.rejected_at > since)
    )).scalars().all()
    telegram = (await db.execute(select(TelegramConfig.is_configured).limit(1))).scalar_one_or_none()
    server = [
        _item('services_down', [s.name for s in services if s.status != 'healthy']),
        _item('unknown_camera_files', unknown_files),
        None if telegram else _item('telegram_not_set_up', ['telegram']),
    ]
    return [item for item in server if item is not None]


def _items_of(lines: Lines, project_id: Optional[int], kind: str, target: Optional[str] = None) -> List[TodoItem]:
    """The items of one (project, kind): usually one, one per integration."""
    _, items = lines.get(project_id, ('', []))
    return [i for i in items if i.kind == kind and (target is None or i.target == target)]


async def todo_for(user: User, db: AsyncSession) -> TodoResponse:
    lines = await _lines(user, db)

    # A dismissal keeps only the items still there, so an item that left
    # (the camera recovered) is new again when it comes back, and a line that
    # is gone takes its dismissal with it.
    dismissals = (await db.execute(
        select(TodoDismissal).where(TodoDismissal.user_id == user.id))).scalars().all()
    changed = False
    for dismissal in dismissals:
        items = _items_of(lines, dismissal.project_id, dismissal.kind)
        current = {k for item in items for k in item.keys}
        kept = [k for k in dismissal.keys if k in current]
        if kept != list(dismissal.keys):
            changed = True
            if kept:
                dismissal.keys = kept
            else:
                await db.delete(dismissal)
        for item in items:
            fresh = len(set(item.keys) - set(kept))
            item.quiet = fresh == 0
            item.new = fresh or None
    if changed:
        await db.commit()

    server = lines.pop(None, ('', []))[1]
    return TodoResponse(
        projects=[TodoProject(project_id=pid, project_name=name, items=items)
                  for pid, (name, items) in lines.items()],
        server=server,
    )


class DismissLine(BaseModel):
    kind: str
    project_id: Optional[int] = None  # None for a server line
    target: Optional[str] = None  # integration_error: which integration
    keys: List[str]  # the items the user saw in the line


async def dismiss(user: User, wanted: List[DismissLine], db: AsyncSession) -> None:
    """Make lines quiet for this user: remember the items they saw. Only
    keys still in the line count, so an item that arrived after the panel
    opened stays new, and nobody can store keys they are not shown."""
    lines = await _lines(user, db)
    stored = {(d.project_id, d.kind): d for d in (await db.execute(
        select(TodoDismissal).where(TodoDismissal.user_id == user.id))).scalars().all()}
    for line in wanted:
        current = {k for item in _items_of(lines, line.project_id, line.kind, line.target) for k in item.keys}
        keys = current & set(line.keys)
        if not keys:
            continue
        dismissal = stored.get((line.project_id, line.kind))
        if dismissal is None:
            dismissal = TodoDismissal(user_id=user.id, project_id=line.project_id, kind=line.kind, keys=[])
            db.add(dismissal)
            stored[(line.project_id, line.kind)] = dismissal
        dismissal.keys = sorted(set(dismissal.keys) | keys)
    await db.commit()
