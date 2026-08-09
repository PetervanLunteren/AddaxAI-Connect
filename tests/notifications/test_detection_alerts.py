"""Tests for the detection alert rules evaluation.

Pure condition functions first, mirroring the camera alert tests, then
thin orchestration tests for handle_detection_event with the DB helpers
and delivery stubbed out, because the loop (cooldown stamping only after
delivery, rarity caching, threshold gates) is where live-path bugs live.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import detection_alerts as da
from detection_alerts import (
    EventFacts,
    cooldown_active,
    cooldown_key,
    group_size_met,
    hour_in_window,
    next_cooldown_state,
    rule_matches,
    species_display_name,
)


NOW = datetime(2026, 8, 9, 12, 0, 0, tzinfo=timezone.utc)


class TestHourInWindow:
    def test_plain_range_half_open(self):
        # [6, 10) means 06:00 up to 09:59, same as the images page filter
        assert hour_in_window(6, 6, 10) is True
        assert hour_in_window(9, 6, 10) is True
        assert hour_in_window(10, 6, 10) is False
        assert hour_in_window(5, 6, 10) is False

    def test_wrap_past_midnight(self):
        # 21 to 5 is the night
        for hour in (21, 23, 0, 4):
            assert hour_in_window(hour, 21, 5) is True
        for hour in (5, 12, 20):
            assert hour_in_window(hour, 21, 5) is False


class TestGroupSizeMet:
    def test_species_count_preferred(self):
        # 2 boar in an image of 5 animals does not satisfy "at least 3 boar"
        assert group_size_met(2, 5, 3) is False
        assert group_size_met(3, 1, 3) is True

    def test_detection_count_fallback(self):
        # Events queued before the producers learned species_count
        assert group_size_met(None, 5, 3) is True
        assert group_size_met(None, 2, 3) is False

    def test_no_count_fails_closed(self):
        assert group_size_met(None, None, 2) is False

    def test_boundary(self):
        assert group_size_met(3, None, 3) is True
        assert group_size_met(2, None, 3) is False


class TestCooldownKey:
    def test_with_site(self):
        assert cooldown_key("wolf", 4) == "wolf|4"

    def test_without_site(self):
        assert cooldown_key("wolf", None) == "wolf|none"


class TestCooldownActive:
    def test_empty_state_is_inactive(self):
        assert cooldown_active({}, "wolf|4", 30, NOW) is False
        assert cooldown_active(None, "wolf|4", 30, NOW) is False

    def test_fresh_stamp_suppresses(self):
        state = {"wolf|4": (NOW - timedelta(minutes=10)).isoformat()}
        assert cooldown_active(state, "wolf|4", 30, NOW) is True

    def test_expired_stamp_does_not_suppress(self):
        state = {"wolf|4": (NOW - timedelta(minutes=31)).isoformat()}
        assert cooldown_active(state, "wolf|4", 30, NOW) is False

    def test_other_key_does_not_suppress(self):
        # A wolf at another site is separate news
        state = {"wolf|4": NOW.isoformat()}
        assert cooldown_active(state, "wolf|5", 30, NOW) is False

    def test_garbage_stamp_is_inactive(self):
        assert cooldown_active({"wolf|4": "not-a-date"}, "wolf|4", 30, NOW) is False


class TestNextCooldownState:
    def test_stamps_the_key(self):
        state = next_cooldown_state({}, "wolf|4", NOW, 30)
        assert state == {"wolf|4": NOW.isoformat()}

    def test_prunes_expired_keeps_fresh(self):
        old = {
            "boar|1": (NOW - timedelta(minutes=45)).isoformat(),  # expired
            "deer|2": (NOW - timedelta(minutes=5)).isoformat(),   # fresh
        }
        state = next_cooldown_state(old, "wolf|4", NOW, 30)
        assert "boar|1" not in state
        assert "deer|2" in state
        assert "wolf|4" in state

    def test_garbage_entries_are_dropped(self):
        state = next_cooldown_state({"boar|1": "not-a-date"}, "wolf|4", NOW, 30)
        assert state == {"wolf|4": NOW.isoformat()}

    def test_returns_a_new_dict(self):
        # Reassignment, never mutation, so SQLAlchemy change tracking fires
        old = {"deer|2": NOW.isoformat()}
        state = next_cooldown_state(old, "wolf|4", NOW, 30)
        assert state is not old
        assert "wolf|4" not in old

    def test_none_state_is_tolerated(self):
        assert next_cooldown_state(None, "wolf|4", NOW, 30) == {"wolf|4": NOW.isoformat()}


def _rule(**overrides):
    base = dict(
        id=1, species=["wolf"], site_ids=None, hour_from=None, hour_to=None,
        min_group_size=None, cooldown_minutes=None, rarity_days=None,
        cooldown_state={}, channels=["telegram"], is_active=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _facts(**overrides):
    base = dict(species="wolf", site_id=4, capture_hour=14,
                species_count=1, detection_count=1)
    base.update(overrides)
    return EventFacts(**base)


class TestRuleMatches:
    def test_species_membership(self):
        assert rule_matches(_rule(species=["wolf", "red_fox"]), _facts()) is True
        assert rule_matches(_rule(species=["red_fox"]), _facts()) is False

    def test_site_scope_null_is_all_sites(self):
        assert rule_matches(_rule(site_ids=None), _facts(site_id=None)) is True

    def test_site_scope_list(self):
        assert rule_matches(_rule(site_ids=[4, 5]), _facts(site_id=4)) is True
        assert rule_matches(_rule(site_ids=[5]), _facts(site_id=4)) is False

    def test_siteless_image_never_matches_scoped_rule(self):
        assert rule_matches(_rule(site_ids=[4]), _facts(site_id=None)) is False

    def test_hour_window(self):
        night = _rule(hour_from=21, hour_to=5)
        assert rule_matches(night, _facts(capture_hour=23)) is True
        assert rule_matches(night, _facts(capture_hour=14)) is False

    def test_hour_window_fails_closed_without_capture_time(self):
        assert rule_matches(_rule(hour_from=21, hour_to=5), _facts(capture_hour=None)) is False

    def test_group_size(self):
        rule = _rule(min_group_size=3)
        assert rule_matches(rule, _facts(species_count=3)) is True
        assert rule_matches(rule, _facts(species_count=2)) is False


class TestSpeciesDisplayName:
    def test_underscores_and_capitalisation(self):
        assert species_display_name("wild_boar") == "Wild boar"
        assert species_display_name("wolf") == "Wolf"


# --- Orchestration ---------------------------------------------------------

CAPTURED_AT = datetime(2026, 8, 9, 14, 30, 0)  # naive camera clock


class FakeDb:
    def __init__(self, project):
        self.project = project
        self.committed = False

    def get(self, model, pk):
        return self.project

    def commit(self):
        self.committed = True


def _project(**overrides):
    base = dict(id=1, name="Test project", detection_threshold=0.2,
                classification_thresholds=None)
    base.update(overrides)
    return SimpleNamespace(**base)


def _event(**overrides):
    base = dict(
        event_type="species_detection", project_id=1, image_uuid="img-1",
        species="wolf", confidence=0.9, detection_confidence=0.8,
        detection_count=1, species_count=1,
    )
    base.update(overrides)
    return base


def _wire(monkeypatch, project, rules, delivered=True, image=(10, CAPTURED_AT, 4, "North gate")):
    """Stub every DB and delivery boundary of handle_detection_event and
    return the recorded calls."""
    db = FakeDb(project)
    calls = {"notified": [], "lookbacks": [], "delivered": delivered}

    @contextmanager
    def fake_session():
        yield db

    def fake_notify(email_queue, telegram_queue, db_, rule, user, project_, event, captured_at, site_name):
        calls["notified"].append(rule.id)
        return calls["delivered"]

    def fake_lookback(db_, project_id, species, since, until, exclude_image_id):
        calls["lookbacks"].append((species, since, until, exclude_image_id))
        return calls.get("lookback_result", False)

    monkeypatch.setattr(da, "get_sync_session", fake_session)
    monkeypatch.setattr(da, "RedisQueue", lambda name: SimpleNamespace(name=name))
    monkeypatch.setattr(da, "_load_event_image", lambda db_, uuid: image)
    monkeypatch.setattr(da, "_load_rules", lambda db_, pid: rules)
    monkeypatch.setattr(da, "has_project_access", lambda db_, uid, pid: True)
    monkeypatch.setattr(da, "species_seen_in_lookback", fake_lookback)
    monkeypatch.setattr(da, "_notify_rule", fake_notify)
    return db, calls


def _user(user_id=7):
    return SimpleNamespace(id=user_id, email="user@example.com")


class TestHandleDetectionEvent:
    def test_two_matching_rules_notify_twice(self, monkeypatch):
        rules = [(_rule(id=1), _user()), (_rule(id=2), _user())]
        db, calls = _wire(monkeypatch, _project(), rules)
        da.handle_detection_event(_event())
        assert calls["notified"] == [1, 2]
        assert db.committed is True

    def test_non_matching_rule_is_quiet(self, monkeypatch):
        rules = [(_rule(id=1, species=["red_fox"]), _user())]
        db, calls = _wire(monkeypatch, _project(), rules)
        da.handle_detection_event(_event())
        assert calls["notified"] == []

    def test_below_detection_threshold_stops_early(self, monkeypatch):
        rules = [(_rule(id=1), _user())]
        db, calls = _wire(monkeypatch, _project(detection_threshold=0.9), rules)
        da.handle_detection_event(_event(detection_confidence=0.5))
        assert calls["notified"] == []

    def test_below_per_species_threshold_stops_early(self, monkeypatch):
        project = _project(classification_thresholds={"default": 0.95})
        db, calls = _wire(monkeypatch, project, [(_rule(id=1), _user())])
        da.handle_detection_event(_event(confidence=0.9))
        assert calls["notified"] == []

    def test_cooldown_stamped_only_after_delivery(self, monkeypatch):
        rule = _rule(id=1, cooldown_minutes=30)
        db, calls = _wire(monkeypatch, _project(), [(rule, _user())], delivered=True)
        da.handle_detection_event(_event())
        assert "wolf|4" in rule.cooldown_state

    def test_no_delivery_leaves_cooldown_unstamped(self, monkeypatch):
        # A telegram-only rule without a linked chat queues nothing and
        # must not swallow the next event
        rule = _rule(id=1, cooldown_minutes=30)
        db, calls = _wire(monkeypatch, _project(), [(rule, _user())], delivered=False)
        da.handle_detection_event(_event())
        assert rule.cooldown_state == {}

    def test_active_cooldown_suppresses(self, monkeypatch):
        recent = datetime.now(timezone.utc).isoformat()
        rule = _rule(id=1, cooldown_minutes=30, cooldown_state={"wolf|4": recent})
        db, calls = _wire(monkeypatch, _project(), [(rule, _user())])
        da.handle_detection_event(_event())
        assert calls["notified"] == []

    def test_rarity_suppresses_when_seen(self, monkeypatch):
        rule = _rule(id=1, rarity_days=30)
        db, calls = _wire(monkeypatch, _project(), [(rule, _user())])
        calls["lookback_result"] = True
        da.handle_detection_event(_event())
        assert calls["notified"] == []
        assert len(calls["lookbacks"]) == 1

    def test_rarity_fires_when_absent_and_caches_per_days(self, monkeypatch):
        # Two rules with the same lookback share one query
        rules = [(_rule(id=1, rarity_days=30), _user()), (_rule(id=2, rarity_days=30), _user())]
        db, calls = _wire(monkeypatch, _project(), rules)
        da.handle_detection_event(_event())
        assert calls["notified"] == [1, 2]
        assert len(calls["lookbacks"]) == 1
        species, since, until, exclude_image_id = calls["lookbacks"][0]
        assert species == "wolf"
        assert until == CAPTURED_AT
        assert since == CAPTURED_AT - timedelta(days=30)
        assert exclude_image_id == 10

    def test_rarity_without_lookback_never_queries(self, monkeypatch):
        db, calls = _wire(monkeypatch, _project(), [(_rule(id=1), _user())])
        da.handle_detection_event(_event())
        assert calls["lookbacks"] == []
