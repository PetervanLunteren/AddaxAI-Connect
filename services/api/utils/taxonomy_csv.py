"""
A project's SpeciesNet taxonomy mapping CSV: parse it, and store it.

Both the create-project request and the project taxonomy upload go through
here, so a CSV is accepted or refused the same way in both places.
"""
import csv
import io

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import TaxonomyMapping


def parse_taxonomy_csv(text: str) -> list[tuple[str, str]]:
    """(latin, common) rows from the mapping CSV text.

    The CSV needs 'latin' and 'common' columns (any case, extra columns are
    ignored, a leading BOM is fine). Latin is lowercased, the walk-up matches
    lowercase; common is kept as written, it is the label users see.

    Raises:
        ValueError: with a message for the user, on the first problem found.
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
    for i, row in enumerate(reader, start=2):
        normalized = {k.lower().strip(): v for k, v in row.items() if k is not None}
        latin = (normalized.get("latin") or "").strip().lower()
        common = (normalized.get("common") or "").strip()

        if not latin:
            raise ValueError(f"Row {i}: empty 'latin' value")
        if not common:
            raise ValueError(f"Row {i}: empty 'common' value")
        if latin in seen_latin:
            raise ValueError(f"Row {i}: duplicate latin value '{latin}'")

        seen_latin.add(latin)
        rows.append((latin, common))

    if not rows:
        raise ValueError("CSV has no data rows")

    return rows


async def replace_project_taxonomy(
    db: AsyncSession, project_id: int, rows: list[tuple[str, str]]
) -> None:
    """Replace the project's mapping with these rows. Flushes, the caller commits."""
    await db.execute(delete(TaxonomyMapping).where(TaxonomyMapping.project_id == project_id))
    for latin, common in rows:
        db.add(TaxonomyMapping(project_id=project_id, latin=latin, common=common))
    await db.flush()
