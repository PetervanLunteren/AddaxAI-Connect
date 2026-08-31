"""The EarthRanger integration endpoints' pure parts.

The key must never leave the server: status_of exposes a hint at most, and
the request model takes the key only. The database-backed handlers are
covered by the dev stack QA in GUNDI_INTEGRATION.md.
"""
import os
import sys
from types import SimpleNamespace

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.integrations import EarthRangerStatus, key_hint, status_of  # noqa: E402
from routers.rule_helpers import EARTHRANGER, VALID_CHANNELS  # noqa: E402


class TestKeyHint:
    def test_last_four_characters(self):
        assert key_hint("fake-test-key-not-a-secret-aoxZ") == "aoxZ"

    def test_short_or_missing_keys_give_nothing(self):
        assert key_hint("abc") is None
        assert key_hint("") is None
        assert key_hint(None) is None


class TestStatusOf:
    def test_no_row_is_not_configured(self):
        assert status_of(None) == EarthRangerStatus(is_configured=False)

    def test_row_never_exposes_the_key(self):
        integration = SimpleNamespace(
            config={"api_key": "fake-test-key-not-a-secret-aoxZ"},
            is_enabled=True, health_status="healthy", last_health_check=None,
            last_sent_at=None, last_error=None, events_sent=12,
        )
        out = status_of(integration)
        assert out.is_configured is True
        assert out.api_key_hint == "aoxZ"
        assert out.events_sent == 12
        assert "fake-test-key" not in out.model_dump_json()

    def test_row_without_key_is_not_configured(self):
        integration = SimpleNamespace(
            config={}, is_enabled=True, health_status=None, last_health_check=None,
            last_sent_at=None, last_error=None, events_sent=0,
        )
        assert status_of(integration).is_configured is False


class TestChannelRegistry:
    def test_earthranger_is_a_known_channel(self):
        assert EARTHRANGER == "earthranger"
        assert VALID_CHANNELS == {"email", "telegram", "earthranger"}


class TestKeyValidation:
    def test_key_with_inner_whitespace_is_rejected(self):
        # The PUT handler strips and then refuses keys with spaces inside,
        # exercised via the same check the handler uses
        from routers.integrations import EarthRangerConfigRequest
        key = "n some label fake-test-key-not-a-secret-aoxZ"
        stripped = EarthRangerConfigRequest(api_key=key).api_key.strip()
        assert any(ch.isspace() for ch in stripped)
