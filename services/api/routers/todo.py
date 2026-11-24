"""
GET /api/todo: the Needs attention list of the signed-in user, for the top
bar, and POST /api/todo/dismiss to make lines quiet for that user. The
rules are in utils/todo.py.
"""
from typing import List

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.users import current_verified_user
from shared.database import get_async_session
from shared.models import User
from utils.todo import DismissLine, TodoResponse, dismiss, todo_for

router = APIRouter(prefix="/api/todo", tags=["todo"])


@router.get("", response_model=TodoResponse)
async def get_todo(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """Every project the user can open that has something to do, and the
    server lines for a server admin. Lines the user dismissed are quiet."""
    return await todo_for(user, db)


class DismissRequest(BaseModel):
    lines: List[DismissLine]


@router.post("/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def post_dismiss(
    request: DismissRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """Make these lines quiet for this user, until something new appears in
    them. One line, or every line in view (Dismiss all)."""
    await dismiss(user, request.lines, db)
