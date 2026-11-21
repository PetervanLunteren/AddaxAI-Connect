import os
import sys

from deployment_db import empty_tables  # noqa: F401  (sets the database first)
from types import SimpleNamespace

import pytest
import pytest_asyncio

# The API imports its own packages as top-level (`utils`, `auth`, `routers`),
# as it does inside its container.
SERVICE = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
if SERVICE not in sys.path:
    sys.path.insert(0, SERVICE)

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from deployment_db import make_user  # noqa: E402


@pytest_asyncio.fixture
async def session():
    """A fresh async session per test. NullPool, because pytest-asyncio gives
    every test its own event loop and a pooled asyncpg connection cannot cross
    loops. The routes are called directly with this session, as FastAPI would."""
    url = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(url, poolclass=NullPool)
    async with AsyncSession(engine, expire_on_commit=False) as db:
        yield db
    await engine.dispose()


@pytest.fixture
def admin():
    """Only the id is read by the routes under test."""
    return SimpleNamespace(id=make_user())
