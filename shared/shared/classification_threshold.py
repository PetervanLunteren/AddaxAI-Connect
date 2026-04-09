"""
Per-species classification confidence threshold filter.

Lives in `shared/` so both the API and notifications services can use the
same logic for filtering AI classifications by their per-species confidence
threshold.

The Project.classification_thresholds JSON has shape:
    {"default": 0.0, "overrides": {"red_fox": 0.7, ...}}

The effective threshold for a given (project, species) is:
    COALESCE(overrides[species], default, 0.0)

A classification passes the filter when:
    classification.confidence >= effective_threshold

The SQL helpers below assume Classification and Project are already in
the FROM/JOIN graph of the surrounding query.
"""
from typing import Any, Dict, Optional

from sqlalchemy import Float, cast, func

from .models import Classification, Project


def classification_passes_threshold():
    """
    SQLAlchemy boolean expression: True when Classification.confidence is
    at or above the project's effective threshold for that classification's
    species. Use inside a `.where(...)` of any query that already joins
    Classification and Project.
    """
    overrides_value = cast(
        Project.classification_thresholds["overrides"][Classification.species].astext,
        Float,
    )
    default_value = cast(
        Project.classification_thresholds["default"].astext,
        Float,
    )
    effective = func.coalesce(overrides_value, default_value, 0.0)
    return Classification.confidence >= effective


# Raw SQL fragment for use inside text() queries. Assumes the surrounding
# query aliases `classifications` as `cl` and `projects` as `p`.
CLASSIFICATION_THRESHOLD_FILTER_SQL = """
    cl.confidence >= COALESCE(
        (p.classification_thresholds->'overrides'->>cl.species)::float,
        (p.classification_thresholds->>'default')::float,
        0.0
    )
"""


def effective_classification_threshold(
    thresholds: Optional[Dict[str, Any]], species: str,
) -> float:
    """
    Resolve the effective per-species threshold from a project's
    classification_thresholds dict. Mirrors the SQL COALESCE expression
    above for use in Python iteration code paths (e.g. exports).

    Returns 0.0 (no filtering) when the project has no thresholds set.
    """
    if not thresholds:
        return 0.0
    overrides = thresholds.get("overrides") or {}
    if species in overrides:
        return float(overrides[species])
    default = thresholds.get("default")
    return float(default) if default is not None else 0.0
