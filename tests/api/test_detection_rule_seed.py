"""Tests for the detection alert rule seed migration.

The seed is the single most dangerous piece of the feature: if it
mis-reads a notification_channels blob, users silently lose their
real-time alerts on update day. seed_rules is a pure function inside the
migration file, loaded here via importlib (the filename starts with a
digit) with alembic stubbed when it is not installed locally.

The fixtures mirror real prod blob shapes after the 20260706_notify_sites
migration, which every database passes through before this one.
"""
import importlib.util
import os
import sys
import types

# The migration imports `from alembic import op`; only the pure seed
# function is under test, so a stub module satisfies the import when
# alembic is not installed in the test environment
try:
    import alembic  # noqa: F401
except ModuleNotFoundError:
    _stub = types.ModuleType("alembic")
    _stub.op = types.SimpleNamespace()
    sys.modules["alembic"] = _stub

_MIGRATION = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..",
    "services", "api", "alembic", "versions", "20260809_detection_alert_rules.py",
))
_spec = importlib.util.spec_from_file_location("detection_rules_migration", _MIGRATION)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)
seed_rules = _migration.seed_rules


def blob(enabled=True, notify_species=("wolf",), notify_sites="absent", extra=None):
    cfg = {"enabled": enabled, "channels": ["telegram"]}
    if notify_species is not None:
        cfg["notify_species"] = list(notify_species)
    if notify_sites != "absent":
        cfg["notify_sites"] = notify_sites
    channels = {"species_detection": cfg, "email_report": {"enabled": True, "frequency": "weekly"}}
    if extra:
        channels.update(extra)
    return channels


class TestSeededRuleShape:
    def test_typical_row_seeds_one_rule(self):
        rules = seed_rules([(7, 1, blob(notify_species=["wolf", "red_deer"], notify_sites=[3, 4]))])
        assert len(rules) == 1
        rule = rules[0]
        assert rule["created_by_user_id"] == 7
        assert rule["project_id"] == 1
        assert rule["species"] == ["wolf", "red_deer"]
        assert rule["site_ids"] == [3, 4]
        # Strict behaviour preservation: telegram only, no conditions
        assert rule["channels"] == ["telegram"]
        assert rule["hour_from"] is None
        assert rule["hour_to"] is None
        assert rule["min_group_size"] is None
        assert rule["cooldown_minutes"] is None
        assert rule["rarity_days"] is None
        assert rule["is_active"] is True
        assert rule["cooldown_state"] == {}

    def test_multiple_rows_seed_independently(self):
        rules = seed_rules([
            (7, 1, blob()),
            (8, 1, blob(notify_species=["person"])),
            (7, 2, blob()),
        ])
        assert len(rules) == 3

    def test_duplicates_deduped_order_preserved(self):
        rules = seed_rules([(7, 1, blob(
            notify_species=["wolf", "red_deer", "wolf"], notify_sites=[4, 3, 4],
        ))])
        assert rules[0]["species"] == ["wolf", "red_deer"]
        assert rules[0]["site_ids"] == [4, 3]


class TestSiteScope:
    def test_missing_notify_sites_means_all_sites(self):
        # The legacy every-site bypass, rows saved before site scoping
        rules = seed_rules([(7, 1, blob(notify_sites="absent"))])
        assert rules[0]["site_ids"] is None

    def test_null_notify_sites_means_all_sites(self):
        rules = seed_rules([(7, 1, blob(notify_sites=None))])
        assert rules[0]["site_ids"] is None

    def test_empty_notify_sites_seeds_nothing(self):
        # An empty list silences every site today, nothing to preserve
        assert seed_rules([(7, 1, blob(notify_sites=[]))]) == []

    def test_stale_site_ids_carry_over(self):
        # They matched nothing before and match nothing after
        rules = seed_rules([(7, 1, blob(notify_sites=[999]))])
        assert rules[0]["site_ids"] == [999]


class TestSkippedRows:
    def test_disabled_seeds_nothing(self):
        assert seed_rules([(7, 1, blob(enabled=False))]) == []

    def test_missing_enabled_seeds_nothing(self):
        channels = {"species_detection": {"notify_species": ["wolf"]}}
        assert seed_rules([(7, 1, channels)]) == []

    def test_empty_species_seeds_nothing(self):
        assert seed_rules([(7, 1, blob(notify_species=[]))]) == []

    def test_missing_species_seeds_nothing(self):
        assert seed_rules([(7, 1, blob(notify_species=None))]) == []

    def test_no_blob_seeds_nothing(self):
        assert seed_rules([(7, 1, None)]) == []

    def test_blob_without_species_detection_seeds_nothing(self):
        assert seed_rules([(7, 1, {"email_report": {"enabled": True}})]) == []

    def test_degenerate_shapes_seed_nothing(self):
        assert seed_rules([
            (7, 1, "not-a-dict"),
            (8, 1, {"species_detection": "not-a-dict"}),
            (9, 1, {"species_detection": {"enabled": True, "notify_species": "wolf"}}),
        ]) == []
