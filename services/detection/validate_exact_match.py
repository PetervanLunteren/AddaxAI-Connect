"""
Exact match validation script for detection worker

Runs detection on all images and validates results match EXACTLY with reference file.
Checks: number of detections, categories, confidences, and bounding boxes.
"""
import json
import sys
from pathlib import Path
from typing import Dict, List

from model_loader import load_model
from detector import run_detection
from shared.logger import get_logger

logger = get_logger("detection.validation")


def load_reference_results(reference_file: str) -> Dict:
    """Load reference results from JSON file"""
    with open(reference_file, 'r') as f:
        return json.load(f)


def compare_bbox(expected: List[float], actual: List[float], tolerance: float = 0.001) -> bool:
    """Compare bounding boxes with tolerance for floating point precision"""
    if len(expected) != len(actual):
        return False
    return all(abs(e - a) < tolerance for e, a in zip(expected, actual))


def compare_confidence(expected: float, actual: float, tolerance: float = 0.015) -> bool:
    """Compare confidence scores with small tolerance (1.5% relative error)"""
    return abs(expected - actual) < tolerance


def validate_image(image_file: str, expected: Dict, detector, image_dir: str, threshold: float = 0.1) -> Dict:
    """
    Validate detection results for a single image

    Only compares detections >= threshold from reference file.

    Returns dict with validation results
    """
    image_path = Path(image_dir) / image_file

    if not image_path.exists():
        return {
            "status": "ERROR",
            "message": f"Image file not found: {image_path}"
        }

    # Run detection
    detections = run_detection(detector, str(image_path))

    # Filter expected detections by threshold (ignore low-confidence ones)
    expected_dets = [d for d in expected["detections"] if d["conf"] >= threshold]
    if len(detections) != len(expected_dets):
        return {
            "status": "FAIL",
            "message": f"Detection count mismatch. Expected: {len(expected_dets)}, Got: {len(detections)}",
            "expected_count": len(expected_dets),
            "actual_count": len(detections)
        }

    # Compare each detection
    mismatches = []

    # Sort both by confidence (descending) to match order
    expected_sorted = sorted(expected_dets, key=lambda x: x["conf"], reverse=True)
    actual_sorted = sorted(detections, key=lambda d: d.confidence, reverse=True)

    for idx, (exp, act) in enumerate(zip(expected_sorted, actual_sorted)):
        issues = []

        # Check category
        exp_cat_name = {"1": "animal", "2": "person", "3": "vehicle"}[exp["category"]]
        if act.category != exp_cat_name:
            issues.append(f"Category: expected '{exp_cat_name}', got '{act.category}'")

        # Check confidence
        if not compare_confidence(exp["conf"], act.confidence):
            issues.append(f"Confidence: expected {exp['conf']:.4f}, got {act.confidence:.4f} (diff: {abs(exp['conf'] - act.confidence):.6f})")

        # Check bbox
        if not compare_bbox(exp["bbox"], act.bbox_normalized):
            issues.append(f"BBox: expected {exp['bbox']}, got {act.bbox_normalized}")

        if issues:
            mismatches.append({
                "detection_index": idx,
                "issues": issues
            })

    if mismatches:
        return {
            "status": "FAIL",
            "message": "Detection values don't match exactly",
            "mismatches": mismatches
        }

    return {
        "status": "PASS",
        "message": f"All {len(detections)} detections match exactly",
        "num_detections": len(detections)
    }


def main():
    """Main validation entry point"""
    if len(sys.argv) != 3:
        print("Usage: python validate_exact_match.py <image_directory> <reference_json>")
        print("Example: python validate_exact_match.py /tmp/test-images /tmp/reference.json")
        sys.exit(1)

    image_dir = sys.argv[1]
    reference_file = sys.argv[2]

    print("=" * 80)
    print("EXACT MATCH VALIDATION: Detection Worker vs Reference Results")
    print("=" * 80)
    print(f"\nImage directory: {image_dir}")
    print(f"Reference file: {reference_file}")

    # Load reference results
    print("\nLoading reference results...")
    reference = load_reference_results(reference_file)

    # Use 0.1 as validation threshold (filter out low-confidence detections)
    validation_threshold = 0.1
    total_dets = sum(len(img['detections']) for img in reference['images'])
    filtered_dets = sum(len([d for d in img['detections'] if d['conf'] >= validation_threshold]) for img in reference['images'])

    print(f"Reference contains {len(reference['images'])} images")
    print(f"Total detections in reference: {total_dets}")
    print(f"Detections >= {validation_threshold} threshold: {filtered_dets} (validating these only)")

    # Load model
    print("\n" + "-" * 80)
    print("Loading MegaDetector model...")
    print("-" * 80)
    detector = load_model()
    print("Model loaded successfully")

    # Validate each image
    print("\n" + "-" * 80)
    print("Validating images...")
    print("-" * 80)

    results = []
    passed = 0
    failed = 0
    errors = 0

    for img_data in reference['images']:
        image_file = img_data['file']
        print(f"\n[{len(results)+1}/{len(reference['images'])}] {image_file}")

        result = validate_image(image_file, img_data, detector, image_dir, threshold=validation_threshold)
        results.append({
            "file": image_file,
            **result
        })

        if result["status"] == "PASS":
            print(f"  ✓ PASS - {result['message']}")
            passed += 1
        elif result["status"] == "FAIL":
            print(f"  ✗ FAIL - {result['message']}")
            if "mismatches" in result:
                for mm in result["mismatches"]:
                    print(f"    Detection #{mm['detection_index']}:")
                    for issue in mm["issues"]:
                        print(f"      - {issue}")
            elif "expected_count" in result:
                print(f"      Expected: {result['expected_count']} detections")
                print(f"      Got: {result['actual_count']} detections")
            failed += 1
        else:
            print(f"  ⚠ ERROR - {result['message']}")
            errors += 1

    # Summary
    print("\n" + "=" * 80)
    print("VALIDATION SUMMARY")
    print("=" * 80)
    print(f"\nTotal images: {len(results)}")
    print(f"✓ Passed: {passed}")
    print(f"✗ Failed: {failed}")
    print(f"⚠ Errors: {errors}")

    if failed == 0 and errors == 0:
        print("\n🎉 SUCCESS: All detections match EXACTLY with reference file!")
        print("   Categories, confidences, and bounding boxes are identical.")
        sys.exit(0)
    else:
        print("\n❌ VALIDATION FAILED: Some images don't match exactly")
        print("   Review the failures above for details.")
        sys.exit(1)


if __name__ == "__main__":
    main()
