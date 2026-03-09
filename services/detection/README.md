# Detection worker

Runs MegaDetector object detection on camera trap images.

## Responsibilities

- Consume messages from `image-ingested` Redis queue
- Download raw images from MinIO
- Run MegaDetector (md_v1000.0.0-redwood) for object detection
- Detect animals, persons, and vehicles with bounding boxes and confidence scores
- Insert detection records into database
- Update image status (processing → detected / failed)
- Publish to `detection-complete` queue

## Configuration

Environment variables:
- `MODEL_DETECTION_PATH` - Path to model weights
- `USE_GPU` - Enable GPU inference (true/false)
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `MINIO_ENDPOINT` - MinIO endpoint

## Running locally

```bash
docker compose up detection
```
