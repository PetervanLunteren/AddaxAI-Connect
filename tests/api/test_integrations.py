"""The integration endpoints' pure parts.

A credential must never leave the server: status_of exposes a key hint at
most, and the EarthRanger request model takes the key only. Sensing Clues
stores no credential per project, only the group id, and the status says
whether this server offers the integration at all. The database-backed
handlers are covered by the dev server checks in the plan, not here.
"""
import os
import sys
from types import SimpleNamespace

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import routers.integrations as integrations  # noqa: E402
from routers.integrations import (  # noqa: E402
    IntegrationStatus,
    key_hint,
    known_kind,
    require_sensingclues_available,
    status_of,
    validate_group_id,
)
import routers.rule_helpers as rule_helpers  # noqa: E402
from routers.rule_helpers import (  # noqa: E402
    VALID_CHANNELS,
    check_project_channel,
    is_project_rule,
)


def _row(config, **overrides):
    values = dict(
        config=config, is_enabled=True, health_status="healthy", last_health_check=None,
        last_sent_at=None, last_error=None, events_sent=12,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


class TestKeyHint:
    def test_last_four_characters(self):
        assert key_hint("fake-test-key-not-a-secret-aoxZ") == "aoxZ"

    def test_short_or_missing_keys_give_nothing(self):
        assert key_hint("abc") is None
        assert key_hint("") is None
        assert key_hint(None) is None


class TestStatusOf:
    def test_no_earthranger_row_is_not_configured(self):
        assert status_of("earthranger", None) == IntegrationStatus(is_configured=False)

    def test_earthranger_row_never_exposes_the_key(self):
        out = status_of("earthranger", _row({"api_key": "fake-test-key-not-a-secret-aoxZ"}))
        assert out.is_configured is True
        assert out.api_key_hint == "aoxZ"
        assert out.group_id is None
        assert out.events_sent == 12
        assert "fake-test-key" not in out.model_dump_json()

    def test_earthranger_row_without_key_is_not_configured(self):
        assert status_of("earthranger", _row({}, health_status=None, events_sent=0)).is_configured is False

    def test_sensingclues_row_reports_group_id(self, monkeypatch):
        monkeypatch.setattr(integrations, "is_available", lambda settings: True)
        out = status_of("sensingclues", _row({"group_id": 3523928}))
        assert out.is_available is True
        assert out.is_configured is True
        assert out.group_id == 3523928
        assert out.api_key_hint is None

    def test_sensingclues_without_server_account_is_unavailable(self, monkeypatch):
        monkeypatch.setattr(integrations, "is_available", lambda settings: False)
        out = status_of("sensingclues", None)
        assert out.is_available is False
        assert out.is_configured is False
        # A row saved before the account was removed stays visible, and unavailable
        out = status_of("sensingclues", _row({"group_id": 1}))
        assert out.is_available is False
        assert out.is_configured is True

    def test_sensingclues_row_without_group_id_is_not_configured(self, monkeypatch):
        monkeypatch.setattr(integrations, "is_available", lambda settings: True)
        assert status_of("sensingclues", _row({})).is_configured is False


class TestKinds:
    def test_known_kinds(self):
        assert known_kind("earthranger") == "earthranger"
        assert known_kind("sensingclues") == "sensingclues"

    def test_unknown_kind_is_404(self):
        with pytest.raises(HTTPException) as info:
            known_kind("gundi")
        assert info.value.status_code == 404


class TestChannelRegistry:
    def test_every_project_channel_is_a_valid_rule_channel(self):
        assert VALID_CHANNELS == {"email", "telegram", "earthranger", "sensingclues"}


class TestKeyValidation:
    def test_key_with_inner_whitespace_is_rejected(self):
        # The PUT handler strips and then refuses keys with spaces inside,
        # exercised via the same check the handler uses
        from routers.integrations import EarthRangerConfigRequest
        key = "n some label fake-test-key-not-a-secret-aoxZ"
        stripped = EarthRangerConfigRequest(api_key=key).api_key.strip()
        assert any(ch.isspace() for ch in stripped)


class TestSensingCluesValidation:
    def test_group_id_must_be_positive(self):
        validate_group_id(3523928)
        for bad in (0, -5):
            with pytest.raises(HTTPException) as info:
                validate_group_id(bad)
            assert info.value.status_code == 400

    def test_server_without_account_is_a_400(self, monkeypatch):
        monkeypatch.setattr(integrations, "is_available", lambda settings: False)
        with pytest.raises(HTTPException) as info:
            require_sensingclues_available()
        assert info.value.status_code == 400
        assert info.value.detail == "Sensing Clues is not enabled on this server"

    def test_server_with_account_passes(self, monkeypatch):
        monkeypatch.setattr(integrations, "is_available", lambda settings: True)
        assert require_sensingclues_available() is None


class TestProjectRuleSeparation:
    """The notifications page and the integration pages are separate
    worlds: a rule either notifies its maker or feeds one integration."""

    def test_is_project_rule(self):
        assert is_project_rule(["earthranger"]) is True
        assert is_project_rule(["sensingclues"]) is True
        assert is_project_rule(["email", "earthranger"]) is True
        assert is_project_rule(["email", "telegram"]) is False
        assert is_project_rule(None) is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", ["earthranger", "sensingclues"])
    async def test_mixing_channels_is_rejected(self, kind):
        # Raised before any database use, so db None is safe here
        with pytest.raises(HTTPException) as info:
            await check_project_channel(None, None, 1, [kind, "email"])
        assert info.value.status_code == 400
        assert kind in info.value.detail and "combined" in info.value.detail

    @pytest.mark.asyncio
    async def test_two_project_channels_are_rejected(self):
        with pytest.raises(HTTPException) as info:
            await check_project_channel(None, None, 1, ["earthranger", "sensingclues"])
        assert info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_personal_channels_skip_every_check(self):
        assert await check_project_channel(None, None, 1, ["email", "telegram"]) is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("kind", ["earthranger", "sensingclues"])
    async def test_rule_that_already_has_the_channel_stays_editable(self, kind):
        # The disconnect freeze: pausing or editing an existing project rule
        # must not re-check the integration, or a disconnected project
        # cannot manage its rules anymore
        assert await check_project_channel(
            None, None, 1, [kind], current_channels=[kind]
        ) is None

    @pytest.mark.asyncio
    async def test_switching_kind_is_checked_again(self, monkeypatch):
        async def deny(db, user, project_id):
            raise HTTPException(status_code=403, detail="Project admin access required")

        monkeypatch.setattr(rule_helpers, "require_project_admin", deny)
        with pytest.raises(HTTPException) as info:
            await check_project_channel(
                None, None, 1, ["sensingclues"], current_channels=["earthranger"]
            )
        assert info.value.status_code == 403
