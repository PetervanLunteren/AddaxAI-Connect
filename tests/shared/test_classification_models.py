"""The classification model catalog and its helpers."""
import pytest

from shared.classification_models import (
    CLASSIFICATION_MODELS,
    DEEPFAUNE_ID,
    FIXED,
    MEMORY_MARGIN_MB,
    SPECIESNET,
    SPECIESNET_ID,
    TAXONOMY_DIR,
    ClassificationModel,
    class_labels,
    fits_in_memory,
    get_model,
    normalise_label,
    taxonomy,
)

# The 38 labels DeepFaune stored before models were picked per project.
# Every existing classification, rule and species filter uses these, so the
# catalog's DeepFaune labels must stay exactly this set.
OLD_DEEPFAUNE_CLASSES = [
    "bison", "badger", "ibex", "beaver", "red_deer", "golden_jackal", "chamois",
    "cat", "goat", "roe_deer", "dog", "raccoon_dog", "fallow_deer", "squirrel",
    "moose", "equid", "genet", "wolverine", "hedgehog", "lagomorph", "wolf",
    "otter", "lynx", "marmot", "micromammal", "mouflon", "sheep", "mustelid",
    "bird", "bear", "porcupine", "nutria", "muskrat", "raccoon", "fox",
    "reindeer", "wild_boar", "cow",
]


class TestCatalog:
    def test_every_entry_is_complete(self):
        for model in CLASSIFICATION_MODELS.values():
            assert model.kind in (FIXED, SPECIESNET), model.id
            assert len(model.revision) == 40, model.id
            assert model.weights_mb > 0, model.id
            assert model.weights_file and model.name and model.developer, model.id
            assert model.licence_url.startswith("https://"), model.id
            assert model.region in ("global", "europe", "africa", "americas", "asia", "oceania"), model.id

    def test_every_fixed_model_has_its_taxonomy_csv(self):
        for model in CLASSIFICATION_MODELS.values():
            if model.kind == FIXED:
                assert (TAXONOMY_DIR / f"{model.id}.csv").exists(), model.id
                assert class_labels(model.id), model.id

    def test_hf_repo(self):
        assert get_model(DEEPFAUNE_ID).hf_repo == "Addax-Data-Science/EUR-DF-v1-4"

    def test_unknown_id(self):
        with pytest.raises(KeyError):
            get_model("nope")


class TestLabels:
    def test_normalise(self):
        assert normalise_label("Red deer") == "red_deer"
        assert normalise_label(" wild boar ") == "wild_boar"
        assert normalise_label("black-headed goanna sp") == "black-headed_goanna_sp"

    def test_deepfaune_labels_are_the_old_ones(self):
        assert class_labels(DEEPFAUNE_ID) == sorted(OLD_DEEPFAUNE_CLASSES)

    def test_labels_are_unique_per_model(self):
        for model in CLASSIFICATION_MODELS.values():
            labels = class_labels(model.id)
            assert len(labels) == len(set(labels)), model.id

    def test_speciesnet_has_no_fixed_labels(self):
        assert class_labels(SPECIESNET_ID) == []
        assert taxonomy(SPECIESNET_ID) == {}


class TestTaxonomy:
    def test_species_genus_and_class_rows(self):
        deepfaune = taxonomy(DEEPFAUNE_ID)
        assert deepfaune["fox"] == {"scientific_name": "Vulpes vulpes", "taxon_rank": "species"}
        assert deepfaune["dog"] == {"scientific_name": "Canis lupus familiaris", "taxon_rank": "species"}
        assert deepfaune["equid"] == {"scientific_name": "Equidae", "taxon_rank": "family"}
        assert deepfaune["lagomorph"] == {"scientific_name": "Lagomorpha", "taxon_rank": "order"}
        assert deepfaune["bird"] == {"scientific_name": "Aves", "taxon_rank": "class"}

    def test_row_without_taxonomy(self):
        # "empty" and "vehicle" rows have every taxon column blank
        assert taxonomy("SWUSA-SDZWA-v3")["vehicle"] == {"scientific_name": None, "taxon_rank": None}


class TestFitsInMemory:
    model = ClassificationModel(
        "X", "X", "", "", "europe", "", "https://x", "https://x", FIXED, "0" * 40, 1000, "x.pt",
    )

    def test_loaded_always_fits(self):
        assert fits_in_memory(self.model, 0, ["X"])

    def test_needs_twice_the_weights_plus_the_margin(self):
        assert fits_in_memory(self.model, 2000 + MEMORY_MARGIN_MB, [])
        assert not fits_in_memory(self.model, 2000 + MEMORY_MARGIN_MB - 1, [])

    def test_other_loaded_models_do_not_help(self):
        assert not fits_in_memory(self.model, 100, ["Y"])
