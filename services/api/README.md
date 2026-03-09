# API service

FastAPI backend providing the REST API for the platform.

## Responsibilities

- **Authentication** - FastAPI-Users with email verification and JWT
- **REST API** - Images, cameras, detections, classifications, statistics, notifications, exports
- **Database migrations** - Alembic schema management

## Key endpoints

### Authentication
- `POST /auth/register` - Register new user (requires invitation)
- `POST /auth/login` - Login with email/password
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password

### Images
- `GET /api/images` - List images with filters and pagination
- `GET /api/images/{id}` - Get image details with detections

### Cameras
- `GET /api/cameras` - List all cameras
- `GET /api/cameras/{id}` - Get camera details
- `POST /api/cameras` - Create camera

### Statistics
- `GET /api/stats/species` - Species distribution
- `GET /api/stats/timeline` - Image timeline
- `GET /api/stats/cameras` - Per-camera statistics

## Database migrations

```bash
# Create migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

## Configuration

Environment variables:
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `MINIO_ENDPOINT` - MinIO endpoint
- `JWT_SECRET` - JWT signing secret
- `CORS_ORIGINS` - Allowed CORS origins

## Running locally

```bash
docker compose up api
```

API docs available at: http://localhost:8000/docs
