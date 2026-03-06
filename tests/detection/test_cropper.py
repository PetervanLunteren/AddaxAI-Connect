"""Tests for detection cropper filename generation."""
from cropper import generate_crop_filename


def test_basic_filename():
    result = generate_crop_filename("abc-123", 0)
    assert result == "abc-123_0.jpg"


def test_second_detection():
    result = generate_crop_filename("abc-123", 1)
    assert result == "abc-123_1.jpg"
