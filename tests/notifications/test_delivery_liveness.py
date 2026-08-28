"""Tests for the worker liveness check decisions."""
from datetime import datetime, timedelta, timezone

from delivery_liveness import (
    QUEUE_DEPTH_ALERT,
    STALE_AFTER,
    WORKERS,
    Worker,
    heartbeat_stale,
    parse_heartbeat,
    split_incidents,
    worker_problem,
)


NOW = datetime(2026, 8, 10, 12, 0, 0, tzinfo=timezone.utc)

# A delivery worker: deep queue is a fault, so it alerts on depth too.
EMAIL = Worker(
    "notifications-email", "heartbeat:notifications-email", "Email delivery worker",
    "notification-email", QUEUE_DEPTH_ALERT,
)
# A pipeline worker: a deep queue is a normal backlog, heartbeat only.
DETECTION = Worker(
    "detection", "heartbeat:detection", "Detection worker", "image-ingested",
)
# A worker with no queue at all.
INGESTION = Worker("ingestion", "heartbeat:ingestion", "Ingestion worker")


class TestParseHeartbeat:
    def test_valid_iso(self):
        assert parse_heartbeat("2026-08-10T11:59:00+00:00") == datetime(
            2026, 8, 10, 11, 59, 0, tzinfo=timezone.utc
        )

    def test_missing(self):
        assert parse_heartbeat(None) is None
        assert parse_heartbeat("") is None

    def test_garbage(self):
        assert parse_heartbeat("not-a-date") is None

    def test_naive_stamp_is_treated_as_utc(self):
        # A naive stamp must never crash the aware-datetime arithmetic
        # downstream; the watchdog would die silently (found in the bug
        # hunt of 10 Aug 2026)
        parsed = parse_heartbeat("2026-07-01T09:00:00")
        assert parsed == datetime(2026, 7, 1, 9, 0, 0, tzinfo=timezone.utc)
        assert heartbeat_stale(parsed, NOW) is True  # must not raise


class TestHeartbeatStale:
    def test_fresh(self):
        assert heartbeat_stale(NOW - timedelta(minutes=1), NOW) is False

    def test_exactly_threshold_is_not_stale(self):
        # Strict comparison, matching the repo's other threshold checks
        assert heartbeat_stale(NOW - STALE_AFTER, NOW) is False

    def test_past_threshold_is_stale(self):
        assert heartbeat_stale(NOW - STALE_AFTER - timedelta(seconds=1), NOW) is True

    def test_never_seen_is_stale(self):
        assert heartbeat_stale(None, NOW) is True


class TestWorkerProblem:
    def test_healthy_worker_is_none(self):
        assert worker_problem(NOW - timedelta(minutes=1), EMAIL, 3, NOW) is None

    def test_stale_heartbeat(self):
        last_seen = NOW - timedelta(days=27)
        reason = worker_problem(last_seen, EMAIL, 3, NOW)
        assert "no heartbeat since" in reason
        assert "27 days ago" in reason

    def test_stale_today_wording(self):
        reason = worker_problem(NOW - timedelta(minutes=20), EMAIL, 3, NOW)
        assert "today" in reason

    def test_never_seen_wording(self):
        assert worker_problem(None, EMAIL, 0, NOW) == "no heartbeat ever recorded"

    def test_depth_boundary(self):
        # Strict >, the threshold itself does not fire
        fresh = NOW - timedelta(minutes=1)
        assert worker_problem(fresh, EMAIL, QUEUE_DEPTH_ALERT - 1, NOW) is None
        assert worker_problem(fresh, EMAIL, QUEUE_DEPTH_ALERT, NOW) is None
        reason = worker_problem(fresh, EMAIL, QUEUE_DEPTH_ALERT + 1, NOW)
        assert "draining too slowly" in reason

    def test_both_conditions_one_combined_reason(self):
        reason = worker_problem(None, EMAIL, 431, NOW)
        assert "no heartbeat ever recorded" in reason
        assert "depth 431" in reason
        assert "draining too slowly" not in reason  # heartbeat is not fresh
        assert reason.count(";") == 1


class TestPipelineWorkersIgnoreQueueDepth:
    """The reason the depth trigger is per worker. Fifty cameras sending
    fifty images each puts thousands into image-ingested while detection
    works through them exactly as designed. Alerting on that would page
    the admin for a healthy server, every busy morning."""

    def test_huge_backlog_with_a_fresh_heartbeat_is_fine(self):
        fresh = NOW - timedelta(minutes=1)
        assert worker_problem(fresh, DETECTION, 25_000, NOW) is None

    def test_stale_heartbeat_still_fires(self):
        reason = worker_problem(NOW - timedelta(hours=3), DETECTION, 0, NOW)
        assert "no heartbeat since" in reason

    def test_backlog_is_never_the_reason_for_a_pipeline_worker(self):
        reason = worker_problem(None, DETECTION, 25_000, NOW)
        assert reason == "no heartbeat ever recorded"
        assert "depth" not in reason

    def test_worker_without_a_queue_is_judged_on_heartbeat_alone(self):
        assert worker_problem(NOW - timedelta(minutes=1), INGESTION, None, NOW) is None
        assert worker_problem(None, INGESTION, None, NOW) == "no heartbeat ever recorded"


class TestWorkerRegistry:
    def test_names_and_keys_are_unique(self):
        assert len({w.name for w in WORKERS}) == len(WORKERS)
        assert len({w.heartbeat_key for w in WORKERS}) == len(WORKERS)

    def test_every_monitored_worker_is_covered(self):
        assert {w.name for w in WORKERS} == {
            "ingestion",
            "detection",
            "classification",
            "notifications-email",
            "notifications-telegram",
            "notifications-earthranger",
        }

    def test_depth_alert_only_where_a_queue_exists(self):
        for w in WORKERS:
            if w.depth_alert is not None:
                assert w.queue, f"{w.name} alerts on depth but has no queue"

    def test_only_the_delivery_workers_alert_on_depth(self):
        alerting = {w.name for w in WORKERS if w.depth_alert is not None}
        assert alerting == {
            "notifications-email", "notifications-telegram", "notifications-earthranger",
        }


class TestSplitIncidents:
    def test_fresh_incident(self):
        assert split_incidents(["notifications-email"], []) == (
            ["notifications-email"], [], []
        )

    def test_ongoing_is_suppressed(self):
        assert split_incidents(["notifications-email"], ["notifications-email"]) == (
            [], ["notifications-email"], []
        )

    def test_recovery_re_arms(self):
        assert split_incidents([], ["notifications-email"]) == (
            [], [], ["notifications-email"]
        )

    def test_reoffend_after_recovery_fires_again(self):
        new, ongoing, recovered = split_incidents(
            ["notifications-email", "notifications-telegram"], ["notifications-telegram"]
        )
        assert new == ["notifications-email"]
        assert ongoing == ["notifications-telegram"]
        assert recovered == []

    def test_empty_inputs(self):
        assert split_incidents([], []) == ([], [], [])
        assert split_incidents([], None) == ([], [], [])


class _FakeRedisClient:
    def __init__(self, heartbeats=None):
        self.stored = {}
        self.heartbeats = heartbeats or {}

    def get(self, key):
        return self.heartbeats.get(key)

    def set(self, key, value):
        self.stored[key] = value


class TestProbeIsolation:
    def test_one_broken_probe_does_not_block_the_other_workers(self, monkeypatch):
        """A failure probing one worker must never stop the others from
        being checked; the watchdog has to be unkillable by one bad
        value or one flaky read."""
        import delivery_liveness as dl

        fake_client = _FakeRedisClient()  # no heartbeats: all look never-seen
        monkeypatch.setattr(dl.redis, "from_url", lambda url, **kw: fake_client)

        class FakeQueue:
            def __init__(self, queue_name):
                self.queue_name = queue_name

            def queue_depth(self):
                if self.queue_name == "notification-email":
                    raise RuntimeError("boom")
                return 0

        monkeypatch.setattr(dl, "RedisQueue", FakeQueue)

        alerted = []
        monkeypatch.setattr(
            dl, "_send_alerts",
            lambda worker, *args, **kw: alerted.append(worker.name),
        )

        dl.check_delivery_liveness()

        # The email probe blew up, every other worker was still checked
        # and alerted for its missing heartbeat
        assert alerted == [
            "classification", "detection", "ingestion",
            "notifications-earthranger", "notifications-telegram",
        ]
        assert "notifications-email" not in fake_client.stored[dl.STATE_REDIS_KEY]

    def test_a_worker_without_a_queue_is_never_asked_for_a_depth(self, monkeypatch):
        """Ingestion publishes and never consumes. Reading a depth for it
        would mean reporting the detection backlog on the ingestion row,
        which is the confusion this replaced."""
        import delivery_liveness as dl

        monkeypatch.setattr(
            dl.redis, "from_url", lambda url, **kw: _FakeRedisClient()
        )

        asked = []

        class FakeQueue:
            def __init__(self, queue_name):
                self.queue_name = queue_name

            def queue_depth(self):
                asked.append(self.queue_name)
                return 0

        monkeypatch.setattr(dl, "RedisQueue", FakeQueue)
        monkeypatch.setattr(dl, "_send_alerts", lambda *a, **kw: None)

        dl.check_delivery_liveness()

        assert None not in asked
        assert "ingestion" not in asked
        assert set(asked) == {
            "image-ingested", "detection-complete",
            "notification-email", "notification-telegram", "notification-earthranger",
        }


class TestAllWorkersHealthy:
    def test_fresh_heartbeats_raise_nothing(self, monkeypatch):
        """The other direction of the same check: a server where every
        worker is ticking must send no alert at all."""
        import delivery_liveness as dl

        fresh = datetime.now(timezone.utc).isoformat()
        fake_client = _FakeRedisClient(
            {w.heartbeat_key: fresh for w in dl.WORKERS}
        )
        monkeypatch.setattr(dl.redis, "from_url", lambda url, **kw: fake_client)

        class FakeQueue:
            def __init__(self, queue_name):
                self.queue_name = queue_name

            def queue_depth(self):
                return 0

        monkeypatch.setattr(dl, "RedisQueue", FakeQueue)

        alerted = []
        monkeypatch.setattr(
            dl, "_send_alerts",
            lambda worker, *args, **kw: alerted.append(worker.name),
        )

        dl.check_delivery_liveness()

        assert alerted == []
