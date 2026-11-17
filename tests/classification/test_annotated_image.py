"""Tests for classification annotated_image helper functions."""
from annotated_image import (
    hex_to_rgb,
    _normalize_label,
    _label_texts,
    _percent,
    Detection,
    Classification,
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


BOX = {"x": 0, "y": 0, "width": 10, "height": 10}


class TestPercent:
    def test_rounds_up_like_the_frontend(self):
        assert _percent(0.896) == 90

    def test_half_rounds_up_not_to_even(self):
        assert _percent(0.125) == 13

    def test_bounds(self):
        assert _percent(0.0) == 0
        assert _percent(1.0) == 100


class TestLabelTexts:
    def test_animal_uses_detection_then_species_confidence(self):
        det = Detection(bbox=BOX, category="animal", confidence=0.92)
        cls = Classification(species="red_fox", confidence=0.45)
        assert _label_texts(det, cls) == ("Animal 92%", "Red fox 45%")

    def test_person_has_no_species_line(self):
        det = Detection(bbox=BOX, category="person", confidence=0.81)
        cls = Classification(species="person", confidence=0.81)
        assert _label_texts(det, cls) == ("Person 81%", None)
