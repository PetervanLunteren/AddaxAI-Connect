# Ingestion service

Watches for new camera trap images and daily reports uploaded via FTPS and processes them into the system.

## Responsibilities

- Monitor FTPS upload directory using `watchdog`
- Validate image files (MIME type, magic bytes)
- Extract EXIF metadata (GPS, timestamp, dimensions)
- Generate UUID and upload raw images to MinIO (`raw-images` bucket)
- Generate and upload thumbnails to MinIO
- Create database record in `images` table
- Publish message to `image-ingested` Redis queue
- Parse daily reports (battery, signal, SD card, temperature)
- Update camera health records from daily reports
- Clean up rejected files older than 30 days

## Configuration

Environment variables:
- `FTPS_UPLOAD_DIR` - Directory to watch for new uploads
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `MINIO_ENDPOINT` - MinIO server endpoint

## Running locally

```bash
docker compose up ingestion
```
