"""
Scheduled project reminders.

Project admins create one-shot reminders tied to a project: a date and a
free-text message. A daily cron at 06:45 UTC scans for due rows and emails
the creator on the date. Sent and cancelled rows stay so the history is
auditable.

Routes are mounted under /api/projects/{project_id}/reminders. All write
endpoints (POST, DELETE) require project-admin or server-admin access on
the target project. The list endpoint requires the same gate so non-admins
do not see the project-level operational schedule.
"""
from datetime import date, datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from shared.models import Project, ProjectReminder, User
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_admin_project


router = APIRouter(prefix="/api/projects", tags=["reminders"])

MAX_MESSAGE_LENGTH = 2000


class ReminderResponse(BaseModel):
    id: int
    send_on: date
    message: str
    created_by_user_id: int
    created_by_email: Optional[str] = None
    sent_at: Optional[str] = None
    cancelled_at: Optional[str] = None
    cancelled_by_user_id: Optional[int] = None
    cancelled_by_email: Optional[str] = None
    created_at: str


class CreateReminderRequest(BaseModel):
    send_on: date
    message: str


async def _server_today(db: AsyncSession) -> date:
    """Resolve "today" in the configured server timezone so the past-date
    rejection behaves the same way the daily cron behaves."""
    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    return datetime.now(tz).date()


def _serialize(
    reminder: ProjectReminder,
    creator_email: Optional[str],
    canceller_email: Optional[str],
) -> ReminderResponse:
    return ReminderResponse(
        id=reminder.id,
        send_on=reminder.send_on,
        message=reminder.message,
        created_by_user_id=reminder.created_by_user_id,
        created_by_email=creator_email,
        sent_at=reminder.sent_at.isoformat() if reminder.sent_at else None,
        cancelled_at=(
            reminder.cancelled_at.isoformat() if reminder.cancelled_at else None
        ),
        cancelled_by_user_id=reminder.cancelled_by_user_id,
        cancelled_by_email=canceller_email,
        created_at=reminder.created_at.isoformat(),
    )


@router.get(
    "/{project_id}/reminders",
    response_model=List[ReminderResponse],
)
async def list_reminders(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """List every reminder for a project (active + sent + cancelled).

    Active first by send_on ascending, then sent / cancelled rows by
    sent_at / cancelled_at descending so the most recent history is at the
    top of that subsection.
    """
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    project = (await db.execute(
        select(Project).where(Project.id == project_id)
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found",
        )

    rows = (await db.execute(
        select(ProjectReminder)
        .where(ProjectReminder.project_id == project_id)
        .order_by(ProjectReminder.send_on.asc(), ProjectReminder.id.asc())
    )).scalars().all()

    # Resolve creator + canceller emails in one batch so the response is
    # human-readable without N round-trips.
    user_ids = set()
    for r in rows:
        user_ids.add(r.created_by_user_id)
        if r.cancelled_by_user_id is not None:
            user_ids.add(r.cancelled_by_user_id)
    emails: dict[int, str] = {}
    if user_ids:
        user_rows = (await db.execute(
            select(User.id, User.email).where(User.id.in_(user_ids))
        )).all()
        emails = {uid: email for uid, email in user_rows}

    return [
        _serialize(
            r,
            emails.get(r.created_by_user_id),
            emails.get(r.cancelled_by_user_id) if r.cancelled_by_user_id else None,
        )
        for r in rows
    ]


@router.post(
    "/{project_id}/reminders",
    response_model=ReminderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reminder(
    project_id: int,
    request: CreateReminderRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Create a future-dated reminder. The send_on date must be today or
    later in the server's local timezone; the message must be non-empty
    after stripping whitespace."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    project = (await db.execute(
        select(Project).where(Project.id == project_id)
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found",
        )

    message = request.message.strip()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reminder message must not be empty",
        )
    if len(message) > MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Reminder message must be {MAX_MESSAGE_LENGTH} characters or fewer",
        )

    today = await _server_today(db)
    if request.send_on < today:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reminder date must be today or later",
        )

    reminder = ProjectReminder(
        project_id=project_id,
        send_on=request.send_on,
        message=message,
        created_by_user_id=current_user.id,
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)

    return _serialize(reminder, current_user.email, None)


@router.delete(
    "/{project_id}/reminders/{reminder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def cancel_reminder(
    project_id: int,
    reminder_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Cancel a reminder. The row stays in the table for audit; only
    cancelled_at and cancelled_by_user_id are populated."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    reminder = (await db.execute(
        select(ProjectReminder).where(
            and_(
                ProjectReminder.id == reminder_id,
                ProjectReminder.project_id == project_id,
            )
        )
    )).scalar_one_or_none()
    if not reminder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reminder not found",
        )
    if reminder.sent_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reminder has already been sent",
        )
    if reminder.cancelled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reminder has already been cancelled",
        )

    reminder.cancelled_at = datetime.now(timezone.utc)
    reminder.cancelled_by_user_id = current_user.id
    await db.commit()
