"""Tests for ingestion camera_profiles profile matching."""
import pytest
from camera_profiles import (
    CameraProfile,
    WILLFINE_2025_PROFILE,
    CAMERA_PROFILES,
    identify_camera_profile,
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


class TestIdentifyCameraProfile:
    def test_identifies_willfine(self):
        exif = {"Make": "Willfine", "Model": "4.0T CG"}
        profile = identify_camera_profile(exif, "IMG_0001.JPG")
        assert profile.name == "Willfine-2025"

    def test_unknown_camera_raises(self):
        exif = {"Make": "Unknown", "Model": "X100"}
        with pytest.raises(ValueError, match="Unsupported camera model"):
            identify_camera_profile(exif, "IMG_0001.JPG")
