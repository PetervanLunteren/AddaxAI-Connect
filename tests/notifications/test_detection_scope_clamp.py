"""Tests for clamping detection alert rules to a viewer's site scope."""
from types import SimpleNamespace

from detection_alerts import EventFacts, effective_site_scope, rule_matches


def _facts(**overrides):
    base = dict(species="wolf", site_id=4, capture_hour=14,
                species_count=1, detection_count=1)
    base.update(overrides)
    return EventFacts(**base)


def _rule(**overrides):
    base = dict(
        id=1, species=["wolf"], site_ids=None, hour_from=None, hour_to=None,
        min_group_size=None, cooldown_minutes=None, rarity_days=None,
        cooldown_state={}, channels=["telegram"], is_active=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestEffectiveSiteScope:
    def test_admin_keeps_rule_scope(self):
        assert effective_site_scope("project-admin", None, [3]) == [3]
        assert effective_site_scope("project-admin", None, None) is None

    def test_server_admin_without_membership_keeps_rule_scope(self):
        # A superuser creator has no membership row, role arrives as None
        assert effective_site_scope(None, None, [3]) == [3]
        assert effective_site_scope(None, None, None) is None

    def test_unscoped_viewer_keeps_rule_scope(self):
        assert effective_site_scope("project-viewer", None, [3]) == [3]
        assert effective_site_scope("project-viewer", None, None) is None

    def test_scoped_viewer_null_rule_becomes_allow_list(self):
        # A rule watching "all sites" created before the restriction must
        # not keep watching everything
        assert effective_site_scope("project-viewer", [1, 2], None) == [1, 2]

    def test_scoped_viewer_list_rule_is_intersected(self):
        assert effective_site_scope("project-viewer", [1, 2], [2, 3]) == [2]

    def test_disjoint_scopes_give_empty_never_none(self):
        # Empty means the rule can never match, not "no restriction"
        assert effective_site_scope("project-viewer", [1], [9]) == []


class TestRuleMatchesWithClampedScope:
    def test_empty_scope_never_matches(self):
        assert rule_matches(_rule(), _facts(site_id=4), []) is False

    def test_in_scope_site_matches(self):
        assert rule_matches(_rule(), _facts(site_id=4), [4, 5]) is True

    def test_out_of_scope_site_does_not_match(self):
        assert rule_matches(_rule(), _facts(site_id=6), [4, 5]) is False

    def test_siteless_image_fails_scoped_evaluation(self):
        assert rule_matches(_rule(), _facts(site_id=None), [4]) is False

    def test_unrestricted_scope_matches_everything(self):
        assert rule_matches(_rule(), _facts(site_id=None), None) is True
