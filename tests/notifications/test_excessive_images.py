"""
Tests for the excessive image alert.

The module had no tests at all. The point of the alert is that these cameras
cap how many pictures they transmit per day in hardware, so a camera landing
on its cap has gone quiet for the rest of the day. On the Drenthe project 9
camera-days landed on exactly 50 images and 5 on exactly 25, with the last
picture as early as 14:11. The email now carries the window and the silence
after it, and these tests keep both from drifting.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

from shared.email_renderer import render_email

from excessive_images import (
    MIN_QUIET_TAIL,
    _generate_text_content,
    _get_cameras_over_threshold,
    format_quiet_tail,
)

MIDNIGHT = datetime(2026, 8, 14, 0, 0)  # end of 13 Aug


def at(hour: int, minute: int = 0) -> datetime:
    """A camera-clock reading on 13 Aug 2026."""
    return datetime(2026, 8, 13, hour, minute)


class TestFormatQuietTail:
    def test_the_real_drenthe_case(self):
        # Camera 861943071187529, 13 Aug 2026: 50 images, last one 14:11.
        assert format_quiet_tail(at(14, 11), MIDNIGHT) == "9h 49m"

    def test_whole_hours_drop_the_minutes(self):
        assert format_quiet_tail(at(16, 0), MIDNIGHT) == "8h"

    def test_a_short_gap_is_not_worth_saying(self):
        assert format_quiet_tail(at(23, 30), MIDNIGHT) is None

    def test_exactly_the_minimum_still_counts(self):
        assert format_quiet_tail(MIDNIGHT - MIN_QUIET_TAIL, MIDNIGHT) == "1h"

    def test_just_under_the_minimum_does_not(self):
        assert format_quiet_tail(
            MIDNIGHT - MIN_QUIET_TAIL + timedelta(minutes=1), MIDNIGHT
        ) is None

    def test_last_image_at_midnight_gives_nothing(self):
        assert format_quiet_tail(MIDNIGHT, MIDNIGHT) is None

    def test_a_camera_quiet_since_the_early_hours(self):
        assert format_quiet_tail(at(2, 5), MIDNIGHT) == "21h 55m"


class _FakeDb:
    """Stands in for the session, returns fixed rows from execute()."""

    def __init__(self, rows):
        self._rows = rows
        self.params = None

    def execute(self, _statement, params=None):
        self.params = params
        return iter(self._rows)


def _row(**kwargs):
    base = dict(
        id=7,
        device_id="861943071187529",
        notes=None,
        image_count=50,
        first_image=at(3, 4),
        last_image=at(14, 11),
        lat=52.9,
        lon=6.6,
        site_name="Kruisdennen",
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


class TestCameraRows:
    def test_times_are_formatted_from_the_camera_clock(self):
        db = _FakeDb([_row()])
        cams = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)
        assert cams[0]["first_image"] == "03:04"
        assert cams[0]["last_image"] == "14:11"

    def test_the_quiet_tail_is_measured_to_the_end_of_the_day(self):
        db = _FakeDb([_row()])
        cams = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)
        assert cams[0]["quiet_tail"] == "9h 49m"

    def test_a_camera_active_until_midnight_gets_no_tail(self):
        db = _FakeDb([_row(last_image=at(23, 50))])
        cams = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)
        assert cams[0]["quiet_tail"] is None

    def test_the_existing_fields_are_untouched(self):
        db = _FakeDb([_row(notes="Facing the path")])
        cam = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)[0]
        assert cam["id"] == 7
        assert cam["site_name"] == "Kruisdennen"
        assert cam["device_id"] == "861943071187529"
        assert cam["image_count"] == 50
        assert cam["notes"] == "Facing the path"
        assert (cam["lat"], cam["lon"]) == (52.9, 6.6)

    def test_missing_gps_stays_none(self):
        db = _FakeDb([_row(lat=None, lon=None)])
        cam = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)[0]
        assert cam["lat"] is None and cam["lon"] is None

    def test_the_day_window_is_passed_to_the_query(self):
        db = _FakeDb([_row()])
        _get_cameras_over_threshold(db, 42, at(0), MIDNIGHT, 25)
        assert db.params["project_id"] == 42
        assert db.params["threshold"] == 25
        assert db.params["start_of_day"] == at(0)
        assert db.params["end_of_day"] == MIDNIGHT


def _cams(**kwargs):
    cam = dict(
        id=7,
        site_name="Kruisdennen",
        device_id="861943071187529",
        notes=None,
        image_count=50,
        first_image="03:04",
        last_image="14:11",
        quiet_tail="9h 49m",
        lat=None,
        lon=None,
    )
    cam.update(kwargs)
    return [cam]


class TestPlainTextEmail:
    def test_it_reads_as_a_window_not_a_bare_count(self):
        body = _generate_text_content(
            "Provincie Drenthe", MIDNIGHT.date(), 50, _cams(), "https://x/i", "https://x/s"
        )
        assert "50 images, 03:04 to 14:11" in body

    def test_the_silence_is_spelled_out(self):
        body = _generate_text_content(
            "Provincie Drenthe", MIDNIGHT.date(), 50, _cams(), "https://x/i", "https://x/s"
        )
        assert "No images for the last 9h 49m of the day" in body

    def test_no_silence_line_when_there_is_no_gap(self):
        body = _generate_text_content(
            "Provincie Drenthe", MIDNIGHT.date(), 50,
            _cams(quiet_tail=None, last_image="23:50"),
            "https://x/i", "https://x/s",
        )
        assert "No images for the last" not in body
        assert "50 images, 03:04 to 23:50" in body

    def test_it_never_guesses_how_many_were_missed(self):
        # Estimating missed pictures needs a trigger rate we do not have, so
        # the email must stay on facts.
        body = _generate_text_content(
            "Provincie Drenthe", MIDNIGHT.date(), 50, _cams(), "https://x/i", "https://x/s"
        ).lower()
        for guess in ("potentially miss", "estimated", "approximately", "missed images"):
            assert guess not in body


class TestHtmlEmail:
    def _render(self, cams):
        html, _ = render_email(
            "excessive_images_alert.html",
            project_name="Provincie Drenthe",
            date_label="August 13, 2026",
            camera_count=len(cams),
            threshold=50,
            cameras=cams,
            images_url="https://x/i",
            settings_url="https://x/s",
        )
        return html

    def test_the_window_renders(self):
        html = self._render(_cams())
        assert "50 images" in html
        assert "03:04 to 14:11" in html

    def test_the_silence_renders(self):
        assert "No images for the last 9h 49m of the day" in self._render(_cams())

    def test_the_silence_line_is_dropped_when_absent(self):
        html = self._render(_cams(quiet_tail=None))
        assert "No images for the last" not in html
        assert "50 images" in html
