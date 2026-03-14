"""
Taxonomy walk-up algorithm for SpeciesNet predictions.

Maps raw SpeciesNet labels to human-readable names using a taxonomy mapping table.
Shared between the classification worker (real-time) and API (reprocessing on upload).
"""


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
    No match returns "animal".

    Args:
        raw_prediction: Full SpeciesNet semicolon-delimited label
        taxonomy_map: Dict mapping lowercase latin names to common names

    Returns:
        Mapped common name, or "animal" if no match found
    """
    parts = raw_prediction.split(";")
    if len(parts) < 7:
        return "animal"

    # Parts: uuid;class;order;family;genus;species;common_name
    taxon_class = parts[1].strip().lower()
    order = parts[2].strip().lower()
    family = parts[3].strip().lower()
    genus = parts[4].strip().lower()
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

    return "animal"
