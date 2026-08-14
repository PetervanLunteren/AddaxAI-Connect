"""Tests for the admin-only unblurred image serving."""
import inspect
import os
import sys

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)


class TestUnblurEndpoint:
    def _source(self):
        from routers.images import get_image_full

        return inspect.getsource(get_image_full)

    def test_permission_is_checked_server_side(self):
        # The UI toggle is convenience, the endpoint is the gate
        src = self._source()
        assert "can_admin_project(current_user, project.id, db)" in src

    def test_unauthorized_request_fails_hard(self):
        # A non-admin must get a 403, never a silent fallback to the
        # blurred version that could be mistaken for a working unblur
        src = self._source()
        assert "Project admin access required to view without privacy blur" in src
        assert "HTTP_403_FORBIDDEN" in src

    def test_every_unblurred_serve_is_audited(self):
        src = self._source()
        assert '"Unblurred image served"' in src
        assert "user_email=current_user.email" in src
        assert "image_uuid=image.uuid" in src

    def test_unblurred_response_is_not_cached(self):
        # No unblurred copy may linger in the browser cache
        src = self._source()
        assert "cache_max_age=0" in src

    def test_scope_stays_narrow(self):
        # Only the full-size detail view can be unblurred. Thumbnails and
        # annotated images must not grow this capability silently.
        from routers.images import get_image_thumbnail, get_annotated_image

        assert "unblurred" not in inspect.getsource(get_image_thumbnail)
        assert "unblurred" not in inspect.getsource(get_annotated_image)


class TestUnblurRejectedFile:
    """A rejected file never reaches the detector, so it is blurred whole. The
    same admin-only reveal applies, on the same terms as a stored image."""

    def _source(self):
        from routers.live_feed import get_rejection_image

        return inspect.getsource(get_rejection_image)

    def test_permission_is_checked_server_side(self):
        src = self._source()
        assert "can_admin_project(current_user, project_id, db)" in src

    def test_unauthorized_request_fails_hard(self):
        src = self._source()
        assert "Project admin access required to view without privacy blur" in src
        assert "HTTP_403_FORBIDDEN" in src

    def test_every_unblurred_serve_is_audited(self):
        src = self._source()
        assert '"Unblurred rejected file served"' in src
        assert "user_email=current_user.email" in src
        assert "rejection_id=rejection.id" in src

    def test_unblurred_response_is_not_cached(self):
        # No unblurred copy may linger in the browser cache
        src = self._source()
        assert "max-age=0" in src
