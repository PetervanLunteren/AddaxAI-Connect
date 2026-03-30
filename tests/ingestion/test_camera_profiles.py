"""Tests for ingestion camera_profiles profile matching."""
import pytest
from camera_profiles import (
    CameraProfile,
    WILLFINE_2025_PROFILE,
    SWIFT_ENDURO_PROFILE,
    CAMERA_PROFILES,
    identify_camera_profile,
    extract_swift_enduro_camera_id,
)


class TestCameraProfileMatches:
    def test_willfine_matches(self):
        exif = {"Make": "Willfine", "Model": "4.0T CG"}
        assert WILLFINE_2025_PROFILE.matches(exif)

    def test_willfine_case_insensitive(self):
        exif = {"Make": "willfine", "Model": "4.0t cg"}
        assert WILLFINE_2025_PROFILE.matches(exif)

    def test_wrong_make_no_match(self):
        exif = {"Make": "Reconyx", "Model": "4.0T CG"}
        assert not WILLFINE_2025_PROFILE.matches(exif)

    def test_wrong_model_no_match(self):
        exif = {"Make": "Willfine", "Model": "3.0S"}
        assert not WILLFINE_2025_PROFILE.matches(exif)

    def test_empty_exif_no_match(self):
        assert not WILLFINE_2025_PROFILE.matches({})


class TestSwiftEnduroMatches:
    def test_swift_enduro_matches(self):
        exif = {"Make": "SY", "Model": "4.0PCG-R"}
        assert SWIFT_ENDURO_PROFILE.matches(exif)

    def test_swift_enduro_case_insensitive(self):
        exif = {"Make": "sy", "Model": "4.0pcg-r"}
        assert SWIFT_ENDURO_PROFILE.matches(exif)

    def test_wrong_make_no_match(self):
        exif = {"Make": "Willfine", "Model": "4.0PCG-R"}
        assert not SWIFT_ENDURO_PROFILE.matches(exif)

    def test_wrong_model_no_match(self):
        exif = {"Make": "SY", "Model": "3.0S"}
        assert not SWIFT_ENDURO_PROFILE.matches(exif)

    def test_empty_exif_no_match(self):
        assert not SWIFT_ENDURO_PROFILE.matches({})


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


class TestIdentifyCameraProfile:
    def test_identifies_willfine(self):
        exif = {"Make": "Willfine", "Model": "4.0T CG"}
        profile = identify_camera_profile(exif, "IMG_0001.JPG")
        assert profile.name == "Willfine-2025"

    def test_identifies_swift_enduro(self):
        exif = {"Make": "SY", "Model": "4.0PCG-R"}
        profile = identify_camera_profile(exif, "868020035314870-30032026102652-4-SYPR0260.JPG")
        assert profile.name == "Swift Enduro"

    def test_unknown_camera_raises(self):
        exif = {"Make": "Unknown", "Model": "X100"}
        with pytest.raises(ValueError, match="Unsupported camera model"):
            identify_camera_profile(exif, "IMG_0001.JPG")
