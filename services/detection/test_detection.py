"""
Test script for detection worker

Tests MegaDetector on giraffe.jpg and validates against expected results.
"""
import json
import sys
from pathlib import Path

from model_loader import load_model
from detector import run_detection

# Test image path
TEST_IMAGE = "/tmp/test-detection/giraffe.jpg"
EXPECTED_RESULTS = "/tmp/test-detection/results.json"


def main():
    """Run detection test"""
    print("=" * 60)
    print("Detection Worker Test")
    print("=" * 60)

    # Check if test files exist
    if not Path(TEST_IMAGE).exists():
        print(f"ERROR: Test image not found: {TEST_IMAGE}")
        sys.exit(1)

    if not Path(EXPECTED_RESULTS).exists():
        print(f"WARNING: Expected results not found: {EXPECTED_RESULTS}")
        expected_data = None
    else:
        with open(EXPECTED_RESULTS) as f:
            expected_data = json.load(f)

    print(f"\nTest image: {TEST_IMAGE}")
    print(f"Expected results: {EXPECTED_RESULTS}")

    # Load model
    print("\n" + "-" * 60)
    print("Loading MegaDetector model...")
    print("-" * 60)
    detector = load_model()
    print("Model loaded successfully")

    # Run detection
    print("\n" + "-" * 60)
    print("Running detection...")
    print("-" * 60)
    detections = run_detection(detector, TEST_IMAGE)

    # Print results
    print("\n" + "-" * 60)
    print(f"Detection Results: {len(detections)} detections found")
    print("-" * 60)

    for idx, detection in enumerate(detections):
        print(f"\nDetection {idx}:")
        print(f"  Category: {detection.category}")
        print(f"  Confidence: {detection.confidence:.4f}")
        print(f"  Bbox (normalized): {[f'{x:.4f}' for x in detection.bbox_normalized]}")
        print(f"  Bbox (pixels): {detection.bbox_pixels}")

    # Compare with expected results
    if expected_data:
        print("\n" + "=" * 60)
        print("Validation Against Expected Results")
        print("=" * 60)

        expected_detections = expected_data["images"][0]["detections"]
        print(f"\nExpected detections: {len(expected_detections)}")
        print(f"Actual detections: {len(detections)}")

        if len(expected_detections) == len(detections):
            print("✓ Detection count matches!")
        else:
            print("✗ Detection count mismatch!")

        # Compare first detection
        if len(expected_detections) > 0 and len(detections) > 0:
            exp_det = expected_detections[0]
            act_det = detections[0]

            print(f"\nFirst detection comparison:")
            print(f"  Expected category: {exp_det['category']} (animal), Actual: {act_det.category}")
            print(f"  Expected confidence: {exp_det['conf']:.4f}, Actual: {act_det.confidence:.4f}")
            print(f"  Expected bbox: {[f'{x:.4f}' for x in exp_det['bbox']]}")
            print(f"  Actual bbox:   {[f'{x:.4f}' for x in act_det.bbox_normalized]}")

            # Check category
            if act_det.category == "animal":
                print(f"  ✓ Category matches!")
            else:
                print(f"  ✗ Category mismatch!")

            # Check if confidence is close
            conf_diff = abs(exp_det['conf'] - act_det.confidence)
            if conf_diff < 0.05:
                print(f"  ✓ Confidence matches (diff: {conf_diff:.4f})")
            else:
                print(f"  ✗ Confidence differs significantly (diff: {conf_diff:.4f})")

            # Check bbox (allow small tolerance for floating point)
            bbox_match = all(abs(e - a) < 0.01 for e, a in zip(exp_det['bbox'], act_det.bbox_normalized))
            if bbox_match:
                print(f"  ✓ Bounding box matches!")
            else:
                print(f"  ✗ Bounding box differs!")

    print("\n" + "=" * 60)
    print("Test Complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
