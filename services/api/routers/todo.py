"""
GET /api/todo: the To do list of the signed-in user, for the top bar, and
the "not needed" marks of the lines that are a choice. The rules are in
utils/todo.py.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.users import current_verified_user
from shared.database import get_async_session
from shared.models import User
from utils.todo import (
    NotNeededItem, TodoResponse, list_not_needed, mark_not_needed, may_mark, todo_for, undo_not_needed,
)

router = APIRouter(prefix="/api/todo", tags=["todo"])


@router.get("", response_model=TodoResponse)
async def get_todo(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """Every project the user can open that has something to do, and the
    server lines for a server admin."""
    return await todo_for(user, db)


class NotNeededRequest(BaseModel):
    kind: str
    project_id: Optional[int] = None  # None for a server line


@router.get("/not-needed", response_model=List[NotNeededItem])
async def get_not_needed(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """The lines marked not needed that this user may undo."""
    return await list_not_needed(user, db)


async def _check(user: User, kind: str, project_id: Optional[int], db: AsyncSession) -> None:
    if not await may_mark(user, kind, project_id, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This line cannot be marked not needed by you")


@router.post("/not-needed", status_code=status.HTTP_204_NO_CONTENT)
async def post_not_needed(
    request: NotNeededRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """Hide a line that is a choice, for everyone who would see it."""
    await _check(user, request.kind, request.project_id, db)
    await mark_not_needed(user, request.kind, request.project_id, db)


@router.delete("/not-needed", status_code=status.HTTP_204_NO_CONTENT)
async def delete_not_needed(
    kind: str = Query(...),
    project_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """Undo: the line shows again while its rule holds."""
    await _check(user, kind, project_id, db)
    await undo_not_needed(kind, project_id, db)
