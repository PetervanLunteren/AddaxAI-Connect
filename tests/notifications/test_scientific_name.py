"""Scientific names and the classifier field per project model."""
import integration_channel as ic
from shared.classification_models import DEEPFAUNE_ID, SPECIESNET_ID


class _Db:
    """Answers every query with the same rows, and counts the queries."""
    def __init__(self, rows):
        self.rows, self.queries = rows, 0

    def execute(self, _query):
        self.queries += 1
        return self

    def all(self):
        return self.rows


class TestScientificName:
    def test_fixed_model_reads_the_catalog_not_the_database(self):
        db = _Db([])
        assert ic.scientific_name(db, 1, "fox", DEEPFAUNE_ID) == "Vulpes vulpes"
        assert ic.scientific_name(db, 1, "equid", DEEPFAUNE_ID) == "Equidae"
        assert ic.scientific_name(db, 1, "not a label", DEEPFAUNE_ID) is None
        assert db.queries == 0

    def test_speciesnet_reads_the_project_mapping(self):
        db = _Db([("canis lupus", "wolf")])
        assert ic.scientific_name(db, 1, "wolf", SPECIESNET_ID) == "Canis lupus"
        assert db.queries == 1

    def test_speciesnet_label_on_several_rows_has_no_name(self):
        db = _Db([("accipitridae", "bird of prey"), ("falconidae", "bird of prey")])
        assert ic.scientific_name(db, 1, "bird of prey", SPECIESNET_ID) is None


class TestClassifierField:
    def test_sensing_clues_payload_names_the_project_model(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(ic, "build_detection_observation", lambda **kw: seen.update(kw) or {})
        ic.build_detection_payload(ic.SENSINGCLUES, {}, DEEPFAUNE_ID)
        assert seen["classifier"] == "DeepFaune v1.4"
        ic.build_detection_payload(ic.SENSINGCLUES, {}, SPECIESNET_ID)
        assert seen["classifier"] == "SpeciesNet v4.0.1"
