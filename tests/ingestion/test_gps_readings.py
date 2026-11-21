"""The GPS reading of a photo and of a daily report lands in gps_lat and gps_lon.

Fake DB session, like test_rejection_record.py. The rebuild of deployments
needs PostGIS and is not exercised here: photos are stored with rebuild=False.
"""
from contextlib import contextmanager
from datetime import datetime

from shared.models import Camera, CameraHealthReport

import db_operations


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter_by(self, **_kwargs):
        return self

    def filter(self, *_args):
        return self

    def first(self):
        return self._result


class _FakeSession:
    def __init__(self, results=None):
        self._results = results or {}
        self.added = []

    def query(self, model):
        return _FakeQuery(self._results.get(model))

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass


def _patch_session(monkeypatch, session):
    @contextmanager
    def fake_get_db_session():
        yield session

    monkeypatch.setattr(db_operations, "get_db_session", fake_get_db_session)


def _photo(monkeypatch, gps_reading):
    session = _FakeSession()
    _patch_session(monkeypatch, session)
    db_operations.create_image_record(
        image_uuid="u-1",
        camera_id=1,
        filename="x.jpg",
        storage_path="x",
        thumbnail_path="x",
        captured_at=datetime(2026, 3, 1, 12),
        gps_reading=gps_reading,
        exif_metadata={},
        rebuild=False,
    )
    [image] = session.added
    return image


def test_photo_stores_its_own_reading(monkeypatch):
    image = _photo(monkeypatch, (52.1, 5.2))
    assert (image.gps_lat, image.gps_lon) == (52.1, 5.2)


def test_photo_without_reading_stays_empty(monkeypatch):
    image = _photo(monkeypatch, None)
    assert (image.gps_lat, image.gps_lon) == (None, None)


def test_photo_with_invalid_reading_stays_empty(monkeypatch):
    image = _photo(monkeypatch, (0.0, 0.0))
    assert (image.gps_lat, image.gps_lon) == (None, None)


def _report(monkeypatch, gps, existing=None):
    camera = Camera(id=7, device_id="CAM7", config={})
    session = _FakeSession({Camera: camera, CameraHealthReport: existing})
    _patch_session(monkeypatch, session)
    db_operations.update_camera_health("CAM7", {
        "gps_location": gps,
        "report_datetime": datetime(2026, 3, 1, 6),
    })
    return session


def test_report_stores_its_reading_on_a_new_row(monkeypatch):
    session = _report(monkeypatch, (52.1, 5.2))
    [report] = session.added
    assert (report.gps_lat, report.gps_lon) == (52.1, 5.2)


def test_report_overwrites_the_reading_of_the_same_day(monkeypatch):
    existing = CameraHealthReport(camera_id=7, gps_lat=52.1, gps_lon=5.2)
    session = _report(monkeypatch, (0.0, 0.0), existing=existing)
    assert session.added == []
    assert (existing.gps_lat, existing.gps_lon) == (None, None)
