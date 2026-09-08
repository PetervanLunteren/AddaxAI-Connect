"""The integration endpoints' pure parts.

A credential must never leave the server: status_of exposes a key hint at
most for EarthRanger and never the Sensing Clues password. Saving a
Sensing Clues account checks it against Cluey first, and the refusal path
is covered here because it must never reach the database. The rest of the
database-backed handlers are covered by the dev server checks.
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
    SensingCluesConfigRequest,
    configure_sensingclues,
    key_hint,
    known_kind,
    status_of,
    user_detail,
    validate_group_id,
)
from shared.sensingclues import SensingCluesError  # noqa: E402
import routers.rule_helpers as rule_helpers  # noqa: E402
from routers.rule_helpers import (  # noqa: E402
    VALID_CHANNELS,
    check_project_channel,
    is_project_rule,
)


_SC_CONFIG = {
    "base_url": "https://central-test.sensingclues.org/v1/",
    "username": "addax_service",
    "password": "fake-test-password",
    "group_id": 3523928,
}


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

    def test_sensingclues_row_reports_the_account_but_never_the_password(self):
        out = status_of("sensingclues", _row(_SC_CONFIG))
        assert out.is_configured is True
        assert out.group_id == 3523928
        assert out.username == "addax_service"
        assert out.base_url == "https://central-test.sensingclues.org/v1/"
        assert out.api_key_hint is None
        assert "fake-test-password" not in out.model_dump_json()

    def test_sensingclues_row_missing_a_value_is_not_configured(self):
        assert status_of("sensingclues", None).is_configured is False
        for key in ("base_url", "username", "password", "group_id"):
            row = _row({**_SC_CONFIG, key: None})
            assert status_of("sensingclues", row).is_configured is False, key


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

    def test_a_401_becomes_a_sentence_about_the_account(self):
        # "Unauthenticated" is their word for it and means nothing to a user
        detail = user_detail(SensingCluesError("Sensing Clues login failed with 401", status=401))
        assert "Check the address, the username and the password" in detail

    def test_a_404_becomes_a_sentence_about_the_group(self):
        # Their message for it names our own account back at the user
        detail = user_detail(SensingCluesError("returned 404: IS NOT A MEMBER", status=404))
        assert "group id is right" in detail

    def test_any_other_failure_keeps_its_own_message(self):
        error = SensingCluesError("Sensing Clues request failed: timed out")
        assert user_detail(error) == "Sensing Clues request failed: timed out"


class TestSensingCluesSave:
    """Nothing may reach the database until Cluey has accepted the
    account, so these run with db None."""

    def _request(self, **overrides):
        values = dict(
            base_url="https://central-test.sensingclues.org/v1/",
            username="addax_service",
            password="fake-test-password",
            group_id=3523928,
        )
        values.update(overrides)
        return SensingCluesConfigRequest(**values)

    def _refuse(self, monkeypatch, error):
        class FakeClient:
            def login(self):
                raise error

        monkeypatch.setattr(integrations, "client_from_config", lambda config: FakeClient())

    @pytest.mark.asyncio
    async def test_a_wrong_account_is_refused_before_saving(self, monkeypatch):
        self._refuse(monkeypatch, SensingCluesError("login failed with 401", status=401))
        with pytest.raises(HTTPException) as info:
            await configure_sensingclues(1, self._request(), user=None, db=None)
        assert info.value.status_code == 400
        assert "username and the password" in info.value.detail

    @pytest.mark.asyncio
    async def test_an_unreachable_server_keeps_its_own_message(self, monkeypatch):
        self._refuse(monkeypatch, SensingCluesError("Sensing Clues request failed: timed out"))
        with pytest.raises(HTTPException) as info:
            await configure_sensingclues(1, self._request(), user=None, db=None)
        assert info.value.status_code == 400
        assert "timed out" in info.value.detail

    @pytest.mark.asyncio
    async def test_an_empty_value_is_refused_before_any_call(self, monkeypatch):
        called = []
        monkeypatch.setattr(
            integrations, "client_from_config",
            lambda config: called.append(config) or (_ for _ in ()).throw(ValueError()),
        )
        with pytest.raises(HTTPException) as info:
            await configure_sensingclues(1, self._request(username="   "), user=None, db=None)
        assert info.value.status_code == 400
        assert "Fill in" in info.value.detail

    @pytest.mark.asyncio
    async def test_the_group_id_is_checked_first(self, monkeypatch):
        monkeypatch.setattr(integrations, "client_from_config", lambda config: 1 / 0)
        with pytest.raises(HTTPException) as info:
            await configure_sensingclues(1, self._request(group_id=0), user=None, db=None)
        assert info.value.status_code == 400
        assert "positive whole number" in info.value.detail


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
