"""
The To do list: what needs somebody now, per project, for one user.

This is the one place where the app decides what to nudge about. The top
bar shows it; nothing else in the app keeps a badge or a warning bar. A
line is the current state, not a message: it has no read or dismissed
state and leaves when its problem is fixed.

Each line says what and how many (`kind`, `count`). Words and links are
the browser's (src/lib/todo-lines.ts). To add a nudge: count it here, give
it a line there.

Most lines leave only when fixed. The few that are a choice, not a fault
(`NOT_NEEDED_KINDS`), can be marked not needed by whoever could fix them:
hidden for everyone, with who and when kept, until undone. Not a personal
hide: a shared problem that each person hides for themselves gets fixed
by nobody.

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
from typing import List, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.classification_models import SPECIESNET, get_model
from shared.models import (
    Camera, CameraServiceTask, Project, ProjectIntegration, ProjectMembership, Rejection,
    TelegramConfig, TodoNotNeeded, User,
)

# A move nobody answered that came back to the site it left within
# SHORT_TRIP_DAYS: the mark of a false move. The Moves page marks the same
# rows Suspicious (`suspicious` in components/deployments/moves.ts);
# tests/db_api/test_review.py holds the two together.
SHORT_TRIP_DAYS = 7
SUSPICIOUS_MOVES_SQL = f"""
    SELECT c.project_id, count(*) AS count FROM deployments d
    JOIN cameras c ON c.id = d.camera_id
    WHERE c.project_id = ANY(:project_ids) AND d.site_source = 'auto' AND d.checked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM deployments before_it, deployments after_it
        WHERE before_it.camera_id = d.camera_id AND before_it.end_at = d.start_at
          AND after_it.camera_id = d.camera_id AND after_it.start_at = d.end_at
          AND after_it.site_id = before_it.site_id
          AND d.end_at - d.start_at <= interval '{SHORT_TRIP_DAYS} days'
      )
    GROUP BY c.project_id
"""

# Rejected files of no known camera: a camera that is not registered yet, or
# a file without a device id. Only a server admin can act on them.
UNKNOWN_FILES_DAYS = 7

# The lines that may be marked not needed, and whose they are: a project
# line is a project admin's, a server line a server admin's. Unknown files
# come back when a file newer than the mark arrives; the others stay hidden
# until undone.
NOT_NEEDED_KINDS = {
    'choose_species': 'project',
    'telegram_not_set_up': 'server',
    'unknown_camera_files': 'server',
}


class TodoItem(BaseModel):
    kind: str
    count: int
    overdue: Optional[int] = None  # my_tasks: how many of them are overdue
    target: Optional[str] = None  # integration_error: which integration


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


async def todo_for(user: User, db: AsyncSession) -> TodoResponse:
    # Imported here: the routers import this module's models.
    from routers.admin import get_server_timezone
    from routers.cameras import camera_responses

    memberships = await _memberships(user, db)
    marked = {(r.kind, r.project_id): r.created_at
              for r in (await db.execute(select(TodoNotNeeded))).scalars().all()}
    by_project = {m.project.id: m for m in memberships}
    project_ids = list(by_project)
    admin_ids = [pid for pid, m in by_project.items() if m.is_admin]
    items: dict[int, List[TodoItem]] = {pid: [] for pid in project_ids}

    def add(project_id: int, kind: str, count: int, **extra) -> None:
        if count > 0:
            items[project_id].append(TodoItem(kind=kind, count=count, **extra))

    # Cameras, as the Cameras page shows them to this user.
    cameras = (await db.execute(
        select(Camera).where(Camera.project_id.in_(project_ids)).order_by(Camera.id)
    )).scalars().all() if project_ids else []
    open_ids = {pid for pid, m in by_project.items() if m.site_ids is None}
    rows = await camera_responses(db, cameras, open_ids)
    site_of: dict[int, Optional[int]] = {}
    seen: dict[int, list] = {pid: [] for pid in project_ids}
    for camera, row in zip(cameras, rows):
        site_of[camera.id] = row.current_site['id'] if row.current_site else None
        allowed = by_project[camera.project_id].site_ids
        if allowed is None or site_of[camera.id] in allowed:
            seen[camera.project_id].append(row)

    # Service tasks: mine for everyone, the others' overdue ones for admins.
    today = datetime.now(ZoneInfo(await get_server_timezone(db))).date()
    tasks = (await db.execute(
        select(CameraServiceTask.camera_id, CameraServiceTask.assigned_to_user_id,
               CameraServiceTask.due_date, Camera.project_id)
        .join(Camera, Camera.id == CameraServiceTask.camera_id)
        .where(Camera.project_id.in_(project_ids))
    )).all() if project_ids else []

    for pid in project_ids:
        m = by_project[pid]
        mine = [t for t in tasks if t.project_id == pid and t.assigned_to_user_id == user.id
                and (m.site_ids is None or site_of.get(t.camera_id) in m.site_ids)]
        add(pid, 'my_tasks', len(mine),
            overdue=sum(1 for t in mine if t.due_date is not None and t.due_date < today))
        if m.is_admin:
            add(pid, 'overdue_tasks', sum(
                1 for t in tasks if t.project_id == pid and t.assigned_to_user_id != user.id
                and t.due_date is not None and t.due_date < today))

    # Admin lines: what only a project admin can fix.
    suspicious = {}
    failing = []
    if admin_ids:
        suspicious = dict((await db.execute(
            text(SUSPICIOUS_MOVES_SQL), {"project_ids": admin_ids})).all())
        failing = (await db.execute(
            select(ProjectIntegration.project_id, ProjectIntegration.kind)
            .where(ProjectIntegration.project_id.in_(admin_ids),
                   ProjectIntegration.is_enabled.is_(True),
                   ProjectIntegration.health_status == 'error')
            .order_by(ProjectIntegration.kind)
        )).all()
    for pid in admin_ids:
        project = by_project[pid].project
        add(pid, 'suspicious_moves', suspicious.get(pid, 0))
        add(pid, 'unplaced_photos', sum(1 for r in seen[pid] if r.unplaced_photo_count))
        add(pid, 'sim_expiring', sum(1 for r in seen[pid] if r.sim_expiring))
        for row in failing:
            if row.project_id == pid:
                add(pid, 'integration_error', 1, target=row.kind)
        # SpeciesNet ignores the species list, so only a fixed-class model
        # asks for one.
        if (get_model(project.classification_model).kind != SPECIESNET and not project.included_species
                and ('choose_species', pid) not in marked):
            add(pid, 'choose_species', 1)

    # Camera health, for every member.
    for pid in project_ids:
        add(pid, 'inactive', sum(1 for r in seen[pid] if r.status == 'inactive'))
        add(pid, 'low_battery', sum(1 for r in seen[pid] if r.low_battery))
        add(pid, 'sd_nearly_full', sum(1 for r in seen[pid] if r.sd_nearly_full))
        # None for a site-restricted viewer, so it counts nothing for them.
        add(pid, 'rejecting', sum(1 for r in seen[pid] if r.rejecting))

    projects = [
        TodoProject(project_id=pid, project_name=by_project[pid].project.name, items=items[pid])
        for pid in project_ids if items[pid]
    ]
    return TodoResponse(projects=projects, server=await _server_items(user, db, marked))


async def _server_items(user: User, db: AsyncSession, marked: dict) -> List[TodoItem]:
    if not user.is_superuser:
        return []
    from routers.health import collect_services_health

    services = await collect_services_health(db)
    since = datetime.now(timezone.utc) - timedelta(days=UNKNOWN_FILES_DAYS)
    since = max(since, marked.get(('unknown_camera_files', None), since))
    unknown_files = (await db.execute(
        select(func.count(Rejection.id))
        .where(Rejection.project_id.is_(None), Rejection.rejected_at > since)
    )).scalar_one()
    telegram = (await db.execute(select(TelegramConfig.is_configured).limit(1))).scalar_one_or_none()

    server = [
        TodoItem(kind='services_down', count=sum(1 for s in services if s.status != 'healthy')),
        TodoItem(kind='unknown_camera_files', count=unknown_files),
        TodoItem(kind='telegram_not_set_up',
                 count=0 if telegram or ('telegram_not_set_up', None) in marked else 1),
    ]
    return [item for item in server if item.count > 0]


# Not needed


class NotNeededItem(BaseModel):
    kind: str
    project_id: Optional[int] = None
    by: Optional[str] = None  # email, None when that account is gone
    at: str  # ISO time


async def may_mark(user: User, kind: str, project_id: Optional[int], db: AsyncSession) -> bool:
    """Whoever could fix the line may mark it: a project admin a project
    line, a server admin a server line. Any other kind is never marked."""
    from auth.permissions import can_admin_project

    whose = NOT_NEEDED_KINDS.get(kind)
    if whose == 'server':
        return project_id is None and user.is_superuser
    if whose == 'project':
        return project_id is not None and await can_admin_project(user, project_id, db)
    return False


def _row_filter(kind: str, project_id: Optional[int]):
    project = (TodoNotNeeded.project_id.is_(None) if project_id is None
               else TodoNotNeeded.project_id == project_id)
    return TodoNotNeeded.kind == kind, project


async def mark_not_needed(user: User, kind: str, project_id: Optional[int], db: AsyncSession) -> None:
    """Mark a line not needed, now and by this user. Marking again moves the
    mark to now: for unknown files, that hides the files that came since."""
    await db.execute(delete(TodoNotNeeded).where(*_row_filter(kind, project_id)))
    db.add(TodoNotNeeded(kind=kind, project_id=project_id, user_id=user.id))
    await db.commit()


async def undo_not_needed(kind: str, project_id: Optional[int], db: AsyncSession) -> None:
    await db.execute(delete(TodoNotNeeded).where(*_row_filter(kind, project_id)))
    await db.commit()


async def list_not_needed(user: User, db: AsyncSession) -> List[NotNeededItem]:
    """The marks this user may see and undo, for the note on the page each
    line links to."""
    rows = (await db.execute(
        select(TodoNotNeeded, User.email)
        .outerjoin(User, User.id == TodoNotNeeded.user_id)
        .order_by(TodoNotNeeded.id)
    )).all()
    return [
        NotNeededItem(kind=r.kind, project_id=r.project_id, by=email, at=r.created_at.isoformat())
        for r, email in rows
        if await may_mark(user, r.kind, r.project_id, db)
    ]
