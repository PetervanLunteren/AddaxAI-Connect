"""Tests for ingestion camera_profiles profile matching."""
from datetime import datetime

import pytest

from camera_profiles import (
    CameraProfile,
    INSTAR_PROFILE,
    SWIFT_ENDURO_PROFILE,
    WILLFINE_2025_PROFILE,
    extract_swift_enduro_camera_id,
    identify_camera_profile,
    parse_instar_path,
)


class TestCameraProfileMatches:
    def test_willfine_matches(self):
        exif = {"Make": "Willfine", "Model": "4.0T CG"}
        assert WILLFINE_2025_PROFILE.matches_exif(exif)

    def test_willfine_case_insensitive(self):
        exif = {"Make": "willfine", "Model": "4.0t cg"}
        assert WILLFINE_2025_PROFILE.matches_exif(exif)

    def test_wrong_make_no_match(self):
        exif = {"Make": "Reconyx", "Model": "4.0T CG"}
        assert not WILLFINE_2025_PROFILE.matches_exif(exif)

    def test_wrong_model_no_match(self):
        exif = {"Make": "Willfine", "Model": "3.0S"}
        assert not WILLFINE_2025_PROFILE.matches_exif(exif)

    def test_empty_exif_no_match(self):
        assert not WILLFINE_2025_PROFILE.matches_exif({})

    def test_path_profile_does_not_match_exif(self):
        # INSTAR is path-based and must never match via EXIF
        assert not INSTAR_PROFILE.matches_exif({"Make": "INSTAR", "Model": "anything"})


class TestSwiftEnduroMatches:
    def test_swift_enduro_matches(self):
        exif = {"Make": "SY", "Model": "4.0PCG-R"}
        assert SWIFT_ENDURO_PROFILE.matches_exif(exif)

    def test_swift_enduro_case_insensitive(self):
        exif = {"Make": "sy", "Model": "4.0pcg-r"}
        assert SWIFT_ENDURO_PROFILE.matches_exif(exif)

    def test_wrong_make_no_match(self):
        exif = {"Make": "Willfine", "Model": "4.0PCG-R"}
        assert not SWIFT_ENDURO_PROFILE.matches_exif(exif)

    def test_wrong_model_no_match(self):
        exif = {"Make": "SY", "Model": "3.0S"}
        assert not SWIFT_ENDURO_PROFILE.matches_exif(exif)

    def test_empty_exif_no_match(self):
        assert not SWIFT_ENDURO_PROFILE.matches_exif({})


class TestExtractSwiftEnduroCameraId:
    def test_filename_with_cam_id(self):
        filename = "WBC398      -868020035314870-10032026090126-4-SYPR0067.JPG"
        assert extract_swift_enduro_camera_id({}, filename) == "868020035314870"

    def test_filename_without_cam_id(self):
        filename = "868020035314870-30032026102652-4-SYPR0260.JPG"
        assert extract_swift_enduro_camera_id({}, filename) == "868020035314870"

    def test_no_imei_returns_none(self):
        assert extract_swift_enduro_camera_id({}, "IMG_0001.JPG") is None

    def test_14_digit_number_not_matched(self):
        assert extract_swift_enduro_camera_id({}, "12345678901234-file.JPG") is None

    def test_16_digit_number_not_matched(self):
        assert extract_swift_enduro_camera_id({}, "1234567890123456-file.JPG") is None


class TestInstarPathRegex:
    """The path regex is the gatekeeper for INSTAR profile selection."""

    def test_positive_coords(self):
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg"
        assert INSTAR_PROFILE.matches_path(path)

    def test_negative_coords(self):
        path = "INSTAR/lat-33.85679_lon-70.65876/20260409/images/A_2026-04-09_16-04-05.jpeg"
        assert INSTAR_PROFILE.matches_path(path)

    def test_mixed_signs(self):
        path = "INSTAR/lat-33.85679_lon151.20929/20260409/images/A_2026-04-09_16-04-05.jpeg"
        assert INSTAR_PROFILE.matches_path(path)

    def test_case_insensitive_extension(self):
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.JPG"
        assert INSTAR_PROFILE.matches_path(path)

    def test_record_subdir_not_matched(self):
        # Videos must NOT match - they are dispatched separately and never reach process_image
        path = "INSTAR/lat52.02368_lon12.98290/20260409/record/A_2026-04-09_16-04-05.mp4"
        assert not INSTAR_PROFILE.matches_path(path)

    def test_missing_brand_prefix_not_matched(self):
        path = "lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg"
        assert not INSTAR_PROFILE.matches_path(path)

    def test_missing_date_dir_not_matched(self):
        path = "INSTAR/lat52.02368_lon12.98290/images/A_2026-04-09_16-04-05.jpeg"
        assert not INSTAR_PROFILE.matches_path(path)

    def test_malformed_latlon_not_matched(self):
        path = "INSTAR/lat-foo_lon-bar/20260409/images/A_2026-04-09_16-04-05.jpeg"
        assert not INSTAR_PROFILE.matches_path(path)

    def test_extra_segment_not_matched(self):
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/sub/A_2026-04-09_16-04-05.jpeg"
        assert not INSTAR_PROFILE.matches_path(path)

    def test_flat_path_not_matched(self):
        assert not INSTAR_PROFILE.matches_path("IMG_0001.jpg")


class TestParseInstarPath:
    def test_extracts_device_id_datetime_gps(self):
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg"
        result = parse_instar_path(path)
        assert result["device_id"] == "lat52.02368_lon12.98290"
        assert result["datetime"] == datetime(2026, 4, 9, 16, 4, 5)
        assert result["gps"] == (52.02368, 12.98290)

    def test_negative_coords(self):
        path = "INSTAR/lat-33.85679_lon-70.65876/20260101/images/A_2026-01-01_00-00-01.jpeg"
        result = parse_instar_path(path)
        assert result["device_id"] == "lat-33.85679_lon-70.65876"
        assert result["gps"] == (-33.85679, -70.65876)
        assert result["datetime"] == datetime(2026, 1, 1, 0, 0, 1)

    def test_test_snapshot_raises(self):
        # Test-Snapshot.jpeg arrives in images/ but has no timestamp -> ValueError
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/Test-Snapshot.jpeg"
        with pytest.raises(ValueError, match="no timestamp"):
            parse_instar_path(path)

    def test_unrelated_path_raises(self):
        with pytest.raises(ValueError, match="does not match INSTAR layout"):
            parse_instar_path("WBC398-868020035314870-10032026090126-4-SYPR0067.JPG")

    def test_filename_with_lowercase_channel_accepted(self):
        # The filename regex is case-insensitive, so a future firmware that
        # writes 'a_' instead of 'A_' must still parse cleanly.
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/a_2026-04-09_16-04-05.jpeg"
        assert parse_instar_path(path)["datetime"] == datetime(2026, 4, 9, 16, 4, 5)

    def test_device_id_round_trips_through_split(self):
        # Make sure device_id is the verbatim path segment, not a re-formatted version
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg"
        assert parse_instar_path(path)["device_id"] == "lat52.02368_lon12.98290"


class TestIdentifyCameraProfile:
    def test_path_match_beats_exif(self):
        # Even if EXIF matched something, the path-based profile wins
        exif = {"Make": "Willfine", "Model": "4.0T CG"}
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg"
        profile = identify_camera_profile(exif=exif, filename="A.jpg", relative_path=path)
        assert profile.name == "INSTAR"

    def test_identifies_willfine_when_path_does_not_match(self):
        exif = {"Make": "Willfine", "Model": "4.0T CG"}
        profile = identify_camera_profile(exif=exif, filename="IMG_0001.JPG", relative_path="IMG_0001.JPG")
        assert profile.name == "Willfine-2025"

    def test_identifies_swift_enduro(self):
        exif = {"Make": "SY", "Model": "4.0PCG-R"}
        filename = "868020035314870-30032026102652-4-SYPR0260.JPG"
        profile = identify_camera_profile(exif=exif, filename=filename, relative_path=filename)
        assert profile.name == "Swift Enduro"

    def test_identifies_instar_with_empty_exif(self):
        # INSTAR has zero EXIF; identification must succeed without it
        path = "INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg"
        profile = identify_camera_profile(exif={}, filename="A_2026-04-09_16-04-05.jpeg", relative_path=path)
        assert profile.name == "INSTAR"

    def test_unknown_camera_raises(self):
        exif = {"Make": "Unknown", "Model": "X100"}
        with pytest.raises(ValueError, match="Unsupported camera"):
            identify_camera_profile(exif=exif, filename="IMG_0001.JPG", relative_path="IMG_0001.JPG")

    def test_unknown_camera_with_no_exif_and_unrelated_path_raises(self):
        with pytest.raises(ValueError, match="Unsupported camera"):
            identify_camera_profile(exif={}, filename="IMG_0001.JPG", relative_path="some/random/path.jpg")


class TestCameraProfileValidation:
    """The dataclass __post_init__ enforces the EXIF/path-profile contract."""

    def test_neither_exif_nor_path_raises(self):
        with pytest.raises(ValueError, match="must provide either"):
            CameraProfile(name="bad")

    def test_both_exif_and_path_raises(self):
        with pytest.raises(ValueError, match="cannot be both"):
            CameraProfile(
                name="bad",
                get_camera_id=lambda exif, filename: "x",
                path_pattern="^foo$",
                parse_path=lambda p: {},
            )

    def test_path_profile_requires_both_pattern_and_parser(self):
        with pytest.raises(ValueError, match="path profiles require both"):
            CameraProfile(name="bad", path_pattern="^foo$")
