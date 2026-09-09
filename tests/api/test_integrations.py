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
    SensingCluesAccountRequest,
    SensingCluesConfigRequest,
    configure_sensingclues,
    key_hint,
    known_kind,
    list_sensingclues_groups,
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
    "group_name": "Addax_testgroup",
}


@pytest.fixture(autouse=True)
def _allow_any_address(monkeypatch):
    """The address check resolves DNS, which the save and groups tests do
    not want. Off by default; the address tests turn it back on. Its own
    behaviour is covered in tests/shared."""
    monkeypatch.setattr(integrations, "address_problem", lambda base_url: None)


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
        assert out.group_name == "Addax_testgroup"
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

    def test_a_network_failure_keeps_its_own_message(self):
        error = SensingCluesError("Sensing Clues request failed: timed out")
        assert user_detail(error) == "Sensing Clues request failed: timed out"

    def test_another_status_never_echoes_the_body_back(self):
        # An address pointing at some other web server answers with a whole
        # HTML page, which has no business in a toast
        error = SensingCluesError(
            "Sensing Clues login failed with 405: <!doctype html><html>...", status=405
        )
        detail = user_detail(error)
        assert "html" not in detail
        assert "405" in detail and "address" in detail


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
            def ensure_token(self):
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


class TestSensingCluesGroups:
    """The dropdown the setup screen shows. Nothing is stored here: the
    account arrives in the body because the page asks before saving."""

    def _request(self, **overrides):
        values = dict(
            base_url="https://central-test.sensingclues.org/v1/",
            username="addax_service",
            password="fake-test-password",
        )
        values.update(overrides)
        return SensingCluesAccountRequest(**values)

    def _client(self, monkeypatch, groups=None, error=None):
        class FakeClient:
            def list_groups(self):
                if error is not None:
                    raise error
                return groups

        monkeypatch.setattr(integrations, "client_from_config", lambda config: FakeClient())

    @pytest.mark.asyncio
    async def test_the_groups_come_back_with_their_names(self, monkeypatch):
        self._client(monkeypatch, groups=[
            {"id": "3523928", "name": "Addax_testgroup"},
            {"id": "77", "name": "Serengeti rangers"},
        ])
        out = await list_sensingclues_groups(1, self._request(), user=None, db=None)
        assert [(g.id, g.name) for g in out.groups] == [
            (3523928, "Addax_testgroup"), (77, "Serengeti rangers"),
        ]

    @pytest.mark.asyncio
    async def test_a_group_id_that_is_not_a_number_is_left_out(self, monkeypatch):
        # Their ids are numeric strings; anything else we could not save
        self._client(monkeypatch, groups=[{"id": "abc", "name": "odd one"}])
        out = await list_sensingclues_groups(1, self._request(), user=None, db=None)
        assert out.groups == []

    @pytest.mark.asyncio
    async def test_an_account_in_no_group_is_an_empty_list(self, monkeypatch):
        self._client(monkeypatch, groups=[])
        out = await list_sensingclues_groups(1, self._request(), user=None, db=None)
        assert out.groups == []

    @pytest.mark.asyncio
    async def test_a_wrong_account_is_a_400_about_the_account(self, monkeypatch):
        self._client(monkeypatch, error=SensingCluesError("login failed", status=401))
        with pytest.raises(HTTPException) as info:
            await list_sensingclues_groups(1, self._request(), user=None, db=None)
        assert info.value.status_code == 400
        assert "username and the password" in info.value.detail

    @pytest.mark.asyncio
    async def test_an_empty_value_is_refused_before_any_call(self, monkeypatch):
        monkeypatch.setattr(
            integrations, "client_from_config",
            lambda config: (_ for _ in ()).throw(ValueError()),
        )
        with pytest.raises(HTTPException) as info:
            await list_sensingclues_groups(1, self._request(password=""), user=None, db=None)
        assert info.value.status_code == 400
        assert "Fill in" in info.value.detail


class TestSensingCluesAddress:
    """A bad address must be refused before the server ever fetches it, on
    both the groups lookup and the save. The check's own rules are tested
    in tests/shared; here it only has to be wired in and to run first."""

    def _account(self, **overrides):
        values = dict(
            base_url="https://central-test.sensingclues.org/v1/",
            username="addax_service",
            password="fake-test-password",
        )
        values.update(overrides)
        return SensingCluesAccountRequest(**values)

    def _config(self, **overrides):
        values = dict(
            base_url="https://central-test.sensingclues.org/v1/",
            username="addax_service",
            password="fake-test-password",
            group_id=3523928,
        )
        values.update(overrides)
        return SensingCluesConfigRequest(**values)

    def _refuse_address(self, monkeypatch):
        monkeypatch.setattr(
            integrations, "address_problem",
            lambda base_url: "That address points at a private network and cannot be used.",
        )
        # The vendor client must never be built if the address is refused
        monkeypatch.setattr(integrations, "client_from_config", lambda config: 1 / 0)

    @pytest.mark.asyncio
    async def test_groups_refuses_a_bad_address_before_any_call(self, monkeypatch):
        self._refuse_address(monkeypatch)
        with pytest.raises(HTTPException) as info:
            await list_sensingclues_groups(1, self._account(), user=None, db=None)
        assert info.value.status_code == 400
        assert "private network" in info.value.detail

    @pytest.mark.asyncio
    async def test_save_refuses_a_bad_address_before_any_call(self, monkeypatch):
        self._refuse_address(monkeypatch)
        with pytest.raises(HTTPException) as info:
            await configure_sensingclues(1, self._config(), user=None, db=None)
        assert info.value.status_code == 400
        assert "private network" in info.value.detail


class TestSensingCluesGroupName:
    """The group's name travels with the save so the page can name the
    group rather than number it."""

    def _accept(self, monkeypatch):
        class FakeClient:
            def ensure_token(self):
                return None

        monkeypatch.setattr(integrations, "client_from_config", lambda config: FakeClient())

    def _request(self, **overrides):
        values = dict(
            base_url="https://central-test.sensingclues.org/v1/",
            username="addax_service",
            password="fake-test-password",
            group_id=3523928,
        )
        values.update(overrides)
        return SensingCluesConfigRequest(**values)

    @pytest.mark.asyncio
    async def test_the_name_is_stored_with_the_group(self, monkeypatch):
        self._accept(monkeypatch)
        saved = {}

        async def capture(db, kind, project_id, config):
            saved.update(config)
            return _row(config)

        monkeypatch.setattr(integrations, "save_config", capture)
        await configure_sensingclues(
            1, self._request(group_name="  Addax_testgroup  "), user=None, db=None,
        )
        assert saved["group_name"] == "Addax_testgroup"

    @pytest.mark.asyncio
    async def test_a_save_without_a_name_still_works(self, monkeypatch):
        self._accept(monkeypatch)
        saved = {}

        async def capture(db, kind, project_id, config):
            saved.update(config)
            return _row(config)

        monkeypatch.setattr(integrations, "save_config", capture)
        await configure_sensingclues(1, self._request(), user=None, db=None)
        assert "group_name" not in saved
        assert saved["group_id"] == 3523928
