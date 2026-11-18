"""
Taxonomy mapping for SpeciesNet predictions.

Each project maps SpeciesNet's labels onto its own short list of labels with a
CSV of (latin, common) rows. The walk-up turns one prediction into one of
those labels; the other helpers derive what the API and the notifications
need from the same rows, so every consumer reads the mapping the same way.
Shared between the classification worker (real-time) and the API
(reprocessing on upload, label lists, exports) and notifications.
"""
from collections import defaultdict
from typing import Iterable

# The one fallback label: no CSV row matched the prediction, or SpeciesNet
# returned nothing. Not "animal", which is MegaDetector's detection category.
UNKNOWN_ANIMAL = "unknown animal"

# Labels that exist in every project whatever its CSV says: the two
# detection-level categories and the fallback.
ALWAYS_PRESENT_LABELS = frozenset({"person", "vehicle", UNKNOWN_ANIMAL})

# Two names for one taxon. SpeciesNet's taxonomy has the even-toed hoofed
# animals under the order "cetartiodactyla" on most lines and "artiodactyla"
# on a few, and newer releases only use "artiodactyla". A CSV row at either
# name must catch all of them, so both are read as the name on the right, in
# the CSV and in the predictions.
TAXON_ALIASES = {"cetartiodactyla": "artiodactyla"}


def normalize_taxon(name: str) -> str:
    """A taxon name as the mapping compares it: stripped, lowercase, and an
    alias replaced by its one name."""
    name = name.strip().lower()
    return TAXON_ALIASES.get(name, name)


def apply_taxonomy_walkup(raw_prediction: str, taxonomy_map: dict[str, str]) -> str:
    """
    Walk up taxonomy tree to find first match in mapping.

    SpeciesNet label format: uuid;class;order;family;genus;species;common_name

    Builds candidates from most specific to least:
      1. "{genus} {species}" (binomial, lowercase)
      2. "{genus}"
      3. "{family}"
      4. "{order}"
      5. "{class}"
    First match in taxonomy_map returns that entry's common value.
    No match returns UNKNOWN_ANIMAL.

    Args:
        raw_prediction: Full SpeciesNet semicolon-delimited label
        taxonomy_map: Dict mapping latin names to common names, the keys
            as normalize_taxon writes them (parse_taxonomy_csv does that)

    Returns:
        Mapped common name, or UNKNOWN_ANIMAL if no match found
    """
    parts = raw_prediction.split(";")
    if len(parts) < 7:
        return UNKNOWN_ANIMAL

    # Parts: uuid;class;order;family;genus;species;common_name
    taxon_class = normalize_taxon(parts[1])
    order = normalize_taxon(parts[2])
    family = normalize_taxon(parts[3])
    genus = normalize_taxon(parts[4])
    species = parts[5].strip().lower()

    # Build candidates from most specific to least specific
    candidates = []
    if genus and species:
        candidates.append(f"{genus} {species}")
    if genus:
        candidates.append(genus)
    if family:
        candidates.append(family)
    if order:
        candidates.append(order)
    if taxon_class:
        candidates.append(taxon_class)

    for candidate in candidates:
        if candidate in taxonomy_map:
            return taxonomy_map[candidate]

    return UNKNOWN_ANIMAL


def scientific_names(rows: Iterable[tuple[str, str]]) -> dict[str, str]:
    """Scientific name per label, from the mapping's (latin, common) rows.

    A label backed by exactly one row gets that row's latin, capitalised the
    way it is written ("Canis lupus", "Canidae"). A label backed by several
    rows (one label for a group of taxa) has no single scientific name and is
    left out, as are labels with no row at all.
    """
    latins_by_label: dict[str, list[str]] = defaultdict(list)
    for latin, common in rows:
        latins_by_label[common].append(latin)
    return {
        common: latins[0][:1].upper() + latins[0][1:]
        for common, latins in latins_by_label.items()
        if len(latins) == 1
    }


def stale_labels(used_labels: Iterable[str], labels: Iterable[str]) -> list[str]:
    """Labels in use (rules, thresholds) that the mapping no longer produces.

    The always-present labels never count as stale. Sorted, for a stable
    message.
    """
    available = set(labels) | ALWAYS_PRESENT_LABELS
    return sorted({label for label in used_labels if label not in available})
