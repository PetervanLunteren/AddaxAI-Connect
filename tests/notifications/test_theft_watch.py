"""
Unit tests for the theft watch triggers.

The pure helpers (thresholds, warm-up, gaps, nearby count) are tested
directly. The person trigger's orchestration is tested with every DB and
delivery boundary stubbed, same harness convention as the detection
alert tests. The silence trigger's per-camera decision is covered
through _offending_cameras with constructed states.
"""
import ast
import inspect
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from shared.models import Project

import theft_watch as tw
from theft_watch import (
    WatchCamState,
    bbox_area,
    contact_gap_hours,
    in_warmup,
    nearby_silent_count,
    percentile,
    person_outlier,
    person_threshold,
    pick_attachment,
    raw_attachment,
    silence_threshold_hours,
)


# --- Pure helpers ----------------------------------------------------------

class TestPercentile:
    def test_single_value(self):
        assert percentile([0.5], 95) == 0.5

    def test_interpolates(self):
        assert percentile([0.0, 1.0], 50) == 0.5

    def test_extremes(self):
        values = [0.1, 0.2, 0.3, 0.4]
        assert percentile(values, 0) == 0.1
        assert percentile(values, 100) == 0.4

    def test_order_does_not_matter(self):
        assert percentile([0.4, 0.1, 0.3, 0.2], 100) == 0.4


class TestPersonThreshold:
    def test_too_little_history_returns_none(self):
        areas = [0.1] * (tw.MIN_PERSON_SAMPLES - 1)
        assert person_threshold(areas, "medium") is None

    def test_enough_history_returns_value(self):
        areas = [0.1] * tw.MIN_PERSON_SAMPLES
        threshold = person_threshold(areas, "medium")
        assert threshold is not None
        # p95 of identical values is the value, times the medium margin
        assert abs(threshold - 0.1 * 1.5) < 1e-9

    def test_higher_sensitivity_means_lower_threshold(self):
        areas = [v / 100 for v in range(60)]
        low = person_threshold(areas, "low")
        medium = person_threshold(areas, "medium")
        high = person_threshold(areas, "high")
        assert low > medium > high


class TestPersonOutlier:
    def test_any_person_fires_with_thin_history(self):
        # A camera that rarely sees people makes every person notable
        assert person_outlier(0.01, [], "medium") is True

    def test_ordinary_person_is_quiet_with_rich_history(self):
        areas = [0.2] * 100
        assert person_outlier(0.2, areas, "medium") is False

    def test_close_person_fires_with_rich_history(self):
        areas = [0.05] * 100
        assert person_outlier(0.5, areas, "medium") is True

    def test_full_frame_history_self_disables(self):
        # Busy public site: walkers already fill the frame, the learned
        # threshold exceeds the maximum possible box, nothing can fire
        areas = [0.97] * 100
        assert person_outlier(1.0, areas, "medium") is False


class TestSilenceThreshold:
    def test_too_few_gaps_returns_none(self):
        gaps = [1.0] * (tw.MIN_CONTACT_GAPS - 1)
        assert silence_threshold_hours(gaps, "medium") is None

    def test_floor_applies_to_chatty_cameras(self):
        gaps = [0.5] * 50
        assert silence_threshold_hours(gaps, "medium") == 24.0

    def test_margin_over_max_gap(self):
        gaps = [1.0] * 49 + [30.0]
        assert silence_threshold_hours(gaps, "medium") == 60.0

    def test_sensitivity_orders_thresholds(self):
        gaps = [1.0] * 49 + [30.0]
        low = silence_threshold_hours(gaps, "low")
        medium = silence_threshold_hours(gaps, "medium")
        high = silence_threshold_hours(gaps, "high")
        assert low > medium > high


class TestInWarmup:
    TODAY = date(2026, 8, 12)

    def test_no_deployment_is_warmup(self):
        assert in_warmup(None, self.TODAY) is True

    def test_young_deployment_is_warmup(self):
        assert in_warmup(self.TODAY - timedelta(days=tw.WARMUP_DAYS - 1), self.TODAY) is True

    def test_warmup_ends_exactly_at_the_boundary(self):
        assert in_warmup(self.TODAY - timedelta(days=tw.WARMUP_DAYS), self.TODAY) is False


class TestBboxArea:
    def test_normalized_area(self):
        assert bbox_area({"normalized": [0.1, 0.2, 0.5, 0.4]}) == 0.5 * 0.4

    def test_missing_normalized_returns_none(self):
        assert bbox_area({"x_min": 10, "y_min": 10, "width": 50, "height": 50}) is None

    def test_none_bbox_returns_none(self):
        assert bbox_area(None) is None

    def test_malformed_returns_none(self):
        assert bbox_area({"normalized": [0.1, 0.2]}) is None
        assert bbox_area({"normalized": [0.1, 0.2, "x", 0.4]}) is None


class TestContactGaps:
    def test_gaps_in_hours(self):
        t0 = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
        stamps = [t0, t0 + timedelta(hours=2), t0 + timedelta(hours=5)]
        assert contact_gap_hours(stamps) == [2.0, 3.0]

    def test_single_contact_has_no_gaps(self):
        assert contact_gap_hours([datetime(2026, 8, 1, tzinfo=timezone.utc)]) == []


def _state(**overrides):
    base = dict(
        device_id="cam", site_id=1, site_name="Gate", lat=52.0, lon=4.5,
        dep_start=date(2026, 1, 1), battery_percent=90,
        last_contact=datetime(2026, 8, 12, 6, 0, tzinfo=timezone.utc),
        gap_hours=[1.0] * 50, silence_hours=2.0,
    )
    base.update(overrides)
    return WatchCamState(**base)


class TestNearbySilentCount:
    def test_counts_only_within_radius(self):
        # 0.005 degrees latitude is roughly 550 m, 0.02 roughly 2.2 km
        states = {
            1: _state(lat=52.000, lon=4.500),
            2: _state(lat=52.005, lon=4.500),
            3: _state(lat=52.020, lon=4.500),
        }
        assert nearby_silent_count(1, [1, 2, 3], states) == 1

    def test_no_coordinates_returns_none(self):
        states = {1: _state(lat=None, lon=None), 2: _state()}
        assert nearby_silent_count(1, [1, 2], states) is None

    def test_others_without_coordinates_are_skipped(self):
        states = {1: _state(), 2: _state(lat=None, lon=None)}
        assert nearby_silent_count(1, [1, 2], states) == 0


class TestPickAttachment:
    T0 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    T1 = datetime(2026, 8, 2, tzinfo=timezone.utc)

    def test_no_candidates_returns_none(self):
        assert pick_attachment([]) is None

    def test_largest_person_box_wins_over_recency(self):
        candidates = [
            {"thumbnail_path": "a.jpg", "person_area": 0.4, "ingested_at": self.T0},
            {"thumbnail_path": "b.jpg", "person_area": 0.1, "ingested_at": self.T1},
        ]
        assert pick_attachment(candidates) == "a.jpg"

    def test_without_persons_most_recent_wins(self):
        candidates = [
            {"thumbnail_path": "a.jpg", "person_area": 0.0, "ingested_at": self.T0},
            {"thumbnail_path": "b.jpg", "person_area": 0.0, "ingested_at": self.T1},
        ]
        assert pick_attachment(candidates) == "b.jpg"

    def test_none_person_area_treated_as_zero(self):
        candidates = [
            {"thumbnail_path": "a.jpg", "person_area": None, "ingested_at": self.T0},
            {"thumbnail_path": "b.jpg", "person_area": 0.05, "ingested_at": self.T0},
        ]
        assert pick_attachment(candidates) == "b.jpg"


class TestRawAttachment:
    """Telegram attachments leave the server exactly as they are stored. A raw
    thumbnail carries no blur, so it may only go out when the project blurs
    nothing."""

    def _project(self, people: bool, vehicles: bool):
        return Project(name="p", blur_people=people, blur_vehicles=vehicles)

    def test_project_that_blurs_nothing_keeps_its_photo(self):
        assert raw_attachment("a.jpg", self._project(False, False)) == "a.jpg"

    def test_blurring_people_drops_the_photo(self):
        assert raw_attachment("a.jpg", self._project(True, False)) is None

    def test_blurring_vehicles_drops_the_photo(self):
        # A whole frame is either safe to send or it is not, so a project that
        # hides only vehicles also loses the raw photo
        assert raw_attachment("a.jpg", self._project(False, True)) is None

    def test_missing_thumbnail_is_none(self):
        assert raw_attachment(None, self._project(False, False)) is None

    def test_every_telegram_attachment_goes_through_the_helper(self):
        # Whatever is queued here is sent as stored, so no attachment may be
        # built without the blur check. The classifier's annotated image is
        # allowed through directly, that one is written blurred already.
        src = inspect.getsource(tw)
        values = [
            ast.get_source_segment(src, value)
            for node in ast.walk(ast.parse(src))
            if isinstance(node, ast.Dict)
            for key, value in zip(node.keys, node.values)
            if isinstance(key, ast.Constant) and key.value == "annotated_minio_path"
        ]

        assert values, "no telegram attachment found, has the message shape changed"
        for value in values:
            assert "raw_attachment(" in value, value


# --- Silence trigger decision ---------------------------------------------

def _rule(**overrides):
    base = dict(
        id=1, sensitivity="medium", site_ids=None, channels=["email"],
        is_active=True, person_cooldown_state={}, notified_camera_ids=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestOffendingCameras:
    TODAY = date(2026, 8, 12)

    def test_silent_camera_offends(self):
        states = {1: _state(silence_hours=30.0)}
        assert tw._offending_cameras(_rule(), states, None, self.TODAY) == [1]

    def test_quiet_but_normal_camera_does_not(self):
        states = {1: _state(silence_hours=3.0)}
        assert tw._offending_cameras(_rule(), states, None, self.TODAY) == []

    def test_warmup_camera_skipped(self):
        states = {1: _state(silence_hours=100.0, dep_start=self.TODAY - timedelta(days=3))}
        assert tw._offending_cameras(_rule(), states, None, self.TODAY) == []

    def test_never_heard_camera_skipped(self):
        states = {1: _state(silence_hours=0.0, last_contact=None)}
        assert tw._offending_cameras(_rule(), states, None, self.TODAY) == []

    def test_too_little_gap_history_skipped(self):
        states = {1: _state(silence_hours=100.0, gap_hours=[1.0] * 5)}
        assert tw._offending_cameras(_rule(), states, None, self.TODAY) == []

    def test_site_scope_filters(self):
        states = {
            1: _state(silence_hours=30.0, site_id=1),
            2: _state(silence_hours=30.0, site_id=2),
        }
        assert tw._offending_cameras(_rule(), states, [2], self.TODAY) == [2]

    def test_siteless_camera_fails_closed_under_scope(self):
        states = {1: _state(silence_hours=30.0, site_id=None)}
        assert tw._offending_cameras(_rule(), states, [1], self.TODAY) == []


# --- Person trigger orchestration ------------------------------------------

CAPTURED_AT = datetime(2026, 8, 12, 14, 30, 0)  # naive camera clock
OLD_START = date(2026, 1, 1)


class FakeDb:
    """Stubs the direct DB touchpoints of handle_person_event: the
    project load, the current-deployment lookup (consumed via .first()),
    and the thumbnail fallback lookup (via .scalar_one_or_none())."""

    def __init__(self, project, deployment):
        self.project = project
        self.deployment = deployment
        self.committed = False

    def get(self, model, pk):
        return self.project

    def execute(self, query):
        deployment = self.deployment
        return SimpleNamespace(
            first=lambda: deployment,
            scalar_one_or_none=lambda: "thumb.jpg",
        )

    def commit(self):
        self.committed = True


def _project(**overrides):
    base = dict(id=1, name="Test project", detection_threshold=0.2)
    base.update(overrides)
    return SimpleNamespace(**base)


def _event(**overrides):
    base = dict(
        event_type="species_detection", project_id=1, image_uuid="img-1",
        camera_id=3, species="person", confidence=0.8, detection_confidence=0.8,
    )
    base.update(overrides)
    return base


def _user(user_id=7):
    return SimpleNamespace(id=user_id, email="user@example.com", is_superuser=False)


def _row(rule, user=None, role='project-admin', site_ids=None):
    return (rule, user or _user(), role, site_ids)


def _wire(
    monkeypatch, project, rules, delivered=True,
    image=(10, CAPTURED_AT, 4, "North gate"),
    deployment=SimpleNamespace(id=5, start_date=OLD_START),
    area=0.5, history=None,
):
    db = FakeDb(project, deployment)
    calls = {"notified": [], "delivered": delivered}

    @contextmanager
    def fake_session():
        yield db

    def fake_notify(email_queue, telegram_queue, db_, rule, user, project_,
                    event, captured_at, site_id, site_name,
                    area_, threshold, history_n, thumbnail_path=None):
        calls["notified"].append(rule.id)
        return calls["delivered"]

    monkeypatch.setattr(tw, "get_sync_session", fake_session)
    monkeypatch.setattr(tw, "RedisQueue", lambda name: SimpleNamespace(name=name))
    monkeypatch.setattr(tw, "_load_rules", lambda db_, pid: rules)
    monkeypatch.setattr(tw, "_load_event_image", lambda db_, uuid: image)
    monkeypatch.setattr(tw, "_image_person_area", lambda db_, image_id, conf: area)
    monkeypatch.setattr(
        tw, "_person_area_history", lambda db_, dep, ex, cutoff, conf: history or []
    )
    monkeypatch.setattr(tw, "get_server_timezone", lambda db_: timezone.utc)
    monkeypatch.setattr(tw, "_notify_person", fake_notify)
    return db, calls


class TestHandlePersonEvent:
    def test_thin_history_fires_and_stamps_cooldown(self, monkeypatch):
        rule = _rule()
        db, calls = _wire(monkeypatch, _project(), [_row(rule)])
        tw.handle_person_event(_event())
        assert calls["notified"] == [1]
        assert "3" in rule.person_cooldown_state
        assert db.committed is True

    def test_ordinary_person_with_rich_history_is_quiet(self, monkeypatch):
        rule = _rule()
        db, calls = _wire(
            monkeypatch, _project(), [_row(rule)],
            area=0.2, history=[0.2] * 100,
        )
        tw.handle_person_event(_event())
        assert calls["notified"] == []

    def test_close_person_with_rich_history_fires(self, monkeypatch):
        rule = _rule()
        db, calls = _wire(
            monkeypatch, _project(), [_row(rule)],
            area=0.6, history=[0.05] * 100,
        )
        tw.handle_person_event(_event())
        assert calls["notified"] == [1]

    def test_warmup_camera_is_quiet(self, monkeypatch):
        young = SimpleNamespace(id=5, start_date=date.today() - timedelta(days=3))
        db, calls = _wire(monkeypatch, _project(), [_row(_rule())], deployment=young)
        tw.handle_person_event(_event())
        assert calls["notified"] == []

    def test_below_detection_threshold_stops_early(self, monkeypatch):
        db, calls = _wire(monkeypatch, _project(detection_threshold=0.9), [_row(_rule())])
        tw.handle_person_event(_event(detection_confidence=0.5))
        assert calls["notified"] == []

    def test_active_cooldown_suppresses(self, monkeypatch):
        recent = datetime.now(timezone.utc).isoformat()
        rule = _rule(person_cooldown_state={"3": recent})
        db, calls = _wire(monkeypatch, _project(), [_row(rule)])
        tw.handle_person_event(_event())
        assert calls["notified"] == []

    def test_no_delivery_leaves_cooldown_unstamped(self, monkeypatch):
        rule = _rule()
        db, calls = _wire(monkeypatch, _project(), [_row(rule)], delivered=False)
        tw.handle_person_event(_event())
        assert rule.person_cooldown_state == {}

    def test_scoped_rule_ignores_other_site(self, monkeypatch):
        rule = _rule(site_ids=[99])
        db, calls = _wire(monkeypatch, _project(), [_row(rule)])
        tw.handle_person_event(_event())
        assert calls["notified"] == []

    def test_viewer_allow_list_clamps_null_scope(self, monkeypatch):
        # Rule watches all sites, but its creator is a viewer restricted
        # to site 99; the event's site 4 must not reach them
        rule = _rule(site_ids=None)
        row = _row(rule, role='project-viewer', site_ids=[99])
        db, calls = _wire(monkeypatch, _project(), [row])
        tw.handle_person_event(_event())
        assert calls["notified"] == []
