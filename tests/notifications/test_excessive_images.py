"""
Tests for the excessive image alert.

The module had no tests at all. The point of the alert is that these cameras
cap how many pictures they transmit per day in hardware, so a camera landing
on its cap has gone quiet for the rest of the day. On the Drenthe project 9
camera-days landed on exactly 50 images and 5 on exactly 25, with the last
picture as early as 14:11. The email now names the window those images
arrived in, and these tests keep it from drifting.
"""
from datetime import datetime
from types import SimpleNamespace

from shared.email_renderer import render_email

from excessive_images import _generate_text_content, _get_cameras_over_threshold

MIDNIGHT = datetime(2026, 8, 14, 0, 0)  # end of 13 Aug


def at(hour: int, minute: int = 0) -> datetime:
    """A camera-clock reading on 13 Aug 2026."""
    return datetime(2026, 8, 13, hour, minute)


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
        # The real Drenthe case: 50 images, last one at 14:11.
        db = _FakeDb([_row()])
        cams = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)
        assert cams[0]["first_image"] == "03:04"
        assert cams[0]["last_image"] == "14:11"

    def test_a_camera_active_until_midnight(self):
        db = _FakeDb([_row(first_image=at(0, 5), last_image=at(23, 50))])
        cams = _get_cameras_over_threshold(db, 1, at(0), MIDNIGHT, 50)
        assert (cams[0]["first_image"], cams[0]["last_image"]) == ("00:05", "23:50")

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
        lat=None,
        lon=None,
    )
    cam.update(kwargs)
    return [cam]


def _text(cams=None):
    return _generate_text_content(
        "Provincie Drenthe", MIDNIGHT.date(), 50,
        cams if cams is not None else _cams(),
        "https://x/i", "https://x/s",
    )


class TestPlainTextEmail:
    def test_it_reads_as_a_window_not_a_bare_count(self):
        assert "50 images received between 03:04 and 14:11" in _text()

    def test_it_names_the_threshold_as_the_reader_s_own_setting(self):
        assert "1 camera went over your threshold of 50 images." in _text()

    def test_several_cameras_read_as_plural(self):
        two = _cams() + _cams(id=8, device_id="861943071171986")
        assert "2 cameras went over your threshold of 50 images." in _text(two)

    def test_it_never_guesses_how_many_were_missed(self):
        # Estimating missed pictures needs a trigger rate we do not have, so
        # the email must stay on facts.
        body = _text().lower()
        for guess in ("potentially miss", "estimated", "approximately", "missed images"):
            assert guess not in body

    def test_it_does_not_tell_the_reader_what_to_conclude(self):
        # The window is a fact. Whether the camera hit its cap or simply saw
        # nothing more is the reader's call, so no line claims either.
        body = _text().lower()
        for claim in ("no images for the last", "went quiet", "reached its limit"):
            assert claim not in body


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
        assert "received between 03:04 and 14:11" in html

    def test_the_threshold_reads_as_the_reader_s_own_setting(self):
        assert "went over your threshold of 50 images a day" in self._render(_cams())

    def test_the_html_and_the_text_agree(self):
        html = self._render(_cams())
        for part in ("50 images", "03:04", "14:11"):
            assert part in html and part in _text()
