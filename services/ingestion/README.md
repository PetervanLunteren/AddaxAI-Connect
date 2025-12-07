# Ingestion Service

Watches for new camera trap images uploaded via FTPS and processes them into the ML pipeline.

## Responsibilities

- Monitor FTPS upload directory using `watchdog`
- Validate image files (MIME type, magic bytes)
- Generate UUID for each image
- Upload raw images to MinIO (`raw-images` bucket)
- Create database record in `images` table
- Publish message to `image-ingested` Redis queue

## Configuration

Environment variables:
- `FTPS_UPLOAD_DIR` - Directory to watch for new uploads
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `MINIO_ENDPOINT` - MinIO server endpoint

## Running Locally

```bash
docker compose up ingestion
```
