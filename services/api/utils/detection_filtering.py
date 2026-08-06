"""
Detection filtering utilities

Provides helper functions for filtering detections by project confidence threshold.
"""
from typing import Optional

from sqlalchemy import and_
from shared.models import Detection, Image, Camera, Project


def apply_detection_threshold_filter(query, project_threshold_expr=None):
    """
    Apply detection confidence threshold filter to a query.

    This function filters detections based on the project's detection_threshold setting.
    Only detections with confidence >= detection_threshold will be included in results.

    Args:
        query: SQLAlchemy query object
        project_threshold_expr: Optional explicit Project.detection_threshold expression
                               If None, assumes query already joins with Project

    Returns:
        Modified query with threshold filter applied

    Example:
        query = select(Detection).join(Image).join(Camera).join(Project)
        filtered_query = apply_detection_threshold_filter(query)
    """
    if project_threshold_expr is not None:
        return query.where(Detection.confidence >= project_threshold_expr)
    else:
        # Assume Project is already in the query joins
        return query.where(Detection.confidence >= Project.detection_threshold)


def strongest_hidden_detection(detections, detection_threshold: float) -> Optional[dict]:
    """
    The strongest detection on an image that shows as empty.

    Only call this for images with no visible detections. It returns the
    highest-confidence detection so the image detail view can show how close
    an "empty" image came to the project's thresholds. Returns None when the
    image has no detection rows at all (nothing was found above the storage
    floor at inference time).

    hidden_by says which threshold hid the detection:
    - 'detection_threshold' when its confidence is under the project threshold
    - 'classification_threshold' when the detection itself passed but its
      species prediction stayed under the per-species threshold

    Args:
        detections: The image's Detection ORM rows (with classifications loaded)
        detection_threshold: The project's detection threshold

    Returns:
        Dict with category, confidence, species, species_confidence, hidden_by,
        or None when there are no detections.
    """
    if not detections:
        return None

    top = max(detections, key=lambda d: d.confidence)
    cls = top.classifications[0] if top.classifications else None
    return {
        "category": top.category,
        "confidence": top.confidence,
        "species": cls.species if cls else None,
        "species_confidence": cls.confidence if cls else None,
        "hidden_by": (
            "detection_threshold"
            if top.confidence < detection_threshold
            else "classification_threshold"
        ),
    }


def get_threshold_filter_condition():
    """
    Get SQLAlchemy condition for filtering detections by project threshold.

    This returns a reusable condition that can be combined with other filters.

    Returns:
        SQLAlchemy BinaryExpression for threshold filtering

    Example:
        filters = [
            Detection.category == 'animal',
            get_threshold_filter_condition()
        ]
        query = select(Detection).where(and_(*filters))
    """
    return Detection.confidence >= Project.detection_threshold
