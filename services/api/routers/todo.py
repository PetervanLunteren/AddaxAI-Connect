"""
GET /api/todo: the To do list of the signed-in user, for the top bar.
The rules are in utils/todo.py.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from auth.users import current_verified_user
from shared.database import get_async_session
from shared.models import User
from utils.todo import TodoResponse, todo_for

router = APIRouter(prefix="/api/todo", tags=["todo"])


@router.get("", response_model=TodoResponse)
async def get_todo(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_verified_user),
):
    """Every project the user can open that has something to do, and the
    server lines for a server admin."""
    return await todo_for(user, db)
