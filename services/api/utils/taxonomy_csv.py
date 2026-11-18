"""
A project's SpeciesNet taxonomy mapping CSV: parse it, and store it.

Both the create-project request and the project taxonomy upload go through
here, so a CSV is accepted or refused the same way in both places.
"""
import csv
import io

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from shared.classification_models import speciesnet_taxa
from shared.models import TaxonomyMapping
from shared.taxonomy import normalize_taxon


MAX_LABEL_LENGTH = 255  # the width of taxonomy_mapping.latin and .common
MAX_UNKNOWN_SHOWN = 20  # unknown names listed in the message, the rest is counted


def parse_taxonomy_csv(text: str) -> list[tuple[str, str]]:
    """(latin, common) rows from the mapping CSV text.

    The CSV needs 'latin' and 'common' columns (any case, extra columns are
    ignored, a leading BOM is fine). Latin is written as normalize_taxon
    writes it, the walk-up matches on that. The label users see is
    'original_common' when the row has one, else 'common', kept as written,
    the same convention as MegaDetector's restrict_to_taxa_list.

    Every latin must be a name SpeciesNet knows. A name it does not know
    would be stored and then never match a prediction, without any error.

    Raises:
        ValueError: with a message for the user. A problem with the file
            itself is reported on the first one found, names SpeciesNet does
            not know are all listed, one per line.
    """
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))

    if not reader.fieldnames:
        raise ValueError("CSV file is empty or has no header row")

    fieldnames_lower = [f.lower().strip() for f in reader.fieldnames]
    if "latin" not in fieldnames_lower or "common" not in fieldnames_lower:
        raise ValueError(
            f"CSV must have 'latin' and 'common' columns. Found: {', '.join(reader.fieldnames)}"
        )

    rows: list[tuple[str, str]] = []
    seen_latin: set[str] = set()
    known = speciesnet_taxa()
    unknown: list[str] = []
    for i, row in enumerate(reader, start=2):
        normalized = {k.lower().strip(): v for k, v in row.items() if k is not None}
        latin = normalize_taxon(normalized.get("latin") or "")
        common = (normalized.get("original_common") or "").strip() or (normalized.get("common") or "").strip()

        if not latin:
            raise ValueError(f"Row {i}: empty 'latin' value")
        if not common:
            raise ValueError(f"Row {i}: empty 'common' value")
        if latin in seen_latin:
            raise ValueError(f"Row {i}: duplicate latin value '{latin}'")
        if len(latin) > MAX_LABEL_LENGTH or len(common) > MAX_LABEL_LENGTH:
            raise ValueError(f"Row {i}: a value is longer than {MAX_LABEL_LENGTH} characters")

        if latin not in known:
            unknown.append(f"Row {i}, '{latin}'")

        seen_latin.add(latin)
        rows.append((latin, common))

    if not rows:
        raise ValueError("CSV has no data rows")
    if unknown:
        shown = unknown[:MAX_UNKNOWN_SHOWN]
        if len(unknown) > len(shown):
            shown.append(f"and {len(unknown) - len(shown)} more")
        raise ValueError("\n".join(["SpeciesNet does not know these names", *shown]))

    return rows


async def replace_project_taxonomy(
    db: AsyncSession, project_id: int, rows: list[tuple[str, str]]
) -> None:
    """Replace the project's mapping with these rows. Flushes, the caller commits."""
    await db.execute(delete(TaxonomyMapping).where(TaxonomyMapping.project_id == project_id))
    for latin, common in rows:
        db.add(TaxonomyMapping(project_id=project_id, latin=latin, common=common))
    await db.flush()
