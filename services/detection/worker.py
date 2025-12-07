"""
Detection Worker

Consumes images from the ingestion queue, runs object detection, and produces crops.
"""

def main():
    print("Detection worker starting...")
    # TODO: Load detection model from /models/detection.pt
    # TODO: Subscribe to image-ingested queue
    # TODO: Download image from MinIO
    # TODO: Run detection model
    # TODO: Generate bounding boxes and crops
    # TODO: Save crops to MinIO
    # TODO: Insert detections into database
    # TODO: Publish to detection-complete queue
    pass


if __name__ == "__main__":
    main()
