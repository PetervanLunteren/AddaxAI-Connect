"""
The one rule for "where a camera stands now", for every reader.

The current deployment of a camera is the one that started last. Periods of
one camera never overlap, so that is the open one when there is one. When it
has ended (a retired camera, a closed fixed period) it is still the last
known place. Its site is the camera's current site; a deployment without a
site means no current site, never an older one. deployment_number is no
order: it is given once and never reshuffled, so it does not follow time.

Given twice, for the two kinds of callers, and a database test pins that both
say the same (tests/db_api/test_current_site.py):

- CURRENT_DEPLOYMENTS_SQL for queries written as text, sync or async:
  `JOIN (CURRENT_DEPLOYMENTS_SQL) cur ON cur.camera_id = c.id`.
- current_deployments() for queries built with SQLAlchemy.
"""
from sqlalchemy import Date, Select, select
from sqlalchemy.sql.elements import ColumnElement

from .models import Deployment

# Columns: camera_id, deployment_id, site_id, start_at, start_date.
CURRENT_DEPLOYMENTS_SQL = """
    SELECT DISTINCT ON (d.camera_id)
           d.camera_id, d.id AS deployment_id, d.site_id, d.start_at, d.start_date
    FROM deployments d
    ORDER BY d.camera_id, d.start_at DESC, d.id DESC
"""


def current_deployments(on_date: ColumnElement[Date] | None = None):
    """The current deployment per camera as a subquery with the columns of
    CURRENT_DEPLOYMENTS_SQL. With on_date, where the camera stood on that
    day: the deployment that started last on or before it. A maintenance
    visit uses this, and it ignores the end on purpose: a camera is serviced
    at the place it was put, also after its last photo."""
    query: Select = (
        select(
            Deployment.camera_id,
            Deployment.id.label("deployment_id"),
            Deployment.site_id,
            Deployment.start_at,
            Deployment.start_date,
        )
        .distinct(Deployment.camera_id)
        .order_by(Deployment.camera_id, Deployment.start_at.desc(), Deployment.id.desc())
    )
    if on_date is not None:
        query = query.where(Deployment.start_date <= on_date)
    return query.subquery()


def site_on(camera_id_col: ColumnElement, on_date_col: ColumnElement | None = None):
    """Correlated scalar subquery: the site of a camera now, or on a day.
    NULL before its first deployment or when that deployment has no site, so
    a scope filter on the result fails closed."""
    query = select(Deployment.site_id).where(Deployment.camera_id == camera_id_col)
    if on_date_col is not None:
        query = query.where(Deployment.start_date <= on_date_col)
    return (
        query.order_by(Deployment.start_at.desc(), Deployment.id.desc())
        .limit(1)
        .correlate_except(Deployment)
        .scalar_subquery()
    )

