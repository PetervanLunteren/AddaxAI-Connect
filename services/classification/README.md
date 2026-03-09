# Classification worker

Classifies detected animals into species using DeepFaune.

## Responsibilities

- Consume messages from `detection-complete` Redis queue
- Download raw images from MinIO
- Run DeepFaune v1.4 (ViT-Large + DINOv2) on animal detections
- Predict species (38 European wildlife classes) with confidence scores
- Insert classification records into database
- Generate annotated images and thumbnails
- Apply privacy blur to person/vehicle detections when enabled
- Publish person/vehicle detection events to `notification-events` queue
- Publish to `classification-complete` queue

## Configuration

Environment variables:
- `MODEL_CLASSIFICATION_PATH` - Path to model weights
- `USE_GPU` - Enable GPU inference (true/false)
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `MINIO_ENDPOINT` - MinIO endpoint

## Running locally

```bash
docker compose up classification
```
