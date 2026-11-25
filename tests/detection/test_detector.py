"""Tests for detection detector module (pure-logic parts only, no ML)."""
import pytest


class TestCategoryMap:
    def test_animal(self):
        from detector import CATEGORY_MAP
        assert CATEGORY_MAP["1"] == "animal"

    def test_person(self):
        from detector import CATEGORY_MAP
        assert CATEGORY_MAP["2"] == "person"

    def test_vehicle(self):
        from detector import CATEGORY_MAP
        assert CATEGORY_MAP["3"] == "vehicle"

    def test_unknown_key(self):
        from detector import CATEGORY_MAP
        assert CATEGORY_MAP.get("99", "unknown") == "unknown"


class TestDetectionDataclass:
    def test_to_dict(self):
        from detector import Detection
        d = Detection(
            category="animal",
            confidence=0.95,
            bbox_normalized=[0.1, 0.2, 0.3, 0.4],
            bbox_pixels=[100, 200, 300, 400],
            image_width=1000,
            image_height=1000,
        )
        result = d.to_dict()
        assert result["category"] == "animal"
        assert result["confidence"] == 0.95
        assert result["bbox_normalized"] == [0.1, 0.2, 0.3, 0.4]
        assert result["bbox_pixels"] == [100, 200, 300, 400]


class TestRunDetectionInput:
    @pytest.mark.parametrize("mode, name", [("L", "gray.jpg"), ("RGBA", "alpha.png")])
    def test_the_detector_gets_an_rgb_image(self, tmp_path, mode, name):
        """MegaDetector fails on a grayscale or RGBA image ("axes don't
        match array"), so the file is converted before it gets there."""
        from PIL import Image
        from detector import run_detection

        path = tmp_path / name
        Image.new(mode, (64, 48)).save(path)
        seen = []

        class _Detector:
            def generate_detections_one_image(self, image, image_id, **kw):
                seen.append(image)
                return {"file": image_id, "detections": []}

        assert run_detection(_Detector(), str(path)) == []
        assert seen[0].mode == "RGB"
        assert seen[0].size == (64, 48)
