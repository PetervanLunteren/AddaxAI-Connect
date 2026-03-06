"""Tests for classification annotated_image helper functions."""
from annotated_image import (
    hex_to_rgb,
    _normalize_label,
    get_category_color,
    CATEGORY_COLORS,
    DEFAULT_COLOR,
)


class TestHexToRgb:
    def test_black(self):
        assert hex_to_rgb("#000000") == (0, 0, 0)

    def test_white(self):
        assert hex_to_rgb("#ffffff") == (255, 255, 255)

    def test_animal_color(self):
        assert hex_to_rgb("#0f6064") == (15, 96, 100)

    def test_without_hash(self):
        assert hex_to_rgb("ff8945") == (255, 137, 69)


class TestNormalizeLabel:
    def test_underscores_to_spaces(self):
        assert _normalize_label("red_fox") == "Red fox"

    def test_capitalizes_first_letter(self):
        assert _normalize_label("animal") == "Animal"

    def test_already_capitalized(self):
        assert _normalize_label("Fox") == "Fox"

    def test_empty_string(self):
        assert _normalize_label("") == ""


class TestGetCategoryColor:
    def test_animal(self):
        assert get_category_color("animal") == "#0f6064"

    def test_person(self):
        assert get_category_color("person") == "#ff8945"

    def test_vehicle(self):
        assert get_category_color("vehicle") == "#71b7ba"

    def test_unknown_returns_default(self):
        assert get_category_color("spaceship") == DEFAULT_COLOR
