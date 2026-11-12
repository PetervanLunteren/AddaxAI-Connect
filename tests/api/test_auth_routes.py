"""
The routes that are mounted for login and for the user's own account.

The FastAPI-Users auth and users routers are not mounted. Their PATCH
/users/me changed the email address and the password without the current
password. This test fails when one of them comes back, for example through a
library upgrade or a copied snippet.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")))

from auth.routes import get_auth_router  # noqa: E402
from routers.users import router as users_router  # noqa: E402


def _routes(router) -> set[tuple[str, str]]:
    return {(method, route.path) for route in router.routes for method in route.methods}


def test_user_routes_are_read_only():
    assert _routes(users_router) == {
        ("GET", "/users/me"),
        ("GET", "/users/me/projects"),
    }


def test_login_is_our_own_route_and_logout_is_gone():
    routes = _routes(get_auth_router())
    assert ("POST", "/auth/login") in routes
    assert ("POST", "/auth/logout") not in routes


def test_no_auth_route_changes_an_account_by_id():
    assert not [path for _, path in _routes(get_auth_router()) if path.startswith("/users")]
