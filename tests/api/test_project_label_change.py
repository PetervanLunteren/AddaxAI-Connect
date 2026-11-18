"""Narrowing the species list of a fixed-class project (update_project).

It is a label change like a SpeciesNet CSV upload, so it goes through the
same confirm step and cleanup (utils/label_changes.py, tested in
test_label_changes). These tests pin when update_project calls them, with
recording stand-ins.
"""
import inspect
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.classification_models import DEEPFAUNE_ID, SPECIESNET_ID  # noqa: E402


def _project(model=DEEPFAUNE_ID, **fields):
    values = dict(
        id=2, name="Park", description=None, included_species=["wolf", "fox", "badger"],
        detection_threshold=0.5, classification_thresholds=None, blur_people=False,
        blur_vehicles=False, delete_people=False, delete_vehicles=False,
        independence_interval_minutes=30, require_two_factor=False, classification_model=model,
        image_path=None, thumbnail_path=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc), updated_at=None,
    )
    values.update(fields)
    return SimpleNamespace(**values)


class _Db:
    def __init__(self, project):
        self.project = project
        self.commits = 0

    async def execute(self, query):
        return SimpleNamespace(scalar_one_or_none=lambda: self.project)

    async def commit(self):
        self.commits += 1

    async def refresh(self, row):
        pass


@pytest.fixture
def update(monkeypatch):
    """update_project with recording stand-ins for the label change calls."""
    from routers import projects

    calls = {"confirm": [], "clean": [], "emails": []}

    async def can_admin_project(user, project_id, db):
        return True

    async def confirm_or_refuse(db, project, labels, user, confirmed):
        calls["confirm"].append((list(labels), confirmed))

    async def clean_gone_labels(db, project, labels, user, apply):
        calls["clean"].append((list(labels), apply))
        return None, ["recipient"]

    async def send_label_change_emails(project_id, project_name, recipients):
        calls["emails"].append(recipients)

    async def project_labels(db, project):
        return ["wolf", "fox", "badger"]

    for name, stand_in in (
        ("can_admin_project", can_admin_project), ("confirm_or_refuse", confirm_or_refuse),
        ("clean_gone_labels", clean_gone_labels), ("send_label_change_emails", send_label_change_emails),
        ("project_labels", project_labels),
    ):
        monkeypatch.setattr(projects, name, stand_in)

    async def run(project, **body):
        db = _Db(project)
        await projects.update_project(
            project.id, projects.ProjectUpdate(**body), db=db, current_user=SimpleNamespace(id=1),
        )
        return calls, db

    return run


class TestSpeciesList:
    @pytest.mark.asyncio
    async def test_a_new_list_goes_through_the_confirm_step_and_the_cleanup(self, update):
        project = _project()
        calls, db = await update(project, included_species=["wolf", "fox"])
        assert calls["confirm"] == [(["wolf", "fox"], False)]
        assert calls["clean"] == [(["wolf", "fox"], True)]
        assert calls["emails"] == [["recipient"]]
        assert project.included_species == ["wolf", "fox"]
        assert db.commits == 1

    @pytest.mark.asyncio
    async def test_the_confirm_flag_reaches_the_check(self, update):
        calls, _ = await update(_project(), included_species=["wolf"], confirm_label_changes=True)
        assert calls["confirm"] == [(["wolf"], True)]

    @pytest.mark.asyncio
    async def test_an_empty_list_means_every_class_of_the_model(self, update):
        calls, _ = await update(_project(), included_species=[])
        labels, _ = calls["confirm"][0]
        assert "red_deer" in labels and len(labels) == 38

    @pytest.mark.asyncio
    async def test_a_speciesnet_project_ignores_the_list(self, update):
        # Its labels come from its CSV, the upload endpoint handles those.
        calls, _ = await update(_project(model=SPECIESNET_ID), included_species=["wolf"])
        assert calls["confirm"] == [] and calls["clean"] == []

    @pytest.mark.asyncio
    async def test_other_updates_do_not_touch_rules(self, update):
        calls, _ = await update(_project(), name="New name")
        assert calls["confirm"] == [] and calls["clean"] == []
        assert calls["emails"] == [[]]

    def test_the_check_comes_before_any_field_is_written(self):
        from routers import projects

        source = inspect.getsource(projects.update_project)
        assert source.index("await confirm_or_refuse(") < source.index("project.name = project_data.name")
        cleanup = source.index("clean_gone_labels(db, project, new_labels, current_user, apply=True)")
        commit = source.index("await db.commit()")
        assert cleanup < commit < source.index("await send_label_change_emails(")


class TestThresholds:
    @pytest.mark.asyncio
    async def test_a_threshold_on_a_label_the_project_lacks_is_dropped(self, update):
        project = _project()
        await update(project, classification_thresholds={
            "default": 0.5, "overrides": {"wolf": 0.4, "porcupine": 0.7, "person": 0.6},
        })
        assert project.classification_thresholds == {
            "default": 0.5, "overrides": {"wolf": 0.4, "person": 0.6},
        }

    @pytest.mark.asyncio
    async def test_thresholds_follow_a_species_list_in_the_same_request(self, update):
        project = _project()
        await update(
            project, included_species=["wolf"], confirm_label_changes=True,
            classification_thresholds={"default": 0.5, "overrides": {"wolf": 0.4, "fox": 0.7}},
        )
        assert project.classification_thresholds["overrides"] == {"wolf": 0.4}
