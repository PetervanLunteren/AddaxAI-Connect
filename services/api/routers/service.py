"""
Service endpoints: the service log (visits) and planned service tasks.

A visit is a CameraMaintenanceEvent, a service done on a camera on a day.
A task is a CameraServiceTask, open work planned for a camera. Completing
a task logs a visit and deletes the task in one transaction, so the visit
log is the one history and the task table only holds open work.

Everything is stored per camera and shown by site: a visit carries the
site the camera stood at on the visit date, a task the camera's current
site. Project admins write; every project member can read, and a
site-restricted viewer only sees rows whose site is in their scope.
"""
from datetime import date, datetime
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import (
    Camera,
    CameraMaintenanceEvent,
    CameraServiceTask,
    Project,
    ProjectMembership,
    Site,
    User,
)
from auth.permissions import require_project_access, require_project_admin_access
from auth.project_access import get_site_scope
from mailer.sender import get_email_sender
from routers.cameras import _camera_label
from utils.site_scope import site_of_camera

logger = get_logger("api.service")

router = APIRouter(prefix="/api/projects/{project_id}", tags=["service"])

# The service-action vocabulary and its human labels, in display order. The
# frontend keeps its own copy of the labels (TypeScript can't import this,
# see services/frontend/src/lib/service-actions.ts); test_service pins the
# value set so the two cannot drift.
ACTION_LABELS = {
    "battery_change": "Battery change",
    "sd_card_swap": "SD card swap",
    "cleaning": "Cleaning",
    "vegetation_clearing": "Vegetation clearing",
    "inspection": "Inspection / check",
    # In-place angle change only. Moving a camera to a new site is a
    # placement change (the Placements tab), not a service action, so this
    # is named "angle" rather than "reposition" to avoid that overlap.
    "angle_adjustment": "Adjusted angle",
    "repair": "Repair",
    "other": "Other",
}
VALID_ACTION_TYPES = set(ACTION_LABELS)

# Cap the free-text note. Long enough for a real remark, short enough that a
# pathological paste cannot bloat the row or break the layout.
NOTE_MAX_LENGTH = 2000


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def validate_actions_and_note(action_types: List[str], note: Optional[str] = None) -> Optional[str]:
    """Validate the fields a visit and a task share, returning an error or None."""
    if not action_types:
        return "at least one action is required"
    if len(action_types) != len(set(action_types)):
        return "action_types must not repeat"
    invalid = set(action_types) - VALID_ACTION_TYPES
    if invalid:
        return f"unknown action types {', '.join(sorted(str(a) for a in invalid))}"
    if note is not None and len(note) > NOTE_MAX_LENGTH:
        return f"note must be {NOTE_MAX_LENGTH} characters or fewer"
    return None


def validate_maintenance_event(
    action_types: List[str],
    event_date: date,
    today: date,
    note: Optional[str] = None,
) -> Optional[str]:
    """Validate a visit: the shared fields, and the date must not be in the future.

    Pure so it is unit-testable without a database. The member check needs
    the database and lives in the endpoints.
    """
    error = validate_actions_and_note(action_types, note)
    if error:
        return error
    if event_date > today:
        return "event_date must not be in the future"
    return None


def is_overdue(due_date: Optional[date], today: date) -> bool:
    """An open task is overdue when its due date has passed. No due date, never."""
    return due_date is not None and due_date < today


def _date_label(d: Optional[date]) -> Optional[str]:
    return f"{d.day} {d:%b %Y}" if d else None


def task_email_context(project_name: str, assigner_email: str, tasks: List[dict]) -> dict:
    """Template values for the one email a request sends to an assignee.

    `tasks` holds {site_name, camera_label, action_types, due_date, note}
    per task. Sorted by site so the assignee reads the list as a route
    through the field; actions in vocabulary order.
    """
    rows = [
        {
            "site_name": t["site_name"],
            "camera_label": t["camera_label"],
            "actions_label": ", ".join(label for key, label in ACTION_LABELS.items() if key in t["action_types"]),
            "due_label": _date_label(t["due_date"]),
            "note": t["note"],
        }
        for t in tasks
    ]
    rows.sort(key=lambda r: ((r["site_name"] or "").lower(), r["camera_label"]))
    return {
        "project_name": project_name,
        "assigner_email": assigner_email,
        "task_count": len(rows),
        "tasks": rows,
    }


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

async def _server_today(db: AsyncSession) -> date:
    """Today under the server timezone, the reference for future and overdue dates."""
    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    return datetime.now(tz).date()


async def _check_member(db: AsyncSession, user_id: Optional[int], project_id: int, who: str) -> None:
    """400 when a picked person is not a member of the project.

    Constrains performers and assignees to the registered members the UI
    dropdown offers, so an admin cannot attribute work to, or read back the
    email of, a user outside the project.
    """
    if user_id is None:
        return
    result = await db.execute(
        select(ProjectMembership.id).where(
            ProjectMembership.user_id == user_id,
            ProjectMembership.project_id == project_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise _bad_request(f"{who} must be a member of this project")


async def _load_project_cameras(db: AsyncSession, project_id: int, camera_ids: List[int]) -> List[Camera]:
    """The requested cameras, all of which must belong to the project."""
    if not camera_ids:
        raise _bad_request("camera_ids must not be empty")
    wanted = set(camera_ids)
    cameras = (await db.execute(
        select(Camera).where(Camera.id.in_(wanted), Camera.project_id == project_id)
    )).scalars().all()
    missing = wanted - {c.id for c in cameras}
    if missing:
        raise _bad_request(f"Cameras not in this project: {sorted(missing)}")
    return list(cameras)


def _visits_query(project_id: int, site_scope: Optional[List[int]]):
    """Visits of the project with the site on the visit date and performer email."""
    site_id = site_of_camera(CameraMaintenanceEvent.camera_id, CameraMaintenanceEvent.event_date)
    performer = aliased(User)
    query = (
        select(CameraMaintenanceEvent, Camera, Site.id, Site.name, performer.email)
        .join(Camera, Camera.id == CameraMaintenanceEvent.camera_id)
        .outerjoin(Site, Site.id == site_id)
        .outerjoin(performer, performer.id == CameraMaintenanceEvent.performed_by_user_id)
        .where(Camera.project_id == project_id)
        .order_by(CameraMaintenanceEvent.event_date.desc(), CameraMaintenanceEvent.id.desc())
    )
    if site_scope is not None:
        query = query.where(Site.id.in_(site_scope))
    return query


def _tasks_query(project_id: int, site_scope: Optional[List[int]]):
    """Open tasks of the project with the camera's current site and assignee email.

    Sorted by due date with undated tasks last, which puts overdue ones first.
    """
    site_id = site_of_camera(CameraServiceTask.camera_id)
    assignee = aliased(User)
    query = (
        select(CameraServiceTask, Camera, Site.id, Site.name, assignee.email)
        .join(Camera, Camera.id == CameraServiceTask.camera_id)
        .outerjoin(Site, Site.id == site_id)
        .outerjoin(assignee, assignee.id == CameraServiceTask.assigned_to_user_id)
        .where(Camera.project_id == project_id)
        .order_by(CameraServiceTask.due_date.asc().nulls_last(), CameraServiceTask.id.asc())
    )
    if site_scope is not None:
        query = query.where(Site.id.in_(site_scope))
    return query


async def _load_tasks(db: AsyncSession, project_id: int, task_ids: List[int]) -> List[CameraServiceTask]:
    """The requested open tasks of the project, 404 when any is gone.

    A task that is gone was completed or cancelled already, so a double
    click can never log a visit twice.
    """
    if not task_ids:
        raise _bad_request("task_ids must not be empty")
    wanted = set(task_ids)
    tasks = (await db.execute(
        select(CameraServiceTask)
        .join(Camera, Camera.id == CameraServiceTask.camera_id)
        .where(CameraServiceTask.id.in_(wanted), Camera.project_id == project_id)
    )).scalars().all()
    missing = wanted - {t.id for t in tasks}
    if missing:
        raise _not_found(f"Service tasks not found: {sorted(missing)}")
    return list(tasks)


def _should_email(notify: bool, assignee_id: Optional[int], user: User) -> bool:
    """Only when asked, and never to yourself."""
    return notify and assignee_id is not None and assignee_id != user.id


async def _email_assignee(
    db: AsyncSession, project_id: int, assignee_id: int, assigner: User, task_ids: List[int]
) -> None:
    """Send the one assignment email of a request. Best effort, after commit.

    Built from the tasks as stored, so every request that assigns work sends
    the same email. A failed send is logged and never fails the request, the
    same as the invitation and role change emails.
    """
    try:
        assignee_email = (await db.execute(select(User.email).where(User.id == assignee_id))).scalar_one()
        project_name = (await db.execute(select(Project.name).where(Project.id == project_id))).scalar_one()
        rows = (await db.execute(
            _tasks_query(project_id, None).where(CameraServiceTask.id.in_(task_ids))
        )).all()
        context = task_email_context(
            project_name=project_name,
            assigner_email=assigner.email,
            tasks=[
                {
                    "site_name": site_name,
                    "camera_label": _camera_label(camera),
                    "action_types": task.action_types,
                    "due_date": task.due_date,
                    "note": task.note,
                }
                for task, camera, _site_id, site_name, _assignee_email in rows
            ],
        )
        await get_email_sender().send_service_tasks_email(assignee_email, project_id, context)
    except Exception as e:
        logger.error("Service tasks email failed", project_id=project_id, error=str(e), exc_info=True)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class VisitFields(BaseModel):
    """One service visit"""
    event_date: date
    action_types: List[str]
    performed_by_user_id: Optional[int] = None
    note: Optional[str] = None


class LogVisitsRequest(VisitFields):
    """The same visit logged on several cameras at once, one field trip"""
    camera_ids: List[int]


class TaskFields(BaseModel):
    """What a task asks for. `notify` emails the assignee once for the request."""
    action_types: List[str]
    note: Optional[str] = None
    due_date: Optional[date] = None
    assigned_to_user_id: Optional[int] = None
    notify: bool = False


class PlanTasksRequest(TaskFields):
    """One task per camera"""
    camera_ids: List[int]


class TaskIdsRequest(BaseModel):
    task_ids: List[int]


class AssignTasksRequest(TaskIdsRequest):
    """Hand the selected tasks to one member, or to nobody with null."""
    assigned_to_user_id: Optional[int] = None
    notify: bool = False


class CompleteTasksRequest(TaskIdsRequest):
    """Mark the selected tasks done on one day, by one person.

    action_types and note travel together: given, they replace what each
    task planned (the single-task dialog, which shows them); omitted, every
    task keeps its own (marking a whole field day done at once).
    """
    event_date: date
    performed_by_user_id: Optional[int] = None
    action_types: Optional[List[str]] = None
    note: Optional[str] = None


class VisitIdsRequest(BaseModel):
    visit_ids: List[int]


class ServiceVisitResponse(BaseModel):
    id: int
    camera_id: int
    camera_label: str
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    event_date: str  # YYYY-MM-DD
    action_types: List[str]
    performed_by_user_id: Optional[int] = None
    performed_by_email: Optional[str] = None
    note: Optional[str] = None


class ServiceTaskResponse(BaseModel):
    id: int
    camera_id: int
    camera_label: str
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    action_types: List[str]
    note: Optional[str] = None
    due_date: Optional[str] = None  # YYYY-MM-DD
    overdue: bool
    assigned_to_user_id: Optional[int] = None
    assigned_to_email: Optional[str] = None


class CountResponse(BaseModel):
    count: int


# ---------------------------------------------------------------------------
# Visits
# ---------------------------------------------------------------------------

@router.get("/service-visits", response_model=List[ServiceVisitResponse])
async def list_visits(
    project_id: int,
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
    db: AsyncSession = Depends(get_async_session),
):
    """Every service visit in the project, newest first."""
    rows = (await db.execute(_visits_query(project_id, site_scope))).all()
    return [
        ServiceVisitResponse(
            id=visit.id,
            camera_id=visit.camera_id,
            camera_label=_camera_label(camera),
            site_id=site_id,
            site_name=site_name,
            event_date=visit.event_date.isoformat(),
            action_types=visit.action_types,
            performed_by_user_id=visit.performed_by_user_id,
            performed_by_email=performer_email,
            note=visit.note,
        )
        for visit, camera, site_id, site_name, performer_email in rows
    ]


@router.post("/service-visits", response_model=CountResponse, status_code=status.HTTP_201_CREATED)
async def log_visits(
    project_id: int,
    request: LogVisitsRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Log the same visit on every selected camera."""
    cameras = await _load_project_cameras(db, project_id, request.camera_ids)
    error = validate_maintenance_event(
        request.action_types, request.event_date, await _server_today(db), request.note
    )
    if error:
        raise _bad_request(error)
    await _check_member(db, request.performed_by_user_id, project_id, "Performed-by user")

    for camera in cameras:
        db.add(CameraMaintenanceEvent(
            camera_id=camera.id,
            event_date=request.event_date,
            action_types=request.action_types,
            performed_by_user_id=request.performed_by_user_id,
            note=request.note or None,
            created_by_user_id=user.id,
        ))
    await db.commit()
    return CountResponse(count=len(cameras))


@router.post("/service-visits/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_visits(
    project_id: int,
    request: VisitIdsRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete the selected visits, for entries logged by mistake."""
    if not request.visit_ids:
        raise _bad_request("visit_ids must not be empty")
    wanted = set(request.visit_ids)
    visits = (await db.execute(
        select(CameraMaintenanceEvent)
        .join(Camera, Camera.id == CameraMaintenanceEvent.camera_id)
        .where(CameraMaintenanceEvent.id.in_(wanted), Camera.project_id == project_id)
    )).scalars().all()
    missing = wanted - {v.id for v in visits}
    if missing:
        raise _not_found(f"Service visits not found: {sorted(missing)}")
    for visit in visits:
        await db.delete(visit)
    await db.commit()


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

@router.get("/service-tasks", response_model=List[ServiceTaskResponse])
async def list_tasks(
    project_id: int,
    user: User = Depends(require_project_access),
    site_scope: Optional[List[int]] = Depends(get_site_scope),
    db: AsyncSession = Depends(get_async_session),
):
    """Every open service task in the project, overdue first."""
    today = await _server_today(db)
    rows = (await db.execute(_tasks_query(project_id, site_scope))).all()
    return [
        ServiceTaskResponse(
            id=task.id,
            camera_id=task.camera_id,
            camera_label=_camera_label(camera),
            site_id=site_id,
            site_name=site_name,
            action_types=task.action_types,
            note=task.note,
            due_date=task.due_date.isoformat() if task.due_date else None,
            overdue=is_overdue(task.due_date, today),
            assigned_to_user_id=task.assigned_to_user_id,
            assigned_to_email=assignee_email,
        )
        for task, camera, site_id, site_name, assignee_email in rows
    ]


async def _validate_task_fields(db: AsyncSession, project_id: int, fields: TaskFields) -> None:
    error = validate_actions_and_note(fields.action_types, fields.note)
    if error:
        raise _bad_request(error)
    await _check_member(db, fields.assigned_to_user_id, project_id, "Assignee")


@router.post("/service-tasks", response_model=CountResponse, status_code=status.HTTP_201_CREATED)
async def plan_tasks(
    project_id: int,
    request: PlanTasksRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Plan the same service on every selected camera, one task each."""
    cameras = await _load_project_cameras(db, project_id, request.camera_ids)
    await _validate_task_fields(db, project_id, request)

    tasks = [
        CameraServiceTask(
            camera_id=camera.id,
            action_types=request.action_types,
            note=request.note or None,
            due_date=request.due_date,
            assigned_to_user_id=request.assigned_to_user_id,
            created_by_user_id=user.id,
        )
        for camera in cameras
    ]
    db.add_all(tasks)
    await db.flush()
    task_ids = [t.id for t in tasks]
    await db.commit()

    if _should_email(request.notify, request.assigned_to_user_id, user):
        await _email_assignee(db, project_id, request.assigned_to_user_id, user, task_ids)
    return CountResponse(count=len(task_ids))


@router.patch("/service-tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def update_task(
    project_id: int,
    task_id: int,
    request: TaskFields,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Replace a task's fields. Any project admin may edit any task."""
    [task] = await _load_tasks(db, project_id, [task_id])
    await _validate_task_fields(db, project_id, request)

    task.action_types = request.action_types
    task.note = request.note or None
    task.due_date = request.due_date
    task.assigned_to_user_id = request.assigned_to_user_id
    await db.commit()

    if _should_email(request.notify, request.assigned_to_user_id, user):
        await _email_assignee(db, project_id, request.assigned_to_user_id, user, [task_id])


@router.post("/service-tasks/assign", status_code=status.HTTP_204_NO_CONTENT)
async def assign_tasks(
    project_id: int,
    request: AssignTasksRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Hand the selected tasks to one member, with at most one email."""
    tasks = await _load_tasks(db, project_id, request.task_ids)
    await _check_member(db, request.assigned_to_user_id, project_id, "Assignee")
    for task in tasks:
        task.assigned_to_user_id = request.assigned_to_user_id
    await db.commit()

    if _should_email(request.notify, request.assigned_to_user_id, user):
        await _email_assignee(db, project_id, request.assigned_to_user_id, user, request.task_ids)


@router.post("/service-tasks/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_tasks(
    project_id: int,
    request: TaskIdsRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Cancel the selected tasks. They never happened, so nothing is kept."""
    for task in await _load_tasks(db, project_id, request.task_ids):
        await db.delete(task)
    await db.commit()


@router.post("/service-tasks/complete", status_code=status.HTTP_201_CREATED)
async def complete_tasks(
    project_id: int,
    request: CompleteTasksRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Mark the selected tasks done: one visit each, tasks deleted, one commit."""
    tasks = await _load_tasks(db, project_id, request.task_ids)
    today = await _server_today(db)
    await _check_member(db, request.performed_by_user_id, project_id, "Performed-by user")

    for task in tasks:
        replace = request.action_types is not None
        action_types = request.action_types if replace else task.action_types
        note = (request.note or None) if replace else task.note
        error = validate_maintenance_event(action_types, request.event_date, today, note)
        if error:
            raise _bad_request(error)
        db.add(CameraMaintenanceEvent(
            camera_id=task.camera_id,
            event_date=request.event_date,
            action_types=action_types,
            performed_by_user_id=request.performed_by_user_id,
            note=note,
            created_by_user_id=user.id,
        ))
        await db.delete(task)
    await db.commit()
