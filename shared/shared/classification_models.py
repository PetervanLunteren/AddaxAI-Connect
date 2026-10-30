"""
The classification models a project can pick, and what Connect knows about
each without loading it.

The single source of truth for the classification worker (what to download
and how to run it), the API (the create dialog, label lists, exports, the
About page) and the notifications (scientific names, the classifier field).

Every model lives in the Addax-Data-Science HuggingFace org and is pinned to
a commit, so a push to a model repo never changes Connect's results without a
code change here. There are two kinds:

- "fixed": a model with a fixed class list, run through the model's own
  inference.py, the same contract AddaxAI desktop uses. Its taxonomy.csv is
  vendored in model_taxonomy/<id>.csv from the same commit, so the labels
  and scientific names are known without the weights. To update a model,
  change the revision and replace the CSV from that revision:
  curl -L https://huggingface.co/Addax-Data-Science/<id>/resolve/<revision>/taxonomy.csv
- "speciesnet": SpeciesNet through Google's speciesnet package, with the
  geofence and the project's own label CSV (see shared.taxonomy).

Class names are stored as labels in lowercase with underscores ("red deer"
becomes "red_deer"), one rule for every fixed model, which keeps the labels
DeepFaune stored before models were picked per project.
"""
import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

FIXED = "fixed"
SPECIESNET = "speciesnet"

TAXONOMY_DIR = Path(__file__).parent / "model_taxonomy"

# Free memory kept back for the rest of the server when a new model loads.
MEMORY_MARGIN_MB = 1024


@dataclass(frozen=True)
class ClassificationModel:
    id: str            # the HuggingFace repo name, also stored on the project
    name: str
    description: str   # one short line for the create dialog
    developer: str
    region: str        # europe, africa, americas, asia, oceania or global
    emoji: str
    licence_url: str
    info_url: str
    kind: str          # FIXED or SPECIESNET
    revision: str      # pinned commit of the HuggingFace repo
    weights_mb: int    # weight files on disk, the basis of the memory check
    weights_file: str  # the file inference.py loads; the backbone for SpeciesNet

    @property
    def hf_repo(self) -> str:
        return f"Addax-Data-Science/{self.id}"


SPECIESNET_ID = "SPECIESNET-v4-0-1-A-v1"
DEEPFAUNE_ID = "EUR-DF-v1-4"

_MODELS = [
    ClassificationModel(
        SPECIESNET_ID, "SpeciesNet v4.0.1", "Global, 2,000+ classes, labels from your own list",
        "Google", "global", "🌏",
        "https://github.com/google/cameratrapai/blob/main/LICENSE",
        "https://github.com/google/cameratrapai",
        SPECIESNET, "db268f48de597aa6d4d528e7e59620ab078ee65f", 224,
        "always_crop_99710272_22x8_v12_epoch_00148.pt",
    ),
    ClassificationModel(
        DEEPFAUNE_ID, "DeepFaune v1.4", "European wildlife, 38 classes",
        "The DeepFaune initiative", "europe", "🇪🇺",
        "https://creativecommons.org/licenses/by-sa/4.0/",
        "https://www.deepfaune.cnrs.fr/en/",
        FIXED, "6ee6f4979d044b07b8244d9a50bd4175cfa4575a", 1218,
        "deepfaune-vit_large_patch14_dinov2.lvd142m.v4.pt",
    ),
    ClassificationModel(
        "EUR-DF-v1-5", "DeepFaune v1.5", "European wildlife, 40 classes, adds mongoose and arctic fox",
        "The DeepFaune initiative", "europe", "🇪🇺",
        "https://creativecommons.org/licenses/by-sa/4.0/",
        "https://www.deepfaune.cnrs.fr/en/",
        FIXED, "b611e13c54858f6e54655644c03e14d797ce4bf1", 1213,
        "deepfaune-vit_large_patch16_dinov3.lvd1689m.pt",
    ),
    ClassificationModel(
        "SAH-DRY-ADS-v1", "Sub-Saharan Drylands", "East and Southern African savannas, 326 classes",
        "Addax Data Science", "africa", "🌵",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://addaxdatascience.com/",
        FIXED, "5463803150e233fce967f0f4a6561b04e7261e44", 215,
        "sub_saharan_drylands_v1.pt",
    ),
    ClassificationModel(
        "AFR-DFV-v2", "DeepForestVision v2", "African tropical forests, 61 classes",
        "Hugo Magaldi, One Forest Vision initiative", "africa", "🌳",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://www.oneforestvision.org",
        FIXED, "d9bb75c49f716ba3ba1fba9cf5661c7ef45ba9bd", 343,
        "DeepForestVisionV2.pth",
    ),
    ClassificationModel(
        "WUSA-SDZWA-v1", "Western USA", "Western United States, 51 classes",
        "San Diego Zoo Wildlife Alliance", "americas", "🇺🇸",
        "https://opensource.org/license/mit",
        "https://github.com/conservationtechlab",
        FIXED, "6f28f67c679eaf3b8fbcb924f6a1ba4290bb2540", 213,
        "sdzwa_westernus_v1_efficientnet.pt",
    ),
    ClassificationModel(
        "SWUSA-SDZWA-v3", "Southwest USA", "Southwestern United States, 27 classes",
        "San Diego Zoo Wildlife Alliance", "americas", "🇺🇸",
        "https://opensource.org/license/mit",
        "https://github.com/conservationtechlab",
        FIXED, "cdf3149ec6c73608e42fee2cb244e946d8db7d4b", 431,
        "southwest_v3.pt",
    ),
    ClassificationModel(
        "SBUSA-ADS-v1", "US Southwest borderlands", "Arizona and the Mexican border, 69 classes",
        "Addax Data Science", "americas", "🇺🇸",
        "https://www.apache.org/licenses/LICENSE-2.0",
        "https://www.tonation-nsn.gov/natural-resources/wildlife-and-vegetation/",
        FIXED, "b610f80bf9a936848bfd8f8b311be953bc0fbecf", 449,
        "final-20260109.pt",
    ),
    ClassificationModel(
        "HWI-ADS-v1", "Hawaiʻi", "Hawaiian islands, 15 classes",
        "Addax Data Science", "americas", "🇺🇸",
        "https://creativecommons.org/licenses/by-nc/4.0/deed.en",
        "https://huggingface.co/Addax-Data-Science/HWI-ADS-v1",
        FIXED, "427157560b4c51e012fa6f51e3a43b032c091452", 448,
        "final-20260317.pt",
    ),
    ClassificationModel(
        "ARC-ADS-v1", "Subarctic and low Arctic", "Northern Canada, 39 classes",
        "Addax Data Science", "americas", "🇨🇦",
        "https://creativecommons.org/licenses/by-nc/4.0/",
        "https://www.churchillfoxproject.org",
        FIXED, "76df3c038dce672c1836af2e1ddc48a3bd865570", 449,
        "final-20260909.pt",
    ),
    ClassificationModel(
        "PAN-SDZWA-v1", "Peruvian Andes", "Andean highlands, 53 classes",
        "San Diego Zoo Wildlife Alliance", "americas", "🇵🇪",
        "https://opensource.org/license/mit",
        "https://github.com/conservationtechlab",
        FIXED, "5932f99a689ed55031b18b94e311aab0019ef9f0", 431,
        "andes_v1.pt",
    ),
    ClassificationModel(
        "IND-ADS-v1", "Central India", "Central Indian forests, 40 classes",
        "Addax Data Science", "asia", "🇮🇳",
        "https://creativecommons.org/licenses/by-nc/4.0/deed.en",
        "https://www.wildlifeconservationtrust.org",
        FIXED, "60cc9940f3b52de5a8f0bc5d722a60e786abf452", 449,
        "final-20260521.pt",
    ),
    ClassificationModel(
        "KIR-HEX-v1", "Kyrgyzstan", "Central Asian mountains, 11 classes",
        "Hex Data", "asia", "🇰🇬",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://www.osi-panthera.org/",
        FIXED, "5fb5da06583ac07dc23ee91a7882fee880f9f619", 472,
        "best_model_Fri_Sep__1_18_50_55_2023.pt",
    ),
    ClassificationModel(
        "GIF-JAP-v0-2", "Gifu region", "Central Japan, 13 classes, a prototype biased to deer",
        "Gifu University", "asia", "🇯🇵",
        "https://github.com/gifu-wildlife/MDetToolsForJCameraTraps?tab=MIT-1-ov-file",
        "https://github.com/gifu-wildlife/TrainingMdetClassifire",
        FIXED, "5da915dfe451e39730b6807403802a8169c45bd4", 385,
        "gifu-wildlife_cls_resnet50_v0.2.1.pth",
    ),
    ClassificationModel(
        "AWC135-AWC-v1", "Australia", "All of Australia, 135 classes",
        "Australian Wildlife Conservancy", "oceania", "🇦🇺",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://github.com/Australian-Wildlife-Conservancy-AWC/awc-wildlife-classifier",
        FIXED, "a1cf611bac585569fb6f6717cd1a0e955267be41", 115,
        "awc-135-v1.pth",
    ),
    ClassificationModel(
        "VIC-ADS-v1", "Victoria", "Victoria in Australia, 217 classes",
        "Addax Data Science for Parks Victoria", "oceania", "🇦🇺",
        "https://huggingface.co/Addax-Data-Science/VIC-ADS-v1/blob/main/LICENSE.txt",
        "https://www.parks.vic.gov.au/get-into-nature/conservation-and-science/science-and-research",
        FIXED, "17a81670b921a7cd5c2d893fc991a01b89c560c0", 450,
        "final-20251221.pt",
    ),
    ClassificationModel(
        "ANT-ADS-v1", "Top End savanna", "Northern Australia, 141 classes",
        "Addax Data Science", "oceania", "🇦🇺",
        "https://creativecommons.org/licenses/by-nc/4.0/deed.en",
        "https://www.cdu.edu.au/riel",
        FIXED, "8f97b666424839e6db094dc480d0d1f6aae92bfc", 450,
        "final-20260417.pt",
    ),
    ClassificationModel(
        "QLD-WOB-v1", "Queensland Wet Tropics", "Wet Tropics rainforest, 15 classes",
        "Prakash Palanivelu Rajmohan and Renuka Sharma", "oceania", "🇦🇺",
        "https://creativecommons.org/licenses/by/4.0/",
        "https://wildobs.org.au/",
        FIXED, "bef3d834f70b80b4762d4409fafa9f3876234ae8", 212,
        "wildobs_QLD_WetTropics.pt",
    ),
    ClassificationModel(
        "NZI-ADS-v2", "New Zealand invasives", "New Zealand invasive species, 24 classes",
        "Addax Data Science", "oceania", "🇳🇿",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://www.doc.govt.nz/",
        FIXED, "5bc26fb9354702b76bec668718ad36cf24c5a4b0", 449,
        "final-20260606.pt",
    ),
]

CLASSIFICATION_MODELS: dict[str, ClassificationModel] = {m.id: m for m in _MODELS}

# Rank names in the taxonomy.csv column order, most specific last.
_RANKS = ("class", "order", "family", "genus", "species")


def get_model(model_id: str) -> ClassificationModel:
    """The catalog entry. KeyError for an id that is not in the catalog."""
    return CLASSIFICATION_MODELS[model_id]


def normalise_label(name: str) -> str:
    """A class name as Connect stores it: lowercase, spaces to underscores."""
    return name.strip().lower().replace(" ", "_")


@lru_cache(maxsize=None)
def _taxonomy_rows(model_id: str) -> tuple[dict, ...]:
    with open(TAXONOMY_DIR / f"{model_id}.csv", newline="", encoding="utf-8") as f:
        return tuple(csv.DictReader(f))


def class_labels(model_id: str) -> list[str]:
    """The labels a fixed model can produce, sorted. Empty for SpeciesNet,
    whose labels come from each project's own CSV."""
    if get_model(model_id).kind != FIXED:
        return []
    return sorted(normalise_label(row["model_class"]) for row in _taxonomy_rows(model_id))


def _scientific(row: dict) -> tuple[Optional[str], Optional[str]]:
    """Scientific name and rank of one taxonomy.csv row: the binomial when
    genus and species are both filled, else the lowest filled rank,
    capitalised. (None, None) for a row with no taxonomy (empty, vehicle)."""
    genus = (row.get("genus") or "").strip()
    species = (row.get("species") or "").strip()
    if genus and species:
        return f"{genus.capitalize()} {species.lower()}", "species"
    for rank in reversed(_RANKS[:4]):
        value = (row.get(rank) or "").strip()
        if value:
            return value.capitalize(), rank
    return None, None


def taxonomy(model_id: str) -> dict[str, dict]:
    """Scientific name and rank per label of a fixed model, as
    {label: {"scientific_name", "taxon_rank"}}. Empty for SpeciesNet."""
    if get_model(model_id).kind != FIXED:
        return {}
    result = {}
    for row in _taxonomy_rows(model_id):
        name, rank = _scientific(row)
        result[normalise_label(row["model_class"])] = {"scientific_name": name, "taxon_rank": rank}
    return result


def fits_in_memory(model: ClassificationModel, available_mb: int, loaded: Iterable[str]) -> bool:
    """Whether the classification worker can load this model without
    running the server out of memory.

    A loaded model always fits. A new one needs twice its weights in free
    memory, which covers the peak while loading (DeepFaune's 1.2 GB file
    peaked at 3.2 GB total worker memory, 2.1 GB once settled), plus a
    margin for the rest of the server.
    """
    if model.id in loaded:
        return True
    return 2 * model.weights_mb <= available_mb - MEMORY_MARGIN_MB
