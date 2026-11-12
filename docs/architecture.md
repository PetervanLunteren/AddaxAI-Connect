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
Classification service (the species model of the image's project)
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

Ingestion also groups images into cameras, sites, and deployments from their GPS, and reports each decision in the camera updates feed. See [sites and cameras](sites-and-deployments.md) for how that works.

### Workers
- **Ingestion** watches the FTPS upload directory for new files
- **Detection** runs MegaDetector object detection
- **Classification** identifies species with the model each project picked at creation. One worker serves every model and loads each one on its first image
- **Notifications** evaluates rules and runs scheduled jobs
- **Notifications-email** delivers emails via SMTP
- **Notifications-telegram** delivers messages via Telegram Bot API
- **Notifications-earthranger** posts events to an EarthRanger site through Gundi
- **Notifications-sensingclues** posts observations into a Sensing Clues group through Central

## Docker Compose profiles

The `docker-compose.yml` uses profiles to support different configurations:

- **`full`** is the whole stack. `deepfaune` and `speciesnet` are aliases from before projects picked their own model; servers deployed then still have one of them in `.env` until Ansible rewrites it.
- **`demo`** runs only the API, database, and frontend (no ML workers, for demos and development)

On a server with an NVIDIA GPU, `docker-compose.gpu.yml` is layered on top through `COMPOSE_FILE` in `.env` (written by Ansible when `use_gpu` is true). It gives the detection and classification workers the GPU; everything else is unchanged.

## Data storage

By default, all data stays on your own server. PostgreSQL holds the metadata (projects, cameras, detections, users), and MinIO holds the image files (raw images, thumbnails, crops, annotated images). Neither is reachable from the internet.

Two optional features copy data to a remote S3-compatible bucket:

- **Cold storage tier**. When the raw images on local disk grow past a configurable budget, the oldest ones move to a remote bucket. Reads stay transparent, MinIO fetches cold objects on demand. Thumbnails, crops, and annotated images always stay on the server. See [operations](operations.md#cold-storage-tier).
- **Daily backups**. A nightly job dumps the database and mirrors all image buckets to a separate remote bucket, so a lost server can be rebuilt from the backup alone. See the [restore guide](restore-guide.md).

You choose the remote provider yourself. Any S3-compatible service works (Wasabi, AWS S3, Backblaze B2, and similar). You bring your own buckets and access keys, so the remote data stays under your own account. The system is developed and tested with [Wasabi](https://wasabi.com). Where the servers hosted by Addax Data Science and Smart Parks keep their data is on the [hosted service](hosted-service.md) page.

## Security

How the system and its backups are protected is on the [security](security.md) page.

## User roles

Three levels of access:

- **Server admin** has full access to all projects and manages all users
- **Project admin** manages specific projects, can invite users to their projects, and can create a new project (becoming its admin). Deleting a project stays with the server admin.
- **Project viewer** has read-only access to assigned projects

Users can have different roles across different projects. The initial server admin is created during deployment. Other users are invited through the web interface.
