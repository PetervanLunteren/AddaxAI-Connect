"""The minimum password length is enforced by the API, not only the forms.

The frontend checks the same number for a quick message, but anyone can call
the API directly, so this is the check that counts.
"""
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")))

import pytest
from fastapi_users import exceptions

from auth.user_manager import MIN_PASSWORD_LENGTH, UserManager


@pytest.fixture
def manager():
    # validate_password reads no state, so no user database is needed.
    return UserManager(None)


def test_minimum_is_15():
    assert MIN_PASSWORD_LENGTH == 15


@pytest.mark.asyncio
async def test_one_short_of_the_minimum_is_rejected(manager):
    with pytest.raises(exceptions.InvalidPasswordException) as err:
        await manager.validate_password("x" * (MIN_PASSWORD_LENGTH - 1), {})
    assert str(MIN_PASSWORD_LENGTH) in err.value.reason


@pytest.mark.asyncio
async def test_the_minimum_is_accepted(manager):
    await manager.validate_password("x" * MIN_PASSWORD_LENGTH, {})
