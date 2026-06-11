# Architecture

## Technology stack

| Component | Technology | Notes |
|---|---|---|
| Database | PostgreSQL 15 + PostGIS 3.3 | Spatial queries for GPS coordinates |
| Queue | Redis | FIFO lists with BRPOP, pub/sub for WebSocket events |
| Object storage | MinIO | S3-compatible API, self-hosted; raw images transition to a remote cold tier under a size budget, transparent to readers |
| API | FastAPI | Async Python, automatic OpenAPI docs |
| Authentication | FastAPI-Users | Email verification, password reset, JWT tokens |
| Frontend | React + Vite + TypeScript | Component-based UI with hot reload |
| Reverse proxy | Nginx | TLS termination, static files, request routing |
| Deployment | Ansible + Docker Compose | Automated setup on a single Ubuntu 24.04 VM |
| SSL | Let's Encrypt (certbot) | Free certificates with automatic renewal |
| Email | SMTP | Transactional emails for auth and notifications |

## Data flow

```
FTPS upload
    ↓
Ingestion service
    → validates image (MIME type, magic bytes)
    → extracts EXIF metadata (GPS, timestamp, camera ID)
    → uploads raw image to MinIO
    → creates database record
    → publishes to "image-ingested" queue
         ↓
Detection service
    → downloads image from MinIO
    → runs MegaDetector inference
    → saves bounding boxes and confidence scores
    → publishes to "detection-complete" queue
         ↓
Classification service (DeepFaune or SpeciesNet)
    → crops detected regions
    → classifies species
    → generates annotated images with boxes and labels
    → applies privacy blur to people and vehicles
    → publishes to "classification-complete" queue
         ↓
Notifications service
    → evaluates per-user notification preferences
    → creates audit log entries
    → routes to delivery channels:
         → notification-email queue → Email worker (SMTP)
         → notification-telegram queue → Telegram worker (Bot API)
    → runs scheduled jobs:
         → daily battery digests
         → daily/weekly/monthly email reports
         → excessive image alerts
         → project inactivity alerts
```

## Services

All services run as Docker containers on a single host, connected through a shared bridge network.

### Infrastructure
- **PostgreSQL + PostGIS** is the central database for all application data
- **Redis** handles message queues between services and pub/sub for real-time WebSocket events
- **MinIO** provides S3-compatible storage for raw images, crops, thumbnails, and annotated images. Recent raw images live on the server; older ones transition to a remote cold tier under a configurable size budget. Reads remain transparent via the local MinIO API.

### Application
- **API** (FastAPI, port 8000) serves REST endpoints, WebSocket connections, and authentication. Interactive API docs (Swagger UI) are available at `/api/docs` on your server.

![Swagger UI](https://github.com/user-attachments/assets/e0942b03-9d3c-4843-bcd0-aac592eb2276)

- **Frontend** (React via Nginx, port 3000) is the web interface

### Workers
- **Ingestion** watches the FTPS upload directory for new files
- **Detection** runs MegaDetector object detection
- **Classification** identifies species (DeepFaune or SpeciesNet, selected via Docker Compose profile)
- **Notifications** evaluates rules and runs scheduled jobs
- **Notifications-email** delivers emails via SMTP
- **Notifications-telegram** delivers messages via Telegram Bot API

## Docker Compose profiles

The `docker-compose.yml` uses profiles to support different configurations:

- **`deepfaune`** is the full stack with DeepFaune classifier (38 European species)
- **`speciesnet`** is the full stack with SpeciesNet classifier (2,498 global species)
- **`demo`** runs only the API, database, and frontend (no ML workers, for demos and development)

## Data storage

By default, all data stays on your own server. PostgreSQL holds the metadata (projects, cameras, detections, users), and MinIO holds the image files (raw images, thumbnails, crops, annotated images). Neither is reachable from the internet.

Two optional features copy data to a remote S3-compatible bucket:

- **Cold storage tier**. When the raw images on local disk grow past a configurable budget, the oldest ones move to a remote bucket. Reads stay transparent, MinIO fetches cold objects on demand. Thumbnails, crops, and annotated images always stay on the server. See [operations](operations.md#cold-storage-tier).
- **Daily backups**. A nightly job dumps the database and mirrors all image buckets to a separate remote bucket, so a lost server can be rebuilt from the backup alone. See the [restore guide](restore-guide.md).

You choose the remote provider yourself. Any S3-compatible service works (Wasabi, AWS S3, Backblaze B2, and similar). You bring your own buckets and access keys, so the remote data stays under your own account. The system is developed and tested with [Wasabi](https://wasabi.com), and the servers hosted by Addax Data Science and Smart Parks store their cold images and backups on Wasabi as well.

Security of the remote storage:

- All transfers to the remote bucket go over HTTPS.
- Access keys are scoped to a single bucket with minimal permissions. The backup key has no delete permission.
- Cold tier and backups use separate buckets with separate keys, so one leaked key never exposes both.
- The backup bucket keeps old versions of every object for 90 days, so an accidental overwrite or a compromised server cannot silently destroy the backup history.
- Objects are stored as-is, encryption at rest is handled by the provider. Wasabi encrypts all stored data at rest by default.

## Security

The system uses multiple layers of protection:

- **Network isolation**: PostgreSQL, Redis, and MinIO are only accessible within the Docker network, not exposed to the internet
- **TLS everywhere**: Nginx terminates HTTPS with Let's Encrypt certificates, FTPS uses explicit TLS
- **Authentication on all services**: password protection on the database, Redis, MinIO, and FTPS
- **Firewall**: UFW restricts inbound traffic to SSH, HTTP/HTTPS, and FTPS ports only
- **Role-based access control**: three-tier permission system (server admin, project admin, project viewer)

## User roles

Three levels of access:

- **Server admin** has full access to all projects, can create projects and manage all users
- **Project admin** manages specific projects and can invite users to their projects
- **Project viewer** has read-only access to assigned projects

Users can have different roles across different projects. The initial server admin is created during deployment. Other users are invited through the web interface.
