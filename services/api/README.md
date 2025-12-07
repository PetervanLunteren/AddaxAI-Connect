# API Service

FastAPI backend providing REST API and WebSocket endpoints.

## Responsibilities

- **Authentication** - FastAPI-Users with email verification and JWT
- **REST API** - Images, cameras, detections, classifications, statistics
- **WebSocket** - Real-time updates for new images and classifications
- **Database Migrations** - Alembic schema management

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user (requires email allowlist)
- `POST /auth/login` - Login with email/password
- `POST /auth/logout` - Logout
- `GET /auth/verify` - Verify email
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password

### Images
- `GET /api/images` - List images with filters and pagination
- `GET /api/images/{id}` - Get image details with detections

### Cameras
- `GET /api/cameras` - List all cameras
- `GET /api/cameras/{id}` - Get camera details
- `POST /api/cameras` - Create camera (Admin only)

### Statistics
- `GET /api/stats/species` - Species distribution
- `GET /api/stats/timeline` - Image timeline
- `GET /api/stats/cameras` - Per-camera statistics

### WebSocket
- `ws://api/updates` - Real-time event stream

## Database Migrations

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

## Running Locally

```bash
docker compose up api
```

API docs available at: http://localhost:8000/docs
