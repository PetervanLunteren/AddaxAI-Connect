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

from fastapi import FastAPI  # noqa: E402

from auth.routes import get_auth_router  # noqa: E402
from routers.users import router as users_router  # noqa: E402


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


def _routes(router) -> set[tuple[str, str]]:
    """Every (METHOD, path) a router serves.

    Read from the API description FastAPI generates for an app that mounts the
    router, not from `router.routes`. What sits in that list is an internal
    detail: from FastAPI 0.141 an included router is one wrapper object there,
    with no methods of its own. This test passed on an older FastAPI and
    crashed in CI on the pinned one.
    """
    app = FastAPI()
    app.include_router(router)
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method in HTTP_METHODS
    }


def test_user_routes_are_read_only():
    assert _routes(users_router) == {
        ("GET", "/users/me"),
        ("GET", "/users/me/projects"),
    }


def test_login_is_our_own_route_and_logout_is_gone():
    routes = _routes(get_auth_router())
    assert ("POST", "/auth/login") in routes
    assert ("POST", "/auth/logout") not in routes
    # The two-factor routes come in through an included router. Seeing them
    # here proves the helper looks inside included routers too.
    assert ("POST", "/auth/login/two-factor") in routes
    assert ("POST", "/auth/two-factor/setup") in routes


def test_no_auth_route_changes_an_account_by_id():
    assert not [path for _, path in _routes(get_auth_router()) if path.startswith("/users")]
