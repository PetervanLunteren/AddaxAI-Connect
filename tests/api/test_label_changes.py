"""What a label change removes from rules and thresholds (utils/label_changes.py).

One rule: a label that leaves the project is removed everywhere it is used,
a rule with no label left is deleted, a threshold on it is deleted. These
tests run clean_gone_labels on stand-in rows; the two queries it makes (the
rules, and which owners can be reached) are replaced, so what is tested is
the rule itself.
"""
import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils import label_changes  # noqa: E402
from shared.classification_models import DEEPFAUNE_ID  # noqa: E402

ADMIN = SimpleNamespace(id=1)
LABELS = ["wolf", "red fox", "mammal"]


def rule(species, owner=2, channels=("email",)):
    return SimpleNamespace(species=species, created_by_user_id=owner, channels=list(channels))


def report(species, owner=2):
    """A species report: always email, so it has no channels column."""
    return SimpleNamespace(species=species, created_by_user_id=owner)


class _Db:
    def __init__(self):
        self.deleted = []

    async def delete(self, row):
        self.deleted.append(row)


@pytest.fixture
def stand_in(monkeypatch):
    """Replace the two queries: the project's rules, and which owners can be
    reached (everyone, unless `unreachable` names them)."""
    def install(rules, unreachable=()):
        async def _rules(db, project_id):
            return rules

        async def _reachable_owners(db, project_id, owner_ids):
            return {i: f"user{i}@example.org" for i in owner_ids if i not in unreachable}

        monkeypatch.setattr(label_changes, "_rules", _rules)
        monkeypatch.setattr(label_changes, "_reachable_owners", _reachable_owners)

    return install


@pytest.fixture
def clean(stand_in):
    """clean_gone_labels on the given rules."""
    def run(rules, overrides=None, apply=True, unreachable=(), labels=LABELS):
        stand_in(rules, unreachable)
        project = SimpleNamespace(
            id=4, classification_thresholds={"default": 0.5, "overrides": dict(overrides or {})},
        )
        db = _Db()
        return label_changes.clean_gone_labels(db, project, labels, ADMIN, apply=apply), db, project

    return run


async def _run(clean, *args, **kwargs):
    coroutine, db, project = clean(*args, **kwargs)
    impact, recipients = await coroutine
    return impact, recipients, db, project


class TestRules:
    @pytest.mark.asyncio
    async def test_a_gone_label_leaves_a_rule_that_keeps_others(self, clean):
        r = rule(["wolf", "porcupine", "red fox"])
        impact, _, db, _ = await _run(clean, [r])
        assert r.species == ["wolf", "red fox"]
        assert db.deleted == []
        assert (impact.rules_updated, impact.rules_deleted) == (1, 0)
        assert impact.labels == ["porcupine"]

    @pytest.mark.asyncio
    async def test_a_rule_with_no_label_left_is_deleted(self, clean):
        r = rule(["porcupine", "aardvark"])
        impact, _, db, _ = await _run(clean, [r])
        assert db.deleted == [r]
        assert (impact.rules_updated, impact.rules_deleted) == (0, 1)
        assert impact.labels == ["aardvark", "porcupine"]

    @pytest.mark.asyncio
    async def test_a_rule_for_all_labels_is_never_touched(self, clean):
        r = rule(None)
        impact, recipients, db, _ = await _run(clean, [r])
        assert r.species is None and db.deleted == []
        assert impact.is_empty and recipients == []

    @pytest.mark.asyncio
    async def test_rules_on_existing_labels_are_never_touched(self, clean):
        r = rule(["wolf", "red fox"])
        impact, _, db, _ = await _run(clean, [r])
        assert r.species == ["wolf", "red fox"] and db.deleted == []
        assert impact.is_empty

    @pytest.mark.asyncio
    async def test_detector_labels_and_the_fallback_always_exist(self, clean):
        r = rule(["person", "vehicle", "unknown animal"])
        impact, _, _, _ = await _run(clean, [r])
        assert impact.is_empty

    @pytest.mark.asyncio
    async def test_species_reports_follow_the_same_rule(self, clean):
        kept, gone = report(["wolf", "porcupine"]), report(["porcupine"])
        impact, _, db, _ = await _run(clean, [kept, gone])
        assert kept.species == ["wolf"] and db.deleted == [gone]
        assert (impact.rules_updated, impact.rules_deleted) == (1, 1)


class TestThresholds:
    @pytest.mark.asyncio
    async def test_only_thresholds_on_gone_labels_are_removed(self, clean):
        impact, _, _, project = await _run(clean, [], overrides={"wolf": 0.4, "porcupine": 0.7})
        assert project.classification_thresholds == {"default": 0.5, "overrides": {"wolf": 0.4}}

    @pytest.mark.asyncio
    async def test_a_threshold_goes_quietly(self, clean):
        # It is the admin's own setting and did nothing anymore, so it is not
        # in the impact and never opens the confirm window on its own.
        impact, recipients, _, _ = await _run(clean, [], overrides={"porcupine": 0.7})
        assert impact.is_empty and impact.labels == [] and recipients == []

    @pytest.mark.asyncio
    async def test_a_project_without_thresholds(self, clean):
        coroutine, _, project = clean([])
        project.classification_thresholds = None
        impact, _ = await coroutine
        assert impact.is_empty and project.classification_thresholds is None


class TestCountingOnly:
    @pytest.mark.asyncio
    async def test_without_apply_nothing_is_written(self, clean):
        kept, gone = rule(["wolf", "porcupine"]), rule(["porcupine"])
        impact, recipients, db, project = await _run(
            clean, [kept, gone], overrides={"porcupine": 0.7}, apply=False,
        )
        assert kept.species == ["wolf", "porcupine"] and gone.species == ["porcupine"]
        assert db.deleted == []
        assert project.classification_thresholds["overrides"] == {"porcupine": 0.7}
        assert (impact.rules_updated, impact.rules_deleted) == (1, 1)
        assert len(recipients) == 1

    @pytest.mark.asyncio
    async def test_counting_and_applying_give_the_same_impact(self, clean):
        def rows():
            return [rule(["wolf", "porcupine"]), rule(["porcupine"], owner=3), report(["aardvark"], owner=3)]

        counted, _, _, _ = await _run(clean, rows(), overrides={"porcupine": 0.7}, apply=False)
        applied, _, _, _ = await _run(clean, rows(), overrides={"porcupine": 0.7}, apply=True)
        assert counted == applied


class TestRecipients:
    @pytest.mark.asyncio
    async def test_one_recipient_per_owner_with_their_own_counts(self, clean):
        rows = [rule(["wolf", "porcupine"], owner=2), rule(["porcupine"], owner=2), report(["aardvark"], owner=3)]
        impact, recipients, _, _ = await _run(clean, rows)
        by_email = {r.email: r for r in recipients}
        two, three = by_email["user2@example.org"], by_email["user3@example.org"]
        assert (two.labels, two.rules_updated, two.rules_deleted) == ({"porcupine"}, 1, 1)
        assert (three.labels, three.rules_updated, three.rules_deleted) == ({"aardvark"}, 0, 1)
        assert impact.users_emailed == 2

    @pytest.mark.asyncio
    async def test_the_admin_who_does_it_gets_no_email(self, clean):
        r = rule(["wolf", "porcupine"], owner=ADMIN.id)
        impact, recipients, _, _ = await _run(clean, [r])
        assert r.species == ["wolf"]  # cleaned like any other rule
        assert recipients == [] and impact.users_emailed == 0

    @pytest.mark.asyncio
    async def test_a_project_channel_rule_is_cleaned_but_has_no_recipient(self, clean):
        r = rule(["wolf", "porcupine"], channels=("earthranger",))
        impact, recipients, _, _ = await _run(clean, [r])
        assert r.species == ["wolf"] and impact.rules_updated == 1
        assert recipients == []

    @pytest.mark.asyncio
    async def test_an_owner_who_cannot_be_reached_gets_no_email(self, clean):
        r = rule(["porcupine"], owner=7)
        impact, recipients, db, _ = await _run(clean, [r], unreachable={7})
        assert db.deleted == [r]  # the rule is still removed
        assert recipients == [] and impact.users_emailed == 0

    def test_reachable_means_active_verified_and_with_access(self):
        import inspect

        source = inspect.getsource(label_changes._reachable_owners)
        assert "User.is_active == True" in source
        assert "User.is_verified == True" in source
        assert "can_access_project(user, project_id, db)" in source


class TestConfirmOrRefuse:
    @pytest.mark.asyncio
    async def test_a_change_that_removes_something_is_refused_until_confirmed(self, stand_in):
        stand_in([rule(["porcupine"])])
        project = SimpleNamespace(id=4, classification_thresholds=None)
        db = _Db()
        with pytest.raises(HTTPException) as exc:
            await label_changes.confirm_or_refuse(db, project, LABELS, ADMIN, confirmed=False)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == "label_changes_need_confirmation"
        assert exc.value.detail["impact"] == {
            "labels": ["porcupine"], "rules_updated": 0, "rules_deleted": 1, "users_emailed": 1,
        }
        assert db.deleted == []

        await label_changes.confirm_or_refuse(db, project, LABELS, ADMIN, confirmed=True)
        assert db.deleted == []  # confirming only lets the caller go on

    @pytest.mark.asyncio
    async def test_a_change_that_removes_nothing_needs_no_confirm(self, stand_in):
        stand_in([rule(["wolf"])])
        project = SimpleNamespace(id=4, classification_thresholds=None)
        await label_changes.confirm_or_refuse(_Db(), project, LABELS, ADMIN, confirmed=False)


class TestFixedModelLabels:
    def test_a_species_list_is_the_label_list(self):
        assert label_changes.fixed_model_labels(DEEPFAUNE_ID, ["wolf", "fox"]) == ["wolf", "fox"]

    def test_an_empty_list_means_every_class_of_the_model(self):
        labels = label_changes.fixed_model_labels(DEEPFAUNE_ID, [])
        assert "red_deer" in labels and len(labels) == 38
        assert label_changes.fixed_model_labels(DEEPFAUNE_ID, None) == labels


class TestEmails:
    @pytest.mark.asyncio
    async def test_one_email_per_recipient_and_a_failure_is_not_raised(self, monkeypatch):
        sent = []

        class _Sender:
            async def send_labels_removed_email(self, **kwargs):
                if kwargs["email"] == "broken@example.org":
                    raise RuntimeError("smtp down")
                sent.append(kwargs)

        monkeypatch.setattr(label_changes, "get_email_sender", lambda: _Sender())
        recipients = [
            label_changes.Recipient(email="broken@example.org", labels={"wolf"}, rules_deleted=1),
            label_changes.Recipient(email="a@example.org", labels={"wolf", "aardvark"}, rules_updated=2),
        ]
        await label_changes.send_label_change_emails(4, "Namibia", recipients)
        assert sent == [{
            "email": "a@example.org", "project_id": 4, "project_name": "Namibia",
            "labels": ["aardvark", "wolf"], "rules_updated": 2, "rules_deleted": 0,
        }]
