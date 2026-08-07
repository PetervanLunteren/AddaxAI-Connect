"""Tests for the time-of-day filter on the images list endpoint."""
import inspect
import os
import sys

# Add API service to path so we can import the router directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


def _filter_sql(hour_from, hour_to):
    """Build the same filter expression list_images builds and compile it."""
    from sqlalchemy import and_, or_, extract
    from sqlalchemy.dialects import postgresql
    from shared.models import Image

    filters = []
    if hour_from is not None or hour_to is not None:
        hour = extract('hour', Image.captured_at)
        if hour_from is not None and hour_to is not None:
            if hour_from < hour_to:
                filters.append(and_(hour >= hour_from, hour < hour_to))
            elif hour_from > hour_to:
                filters.append(or_(hour >= hour_from, hour < hour_to))
        elif hour_from is not None:
            filters.append(hour >= hour_from)
        else:
            filters.append(hour < hour_to)
    return [
        str(f.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        for f in filters
    ]


class TestHourFilterSql:
    def test_plain_range_is_an_and(self):
        [sql] = _filter_sql(6, 10)
        assert ">= 6" in sql and "< 10" in sql
        assert " AND " in sql

    def test_wrapped_range_is_an_or(self):
        # 21:00 to 05:00 is the night window, it must wrap past midnight
        [sql] = _filter_sql(21, 5)
        assert ">= 21" in sql and "< 5" in sql
        assert " OR " in sql

    def test_open_ends(self):
        [sql] = _filter_sql(6, None)
        assert ">= 6" in sql
        [sql] = _filter_sql(None, 10)
        assert "< 10" in sql

    def test_equal_bounds_cover_the_whole_day(self):
        assert _filter_sql(8, 8) == []

    def test_no_bounds_no_filter(self):
        assert _filter_sql(None, None) == []

    def test_extract_targets_captured_at(self):
        [sql] = _filter_sql(6, 10)
        assert "EXTRACT(hour FROM images.captured_at)" in sql


class TestNoTimezoneStrip:
    def test_hour_filter_uses_plain_extract(self):
        """captured_at is naive camera-local. Wrapping it in AT TIME ZONE
        was a fix-on-read hack for the pre-refactor mistagged-UTC storage
        and must not come back (see DEVELOPERS.md and
        test_statistics_hour_extraction.py)."""
        from routers import images as images_router

        src = inspect.getsource(images_router)
        assert "extract('hour', Image.captured_at)" in src
        assert "AT TIME ZONE" not in src

    def test_list_images_source_matches_the_tested_logic(self):
        """The SQL tests above rebuild the filter logic. Assert the real
        endpoint contains the same branches so the copy cannot drift."""
        from routers import images as images_router

        src = inspect.getsource(images_router.list_images)
        assert "and_(hour >= hour_from, hour < hour_to)" in src
        assert "or_(hour >= hour_from, hour < hour_to)" in src
