"""The SpeciesNet taxonomy mapping helpers in shared/taxonomy.py."""
from shared.taxonomy import (
    ALWAYS_PRESENT_LABELS,
    UNKNOWN_ANIMAL,
    apply_taxonomy_walkup,
    scientific_names,
    stale_labels,
)

FOX = "uuid;mammalia;carnivora;canidae;vulpes;vulpes;red fox"
CANID_FAMILY = "uuid;mammalia;carnivora;canidae;;;canidae family"
GREAT_TIT = "uuid;aves;passeriformes;paridae;parus;major;great tit"
BLANK = "uuid;;;;;;blank"


class TestWalkup:
    def test_species_row_wins(self):
        mapping = {"vulpes vulpes": "red fox", "canidae": "unknown canid"}
        assert apply_taxonomy_walkup(FOX, mapping) == "red fox"

    def test_walks_up_to_the_nearest_row(self):
        assert apply_taxonomy_walkup(GREAT_TIT, {"aves": "bird"}) == "bird"
        assert apply_taxonomy_walkup(FOX, {"canidae": "unknown canid"}) == "unknown canid"

    def test_higher_level_prediction_starts_at_its_own_level(self):
        mapping = {"vulpes vulpes": "red fox", "canidae": "unknown canid"}
        assert apply_taxonomy_walkup(CANID_FAMILY, mapping) == "unknown canid"

    def test_no_match_is_the_fallback(self):
        assert apply_taxonomy_walkup(FOX, {"aves": "bird"}) == UNKNOWN_ANIMAL

    def test_label_without_taxonomy_is_the_fallback(self):
        assert apply_taxonomy_walkup(BLANK, {"aves": "bird"}) == UNKNOWN_ANIMAL
        assert apply_taxonomy_walkup("not a label", {"aves": "bird"}) == UNKNOWN_ANIMAL

    def test_fallback_is_not_the_detection_category(self):
        assert UNKNOWN_ANIMAL == "unknown animal"


class TestScientificNames:
    def test_one_row_gives_its_latin_capitalised(self):
        rows = [("canis lupus", "wolf"), ("canidae", "unknown canid")]
        assert scientific_names(rows) == {"wolf": "Canis lupus", "unknown canid": "Canidae"}

    def test_label_with_several_rows_has_none(self):
        rows = [("accipitridae", "bird of prey"), ("falconidae", "bird of prey"), ("canis lupus", "wolf")]
        assert scientific_names(rows) == {"wolf": "Canis lupus"}

    def test_no_rows(self):
        assert scientific_names([]) == {}


class TestStaleLabels:
    def test_labels_no_longer_in_the_list(self):
        used = {"wolf", "other canid", "red fox"}
        assert stale_labels(used, ["wolf", "red fox", "unknown canid"]) == ["other canid"]

    def test_always_present_labels_are_never_stale(self):
        assert stale_labels(ALWAYS_PRESENT_LABELS, ["wolf"]) == []
        assert stale_labels({"person", "vehicle", UNKNOWN_ANIMAL}, []) == []

    def test_sorted_and_unique(self):
        assert stale_labels(["b", "a", "b"], []) == ["a", "b"]
