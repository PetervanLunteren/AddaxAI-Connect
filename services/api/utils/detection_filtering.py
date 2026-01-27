"""
Detection filtering utilities

Provides helper functions for filtering detections by project confidence threshold.
"""
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
