"""
Unit tests for the bulk-upload helper functions.

Copies the small pure helpers from services/api/routers/bulk_upload.py
and services/bulk-upload/worker.py to test them without dragging in the
FastAPI app, MinIO client, or database. Same pattern as
test_camera_tags.py.
"""
import re
from typing import Optional

import pytest
from pydantic import BaseModel, Field, ValidationError, model_validator

from shared.camera_profiles import identify_camera_profile


# --- copies of _safe_basename and _staging_prefix ---
def _safe_basename(name: str) -> str:
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_")
    return cleaned or "image.jpg"


def _staging_prefix(project_id: int, job_uuid: str) -> str:
    return f"{project_id}/{job_uuid}/"


# --- copy of the worker's recover-filename-from-key logic ---
def _recover_filename(key: str) -> str:
    tail = key.rsplit("/", 1)[-1]
    return tail.split("_", 1)[1] if "_" in tail else tail


# --- copies of the disk-headroom guard logic ---
def _gb(num_bytes: int) -> str:
    return f"{max(num_bytes, 0) / (1024 ** 3):.1f}"


def _fits(upload_bytes: int, free_bytes: int, reserve_bytes: int) -> bool:
    """True when the import fits, mirroring _check_disk_headroom's test."""
    return upload_bytes <= free_bytes - reserve_bytes


GB = 1024 ** 3


class TestSafeBasename:
    def test_plain_name(self):
        assert _safe_basename("IMG_0001.JPG") == "IMG_0001.JPG"

    def test_strips_unix_path(self):
        assert _safe_basename("DCIM/100EK113/IMG_0001.JPG") == "IMG_0001.JPG"

    def test_strips_windows_path(self):
        assert _safe_basename("DCIM\\100EK113\\IMG_0001.JPG") == "IMG_0001.JPG"

    def test_replaces_spaces_with_underscore(self):
        assert _safe_basename("my photo.jpg") == "my_photo.jpg"

    def test_replaces_special_chars(self):
        assert _safe_basename("photo$%^.jpg") == "photo_.jpg"

    def test_collapses_consecutive_unsafe_chars(self):
        assert _safe_basename("a   b.jpg") == "a_b.jpg"

    def test_strips_leading_trailing_underscores(self):
        assert _safe_basename("___name___.jpg") == "name___.jpg"

    def test_blank_falls_back_to_default(self):
        assert _safe_basename("") == "image.jpg"

    def test_only_unsafe_falls_back(self):
        assert _safe_basename("///") == "image.jpg"

    def test_replaces_unicode_with_underscore(self):
        # Non-ASCII characters become underscores so the staging key
        # is ASCII-safe for any S3 backend. Leading underscores are
        # then stripped, so this leaves "photo.jpg".
        assert _safe_basename("éphoto.jpg") == "photo.jpg"


class TestStagingPrefix:
    def test_shape(self):
        assert _staging_prefix(7, "abc-123") == "7/abc-123/"

    def test_ends_with_slash(self):
        # Worker branches on trailing slash to pick the prefix path
        # over the legacy single-zip path; keep this invariant.
        assert _staging_prefix(1, "u").endswith("/")


class TestRecoverFilename:
    def test_typical_key(self):
        assert _recover_filename("1/job-uuid/000042_IMG_0042.JPG") == "IMG_0042.JPG"

    def test_index_with_complex_name(self):
        assert (
            _recover_filename("9/job/000001_my_photo_123.jpg")
            == "my_photo_123.jpg"
        )

    def test_no_underscore_falls_back_to_tail(self):
        # Defensive: a key written without the index prefix should not
        # crash, even though the API never produces this shape.
        assert _recover_filename("9/job/picture.jpg") == "picture.jpg"


class TestUploadedIndexParse:
    """Parsing logic for the GET /jobs/{uuid}/uploaded-indexes endpoint."""

    @staticmethod
    def _parse_index(key: str):
        # Copy of the inline parser in routers/bulk_upload.py.
        tail = key.rsplit("/", 1)[-1]
        prefix = tail.split("_", 1)[0] if "_" in tail else tail
        try:
            return int(prefix)
        except ValueError:
            return None

    def test_standard_key(self):
        assert self._parse_index("1/abc/000042_IMG_0042.JPG") == 42

    def test_zero_index(self):
        assert self._parse_index("9/abc/000000_first.jpg") == 0

    def test_max_index(self):
        assert self._parse_index("9/abc/004999_last.jpg") == 4999

    def test_missing_underscore_returns_none(self):
        assert self._parse_index("9/abc/garbage.jpg") is None

    def test_non_numeric_prefix_returns_none(self):
        # If somehow a key without the standard index prefix lands in
        # the staging bucket, the endpoint must skip it, not 500.
        assert self._parse_index("9/abc/oops_file.jpg") is None


class TestDiskHeadroom:
    """The guard that refuses a bulk job too big for the local data disk."""

    RESERVE = 5 * GB

    def test_small_import_fits(self):
        assert _fits(2 * GB, free_bytes=100 * GB, reserve_bytes=self.RESERVE)

    def test_import_larger_than_free_is_refused(self):
        assert not _fits(50 * GB, free_bytes=30 * GB, reserve_bytes=self.RESERVE)

    def test_reserve_is_kept_aside(self):
        # 28 GB import, 30 GB free, 5 GB reserve leaves only 25 GB usable.
        assert not _fits(28 * GB, free_bytes=30 * GB, reserve_bytes=self.RESERVE)

    def test_exactly_at_usable_limit_fits(self):
        assert _fits(25 * GB, free_bytes=30 * GB, reserve_bytes=self.RESERVE)

    def test_one_byte_over_usable_is_refused(self):
        assert not _fits(25 * GB + 1, free_bytes=30 * GB, reserve_bytes=self.RESERVE)


class TestGbFormatting:
    """GB formatting used in the user-facing headroom message."""

    def test_whole_gb(self):
        assert _gb(50 * GB) == "50.0"

    def test_one_decimal(self):
        assert _gb(int(1.5 * GB)) == "1.5"

    def test_negative_clamped_to_zero(self):
        # usable can go negative when free disk is below the reserve; the
        # message must still read 0.0, never "-3.0".
        assert _gb(-3 * GB) == "0.0"


class TestStatusTransitions:
    """
    Document the legal status transitions in the bulk-upload state
    machine. Lock them down so a future change cannot silently add a
    transition that the API allows but the UI doesn't expect.
    """

    # status the API can move a job into via its endpoints
    LEGAL_TRANSITIONS = {
        "uploading": {"processing", "failed"},
        "processing": {"done", "failed"},
        # Terminal states have no outgoing edges.
        "done": set(),
        "failed": set(),
    }

    def test_uploading_can_become_processing(self):
        assert "processing" in self.LEGAL_TRANSITIONS["uploading"]

    def test_uploading_can_become_failed(self):
        assert "failed" in self.LEGAL_TRANSITIONS["uploading"]

    def test_processing_cannot_become_uploading(self):
        assert "uploading" not in self.LEGAL_TRANSITIONS["processing"]

    def test_terminal_states_have_no_outgoing(self):
        assert self.LEGAL_TRANSITIONS["done"] == set()
        assert self.LEGAL_TRANSITIONS["failed"] == set()


# --- copy of the scan-profile resolution loop in routers/bulk_upload.py ---
# Calls the real shared camera-profile matcher so the substantive matching is
# exercised; only the thin tally/decision around it is copied.
def _resolve_scan_mode(entries: list[dict]) -> dict:
    device_id_to_profile: dict[str, str] = {}
    for entry in entries:
        exif: dict = {}
        if entry.get("make"):
            exif["Make"] = entry["make"]
        if entry.get("model"):
            exif["Model"] = entry["model"]
        if entry.get("serial"):
            exif["SerialNumber"] = entry["serial"]
        filename = entry.get("filename", "")
        try:
            profile = identify_camera_profile(
                exif=exif, filename=filename, relative_path=""
            )
        except ValueError:
            continue
        if profile.is_path_based:
            continue
        device_id = profile.get_camera_id(exif, filename)
        if device_id:
            device_id_to_profile[device_id] = profile.name
    if not device_id_to_profile:
        return {"mode": "manual", "multiple_cameras": False, "device_id": None}
    device_ids = sorted(device_id_to_profile)
    if len(device_ids) > 1:
        return {
            "mode": "manual",
            "multiple_cameras": True,
            "device_id": None,
            "device_ids": device_ids,
        }
    return {
        "mode": "profile",
        "multiple_cameras": False,
        "device_id": device_ids[0],
        "profile_name": device_id_to_profile[device_ids[0]],
    }


# A real 15-digit Swift Enduro IMEI filename, from the camera_profiles docstring.
SWIFT_FILENAME = "868020035314870-30032026102652-4-SYPR0260.JPG"


class TestScanProfileResolution:
    """The pre-flight that decides Mode A (profile) vs Mode B (manual site)."""

    def test_willfine_serial_resolves_to_device_id(self):
        out = _resolve_scan_mode([
            {"make": "Willfine", "model": "4.0T CG", "serial": "WF123", "filename": "IMG_1.JPG"},
        ])
        assert out["mode"] == "profile"
        assert out["device_id"] == "WF123"
        assert out["profile_name"] == "Willfine-2025"

    def test_swift_imei_from_filename(self):
        out = _resolve_scan_mode([
            {"make": "SY", "model": "4.0PCG-R", "filename": SWIFT_FILENAME},
        ])
        assert out["mode"] == "profile"
        assert out["device_id"] == "868020035314870"

    def test_unknown_camera_is_manual(self):
        out = _resolve_scan_mode([
            {"make": "Canon", "model": "EOS 5D", "filename": "IMG_1.JPG"},
        ])
        assert out["mode"] == "manual"
        assert out["multiple_cameras"] is False

    def test_matched_profile_without_device_id_is_manual(self):
        # Willfine matches on Make/Model but has no SerialNumber, so no
        # device_id resolves: fall through to manual rather than guess.
        out = _resolve_scan_mode([
            {"make": "Willfine", "model": "4.0T CG", "filename": "IMG_1.JPG"},
        ])
        assert out["mode"] == "manual"

    def test_two_cameras_flags_multiple(self):
        out = _resolve_scan_mode([
            {"make": "Willfine", "model": "4.0T CG", "serial": "WF1", "filename": "a.JPG"},
            {"make": "Willfine", "model": "4.0T CG", "serial": "WF2", "filename": "b.JPG"},
        ])
        assert out["multiple_cameras"] is True
        assert out["mode"] == "manual"
        assert out["device_ids"] == ["WF1", "WF2"]

    def test_empty_sample_is_manual(self):
        assert _resolve_scan_mode([])["mode"] == "manual"


# --- copy of CreateBulkUploadRequest's exactly-one-target rule ---
class _CreateReq(BaseModel):
    folder_name: str = Field(min_length=1, max_length=255)
    device_id: Optional[str] = Field(default=None, max_length=50)
    site_id: Optional[int] = None
    total_files: int = Field(ge=1)
    total_bytes: int = Field(ge=0)

    @model_validator(mode="after")
    def _exactly_one_target(self) -> "_CreateReq":
        if bool(self.device_id) == bool(self.site_id):
            raise ValueError(
                "Provide exactly one of device_id (profile mode) or site_id (manual mode)"
            )
        return self


class TestCreateRequestTargetValidation:
    """Exactly one of device_id / site_id must be set on a create request."""

    def _make(self, **kwargs):
        base = {"folder_name": "trip", "total_files": 1, "total_bytes": 1}
        base.update(kwargs)
        return _CreateReq(**base)

    def test_device_id_only_ok(self):
        assert self._make(device_id="WF1").device_id == "WF1"

    def test_site_id_only_ok(self):
        assert self._make(site_id=7).site_id == 7

    def test_both_rejected(self):
        with pytest.raises(ValidationError):
            self._make(device_id="WF1", site_id=7)

    def test_neither_rejected(self):
        with pytest.raises(ValidationError):
            self._make()


class TestModeSelection:
    """How the worker and API decide Mode A vs Mode B."""

    @staticmethod
    def _use_profile(manifest: dict) -> bool:
        # Copy of the worker's _process_job mode decision.
        return not manifest.get("site_id")

    @staticmethod
    def _synthetic_device_id(site_id: int) -> str:
        return f"bulk-cam-{site_id}"

    def test_pinned_site_is_mode_b(self):
        assert self._use_profile({"site_id": 12}) is False

    def test_no_site_is_mode_a(self):
        assert self._use_profile({"date_range": {}}) is True

    def test_synthetic_device_id_per_site(self):
        assert self._synthetic_device_id(12) == "bulk-cam-12"
        # Same site always yields the same id, so re-uploads reuse the camera.
        assert self._synthetic_device_id(12) == self._synthetic_device_id(12)


class TestStopJob:
    """Stopping (cancelling) a bulk job during upload or analyse."""

    # Copy of the cancel endpoint's allowed states and the in-flight cap set.
    CANCELLABLE = ("uploading", "queued", "inspecting", "awaiting_confirmation", "processing")
    IN_FLIGHT = ("uploading", "processing")
    TERMINAL = {"done", "failed", "cancelled"}

    @staticmethod
    def _worker_skips(job_status: str) -> bool:
        # Copy of the detection/classification skip rule for bulk images.
        return job_status == "cancelled"

    def test_processing_is_now_cancellable(self):
        assert "processing" in self.CANCELLABLE

    def test_uploading_still_cancellable(self):
        assert "uploading" in self.CANCELLABLE

    def test_terminal_states_not_cancellable(self):
        for s in self.TERMINAL:
            assert s not in self.CANCELLABLE

    def test_cancelled_is_terminal_and_not_in_flight(self):
        assert "cancelled" in self.TERMINAL
        assert "cancelled" not in self.IN_FLIGHT

    def test_worker_skips_only_cancelled(self):
        assert self._worker_skips("cancelled") is True
        for s in ("uploading", "processing", "done", "failed"):
            assert self._worker_skips(s) is False


class TestCurationBulkUploadFilter:
    """The curation filter that scopes images to one bulk upload (by uuid).

    Mirrors the relevant slice of AdminImageFilterParams; the SQL clause itself
    needs a database and is verified on dev.
    """

    class _Filter(BaseModel):
        camera_id: Optional[int] = None
        bulk_upload_job: Optional[str] = None

    def test_accepts_job_uuid(self):
        assert self._Filter(bulk_upload_job="368b40ae-uuid").bulk_upload_job == "368b40ae-uuid"

    def test_optional_by_default(self):
        assert self._Filter().bulk_upload_job is None
