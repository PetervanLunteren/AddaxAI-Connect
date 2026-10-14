"""A project's taxonomy mapping: the CSV parser, the per-project label list,
and the per-project relabel on upload.

The parser is pure. The endpoints need a database, so they are tested with
small stand-ins or on their source, like the other API tests; the full flow
is covered by the dev server checks.
"""
import inspect
import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.taxonomy_csv import parse_taxonomy_csv  # noqa: E402


class TestParseTaxonomyCsv:
    def test_rows_with_lowercased_latin(self):
        text = "latin,common\nVulpes Vulpes,Red fox\ncanidae,unknown canid\n"
        assert parse_taxonomy_csv(text) == [("vulpes vulpes", "Red fox"), ("canidae", "unknown canid")]

    def test_bom_header_case_and_extra_columns(self):
        text = "﻿Latin, COMMON ,original_latin,notes\naves,bird,,x\n"
        assert parse_taxonomy_csv(text) == [("aves", "bird")]

    def test_missing_column(self):
        with pytest.raises(ValueError, match="'latin' and 'common'"):
            parse_taxonomy_csv("latin,name\naves,bird\n")

    def test_empty_file(self):
        with pytest.raises(ValueError, match="empty"):
            parse_taxonomy_csv("")

    def test_no_data_rows(self):
        with pytest.raises(ValueError, match="no data rows"):
            parse_taxonomy_csv("latin,common\n")

    def test_empty_values(self):
        with pytest.raises(ValueError, match="Row 2: empty 'latin'"):
            parse_taxonomy_csv("latin,common\n,bird\n")
        with pytest.raises(ValueError, match="Row 2: empty 'common'"):
            parse_taxonomy_csv("latin,common\naves,\n")

    def test_duplicate_latin(self):
        with pytest.raises(ValueError, match="Row 3: duplicate latin value 'aves'"):
            parse_taxonomy_csv("latin,common\naves,bird\nAves,other bird\n")

    def test_one_label_on_several_rows_is_fine(self):
        text = "latin,common\naccipitridae,bird of prey\nfalconidae,bird of prey\n"
        assert len(parse_taxonomy_csv(text)) == 2


class _Result:
    def __init__(self, value=None, rows=None):
        self._value, self._rows = value, rows or []

    def scalar_one_or_none(self):
        return self._value

    def all(self):
        return self._rows


class _Db:
    """Answers every query with the same result."""
    def __init__(self, result):
        self.result = result

    async def execute(self, _query):
        return self.result


class TestCreateProjectCsvRule:
    """The CSV is required on SpeciesNet and refused elsewhere, before any write."""

    @pytest.fixture
    def create(self, monkeypatch):
        from routers import projects

        def run(model, **fields):
            monkeypatch.setattr(projects.settings, "classification_model", model)
            db = _Db(_Result(SimpleNamespace(timezone="Europe/Amsterdam")))
            data = projects.ProjectCreate(name="Park", country_code="NLD", **fields)
            return projects.create_project(data, db=db, current_user=SimpleNamespace(is_superuser=True))

        return run

    @pytest.mark.asyncio
    async def test_speciesnet_needs_a_csv(self, create):
        with pytest.raises(HTTPException) as exc:
            await create("speciesnet")
        assert exc.value.status_code == 400
        assert "required" in exc.value.detail

    @pytest.mark.asyncio
    async def test_speciesnet_refuses_a_bad_csv(self, create):
        with pytest.raises(HTTPException) as exc:
            await create("speciesnet", taxonomy_csv="latin,name\naves,bird\n")
        assert exc.value.status_code == 400
        assert "'latin' and 'common'" in exc.value.detail

    @pytest.mark.asyncio
    async def test_deepfaune_refuses_a_csv(self, create):
        with pytest.raises(HTTPException) as exc:
            await create("deepfaune", taxonomy_csv="latin,common\naves,bird\n")
        assert exc.value.status_code == 400
        assert "only used on SpeciesNet" in exc.value.detail

    def test_csv_is_written_in_the_same_commit(self):
        from routers import projects

        source = inspect.getsource(projects.create_project)
        assert source.index("replace_project_taxonomy(") < source.index("await db.commit()")
        assert source.count("await db.commit()") == 1


class TestAvailableSpecies:
    @pytest.mark.asyncio
    async def test_speciesnet_lists_the_project_labels_plus_the_fallback(self, monkeypatch):
        from routers import species

        monkeypatch.setattr(species.settings, "classification_model", "speciesnet")
        db = _Db(_Result(rows=[("wolf",), ("bird",)]))
        response = await species.get_available_species(
            project_id=3, accessible_project_ids=[3], db=db, current_user=None,
        )
        assert response.model == "speciesnet"
        assert response.species == ["bird", "unknown animal", "wolf"]

    @pytest.mark.asyncio
    async def test_other_projects_are_refused(self, monkeypatch):
        from routers import species

        with pytest.raises(HTTPException) as exc:
            await species.get_available_species(
                project_id=4, accessible_project_ids=[3], db=None, current_user=None,
            )
        assert exc.value.status_code == 403

    def test_speciesnet_query_is_scoped_to_the_project(self):
        from routers import species

        assert "TaxonomyMapping.project_id == project_id" in inspect.getsource(species.get_available_species)


class TestUploadScope:
    def test_relabel_touches_only_this_project(self):
        from routers import project_taxonomy

        source = inspect.getsource(project_taxonomy.upload_project_taxonomy)
        assert "Camera.project_id == project_id" in source
        assert "Image.is_verified == False" in source

    def test_stale_labels_report_names_only(self):
        from routers import project_taxonomy

        fields = set(project_taxonomy.TaxonomyUploadResponse.model_fields)
        assert fields == {"count", "entries", "reprocessed_count", "stale_labels"}
