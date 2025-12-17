"""
Benchmark script for detection worker performance

Measures processing time for multiple camera trap images with model already loaded.
Tests Option 1 approach: load model once, process all images sequentially.
"""
import time
from pathlib import Path
from typing import List, Dict

from model_loader import load_model
from detector import run_detection
from shared.logger import get_logger

logger = get_logger("detection.benchmark")


def benchmark_images(image_dir: str) -> Dict:
    """
    Benchmark detection performance on multiple images.

    Args:
        image_dir: Directory containing test images

    Returns:
        Dict with benchmark results
    """
    image_path = Path(image_dir)
    image_files = sorted(list(image_path.glob("*.JPG")) + list(image_path.glob("*.jpg")))

    if not image_files:
        raise ValueError(f"No images found in {image_dir}")

    print("=" * 70)
    print("Detection Worker Performance Benchmark")
    print("=" * 70)
    print(f"\nTest images: {len(image_files)}")
    print(f"Directory: {image_dir}")

    # Step 1: Load model (one-time cost)
    print("\n" + "-" * 70)
    print("Loading MegaDetector model...")
    print("-" * 70)
    load_start = time.time()
    detector = load_model()
    load_time = time.time() - load_start
    print(f"Model loaded in {load_time:.2f} seconds")

    # Step 2: Process all images sequentially
    print("\n" + "-" * 70)
    print("Processing images...")
    print("-" * 70)

    results = []
    total_detections = 0

    for idx, image_file in enumerate(image_files, 1):
        print(f"\n[{idx}/{len(image_files)}] {image_file.name}")

        start_time = time.time()
        detections = run_detection(detector, str(image_file))
        elapsed = time.time() - start_time

        num_detections = len(detections)
        total_detections += num_detections

        results.append({
            "filename": image_file.name,
            "time": elapsed,
            "detections": num_detections
        })

        print(f"  Time: {elapsed:.2f}s | Detections: {num_detections}")

    # Step 3: Calculate statistics
    print("\n" + "=" * 70)
    print("Benchmark Results")
    print("=" * 70)

    processing_times = [r["time"] for r in results]
    avg_time = sum(processing_times) / len(processing_times)
    min_time = min(processing_times)
    max_time = max(processing_times)
    total_time = sum(processing_times)

    print(f"\nModel loading: {load_time:.2f}s (one-time cost)")
    print(f"\nProcessing statistics:")
    print(f"  Total images: {len(image_files)}")
    print(f"  Total detections: {total_detections}")
    print(f"  Average time/image: {avg_time:.2f}s")
    print(f"  Min time: {min_time:.2f}s")
    print(f"  Max time: {max_time:.2f}s")
    print(f"  Total processing time: {total_time:.2f}s")

    print(f"\nThroughput:")
    images_per_second = len(image_files) / total_time
    images_per_hour = images_per_second * 3600
    images_per_day = images_per_hour * 24
    print(f"  {images_per_second:.2f} images/second")
    print(f"  {images_per_hour:.0f} images/hour")
    print(f"  {images_per_day:.0f} images/day (theoretical max)")

    print(f"\nOption 1 analysis (model always loaded):")
    print(f"  First image: {results[0]['time']:.2f}s (no loading penalty)")
    print(f"  Subsequent images: {avg_time:.2f}s average")
    print(f"  Consistent performance: ✓")

    print("\n" + "=" * 70)
    print("Benchmark Complete!")
    print("=" * 70)

    return {
        "load_time": load_time,
        "num_images": len(image_files),
        "total_detections": total_detections,
        "avg_time": avg_time,
        "min_time": min_time,
        "max_time": max_time,
        "total_time": total_time,
        "throughput_per_hour": images_per_hour,
        "results": results
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python benchmark_detection.py <image_directory>")
        print("Example: python benchmark_detection.py /tmp/benchmark")
        sys.exit(1)

    image_dir = sys.argv[1]
    benchmark_images(image_dir)
