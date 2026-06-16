"""Tests for create_rejection_record project resolution.

The Live feed shows a rejected file inside a project only when the row carries
a project_id. That id is resolved from device_id at rejection time, here. These
tests use a fake DB session so no live database is needed (matches the rest of
the suite).
"""
from contextlib import contextmanager
from types import SimpleNamespace

import db_operations


class _FakeQuery:
    def __init__(self, camera):
        self._camera = camera

    def filter_by(self, **_kwargs):
        return self

    def first(self):
        return self._camera


class _FakeSession:
    """Captures the Rejection passed to add() so the test can inspect it."""
    def __init__(self, camera):
        self._camera = camera
        self.added = []

    def query(self, _model):
        return _FakeQuery(self._camera)

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass


def _patch_session(monkeypatch, session):
    @contextmanager
    def fake_get_db_session():
        yield session

    monkeypatch.setattr(db_operations, "get_db_session", fake_get_db_session)


def test_resolves_camera_and_project_from_device_id(monkeypatch, tmp_path):
    f = tmp_path / "x.jpg"
    f.write_bytes(b"abc")
    session = _FakeSession(SimpleNamespace(id=7, project_id=3))
    _patch_session(monkeypatch, session)

    db_operations.create_rejection_record(
        disk_path=str(f),
        filename="x.jpg",
        reason="missing_gps",
        details="no gps",
        device_id="IMEI123",
    )

    assert len(session.added) == 1
    rej = session.added[0]
    assert rej.camera_id == 7
    assert rej.project_id == 3
    assert rej.device_id == "IMEI123"
    assert rej.reason == "missing_gps"
    assert rej.file_size_bytes == 3


def test_unregistered_camera_leaves_project_null(monkeypatch, tmp_path):
    # device_id is known but no camera matches it (e.g. unknown_camera), so the
    # row stays unresolved and never appears in a project feed.
    f = tmp_path / "y.jpg"
    f.write_bytes(b"abcd")
    session = _FakeSession(camera=None)
    _patch_session(monkeypatch, session)

    db_operations.create_rejection_record(
        disk_path=str(f),
        filename="y.jpg",
        reason="unknown_camera",
        details="not registered",
        device_id="IMEI999",
    )

    rej = session.added[0]
    assert rej.camera_id is None
    assert rej.project_id is None
    assert rej.device_id == "IMEI999"


def test_no_device_id_is_unresolved(monkeypatch, tmp_path):
    # Rejections with no device id (corrupt file, stripped EXIF) cannot map to a
    # project at all.
    f = tmp_path / "z.jpg"
    f.write_bytes(b"a")
    session = _FakeSession(camera=SimpleNamespace(id=1, project_id=1))
    _patch_session(monkeypatch, session)

    db_operations.create_rejection_record(
        disk_path=str(f),
        filename="z.jpg",
        reason="validation_failed",
        details="bad file",
        device_id=None,
    )

    rej = session.added[0]
    assert rej.camera_id is None
    assert rej.project_id is None
    assert rej.file_size_bytes == 1
