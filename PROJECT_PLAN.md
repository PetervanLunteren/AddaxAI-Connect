# AddaxAI Connect - Project Plan

**Status:** Phase 1 Complete (~90%) | Phase 2 In Progress (~25%)
**Last Updated:** December 17, 2024
**Target:** Production-ready camera trap platform with AI processing pipeline

---

## 🎯 Current Status Summary

**Overall Progress: ~60-65% Complete**

### ✅ What's Working
- **Infrastructure** (Phase 1): PostgreSQL, Redis, MinIO, monitoring stack
- **API Backend**: FastAPI with health checks, CORS, database middleware
- **Authentication**: FastAPI-Users with email verification, password reset, allowlist system
- **Shared Library**: Complete utilities for logging, database, queue, storage, config
- **Structured Logging**: JSON logs with correlation IDs, frontend→backend logging, Loki integration
- **Ingestion Service**: Full FTPS ingestion with camera profiles, EXIF parsing, daily reports, health updates

### ⚠️ In Progress / Partial
- **Camera Management Schema**: Basic tables exist, extended features (projects, sims, placement_plans, maintenance_tasks, unknown_devices) not yet implemented
- **RBAC**: Role field exists but middleware/decorator not implemented
- **Dead-Letter Queue**: Not implemented for failed jobs
- **Frontend**: Basic auth pages exist, dashboard needs completion

### ❌ Critical Gaps
- **Detection Worker**: Not implemented (blocks end-to-end pipeline)
- **Classification Worker**: Not implemented (blocks end-to-end pipeline)
- **Alert Worker**: Not implemented
- **Unit Tests**: Missing across all services
- **Prometheus Metrics**: /metrics endpoints not exposed
- **Development Setup**: docs/development.md missing, no docker-compose.dev.yml

### 📋 Recommended Next Steps
1. **Implement Detection Worker** (5-6 days) - Critical for MVP
2. **Implement Classification Worker** (4-5 days) - Critical for MVP
3. **End-to-End Testing** (2-3 days) - Validate complete pipeline
4. **Add Dead-Letter Queue** (1-2 days) - Production reliability
5. **Complete Frontend Dashboard** (5-7 days) - User-facing features

---

IMPORTANT: This document is a draft plan. It is not set in stone. Things can change down the line if we start working on it. Its important to know that this PROJECT_PLAN.md was created at the start, and contains the initial general ideas. It is not set in stone, we can always divert from the plan if we think that is best. Never blindly follow that plan, always keep thinking and asking questions. If we divert from the plan, make sure to update it accordingly. 

---

## Executive Summary

This document outlines the complete plan to build AddaxAI Connect: a near real-time camera trap platform that automatically processes images through ML models and provides a web interface for visualization and analysis.

**Goal:** Build a robust, scalable system that processes hundreds of camera trap images per day, runs detection and classification models, and presents results through an interactive web dashboard.

- **Deployment:** Ubuntu VM (DigitalOcean)
- **Image Volume:** ~hundreds per day (few hundred)
- **Processing SLA:** Under 1 minute per image
- **Users:** 1-10 concurrent users
- **Team Size:** Solo or small team (2 people)
- **Models:** Custom trained detection and classification models (sequential pipeline)

---

## Architecture Overview

### System Design

**Monorepo Approach:** All services in a single Git repository with logical separation via Docker containers.

**Core Components:**
1. **FTPS Ingestion Service** (Python) - Watches for new images from camera traps
2. **Detection Worker** (Python + PyTorch/TF) - Runs object detection model
3. **Classification Worker** (Python + PyTorch/TF) - Classifies detected animals
4. **Alert Worker** (Python) - Checks alert rules and sends notifications
5. **API Backend** (FastAPI) - REST API and WebSocket server
6. **Frontend** (React + Vite) - Interactive web application
7. **Message Queue** (Redis) - Decouples services for scalability
8. **Object Storage** (MinIO) - S3-compatible storage for images
9. **Database** (PostgreSQL + PostGIS) - Structured data with spatial queries
10. **Monitoring Stack** (Prometheus + Loki) - Metrics and logs

### Data Flow Diagram

```
┌─────────────────┐
│  FTPS Server    │
│   (Remote)      │
│  Camera Traps   │
└────────┬────────┘
         │
         │ New images uploaded via FTPS
         │
         ▼
┌────────────────────────────┐
│  Ingestion Service         │
│  - Watches FTPS dir        │
│  - Validates images        │
|  - Check for daily reports |
│  - Generates UUIDs         │
└──────────┬─────────────────┘
           │
           ├──────────────────────────┐
           │                          │
           │ Save raw image           │ Publish message
           ▼                          ▼
    ┌─────────────┐          ┌──────────────────┐
    │   MinIO     │          │  Redis Queue     │
    │ raw-images  │          │ "image-ingested" │
    └─────────────┘          └────────┬─────────┘
                                      │
                                      │ BRPOP (blocking pop)
                                      ▼
                             ┌──────────────────────┐
                             │  Detection Worker    │
                             │  - Load from MinIO   │
                             │  - Run YOLO/etc      │
                             │  - Generate bboxes   │
                             │  - Crop animals      │
                             └──────┬───────────────┘
                                    │
                    ┌───────────────┼──────────────┐
                    │               │              │
                    │ Save crops    │ Save         │ Publish
                    │               │ detections   │ message
                    ▼               ▼              ▼
            ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐
            │   MinIO     │  │ PostgreSQL   │  │   Redis Queue        │
            │   crops     │  │ detections   │  │ "detection-complete" │
            └─────────────┘  │   table      │  └──────────┬───────────┘
                             └──────────────┘             │
                                                          │ BRPOP
                                                          ▼
                                              ┌────────────────────────┐
                                              │ Classification Worker  │
                                              │ - Load crops           │
                                              │ - Run ResNet/etc       │
                                              │ - Predict species      │
                                              └──────┬─────────────────┘
                                                     │
                                   ┌─────────────────┼─────────────────┐
                                   │                 │                 │
                                   │ Save            │ Generate        │ Publish
                                   │ classifications │ thumbnail       │ message
                                   ▼                 ▼                 ▼
                            ┌───────────────┐  ┌─────────────┐  ┌──────────────────────────┐
                            │ PostgreSQL    │  │   MinIO     │  │    Redis Queue           │
                            │classifications│  │ thumbnails  │  │ "classification-complete"│
                            │    table      │  └─────────────┘  └────────┬─────────────────┘
                            └───────┬───────┘                            │
                                    │                                    │ SUBSCRIBE
                                    │                                    ▼
                                    │                          ┌──────────────────────┐
                                    │                          │   Alert Worker       │
                                    │                          │  - Check rules       │
                                    │                          │  - Send notifications│
                                    │                          └──────┬───────────────┘
                                    │                                 │
                                    │                                 │ Signal/Email/
                                    │                                 │ WhatsApp/ER
                                    │                                 ▼
                                    │                          ┌──────────────────┐
                                    │                          │  Notifications   │
                                    │                          │  (External APIs) │
                                    │                          └──────────────────┘
                                    │
                                    │ SQL Queries
                                    │
                                    ▼
                            ┌────────────────────┐
                            │   FastAPI Backend  │
                            │   - REST API       │◄──────────────┐
                            │   - WebSocket      │               │
                            │   - JWT Auth       │               │
                            │   - Alert API      │               │
                            │   port 8000        │               │
                            └──────────┬─────────┘               │
                                       │                         │
                                       │ HTTP + WebSocket        │
                                       │                         │
                                       ▼                         │
                            ┌────────────────────┐               │
                            │  React Frontend    │               │
                            │  - Image Gallery   │               │
                            │  - Maps            │               │
                            │  - Statistics      │               │
                            │  - Alert Rules     │───────────────┘
                            │  - Bounding Boxes  │
                            │  Nginx (port 80)   │
                            └──────────┬─────────┘
                                       │
                                       │ HTTPS
                                       ▼
                            ┌────────────────────┐
                            │   End Users        │
                            │   (Web Browser)    │
                            └────────────────────┘

         ┌───────────────────────────────────────────────┐
         │         Monitoring Stack                      │
         │                                               │
         │  ┌──────────────┐    ┌──────────────┐         │
         │  │  Prometheus  │    │   Loki       │         │
         │  │  - Scrapes   │    │  - Logs      │         │
         │  │    metrics   │    │    from all  │         │
         │  │    /metrics  │    │    services  │         │
         │  │  port 9090   │    │  port 3100   │         │
         │  └──────────────┘    └──────────────┘         │
         └───────────────────────────────────────────────┘
```

### Detailed Data Flow Steps

**1. Image Upload:**
- Camera trap uploads image to FTPS server
- Ingestion service detects new file via `watchdog`

**2. Ingestion:**
- Validate image (MIME type, magic bytes)
- Generate UUID for image
- Upload raw image to MinIO (`raw-images` bucket)
- Create record in `images` table (status: 'pending')
- Publish message to `image-ingested` queue with image metadata

**3. Object Detection:**
- Detection worker pulls message from `image-ingested` queue
- Download image from MinIO
- Update image status to 'processing'
- Run detection model (YOLO, Faster R-CNN, etc.)
- Extract bounding boxes and confidence scores
- Crop each detected animal from image
- Save crops to MinIO (`crops` bucket)
- Insert detection records into `detections` table
- Publish message to `detection-complete` queue with crop paths

**4. Classification:**
- Classification worker pulls message from `detection-complete` queue
- For each crop:
  - Download crop from MinIO
  - Run classification model (ResNet, EfficientNet, etc.)
  - Get species prediction and confidence score
  - Insert into `classifications` table
- Generate thumbnail for web display
- Save thumbnail to MinIO (`thumbnails` bucket)
- Update image status to 'completed'
- Publish message to `classification-complete` queue

**5. Alert Processing:**
- Alert worker subscribes to `classification-complete` queue
- For each completed classification:
  - Check active alert rules in `alert_rules` table
  - If rule matches (e.g., species = "wolf", battery < 20%):
    - Send notification via configured method (Signal, Email, WhatsApp, EarthRanger)
    - Log alert to `alert_logs` table
- For batched alerts, scheduler groups and sends at configured intervals

**6. Web Access:**
- User logs into React frontend
- Frontend fetches data from FastAPI backend
- API queries PostgreSQL for image metadata, detections, classifications
- API generates presigned URLs for MinIO objects (images, thumbnails)
- Frontend displays images with bounding boxes and species labels

**7. Real-time Updates:**
- Frontend opens WebSocket connection to API
- API subscribes to Redis pub/sub channels
- When new events occur (`image_ingested`, `detection_complete`, etc.)
- API broadcasts to connected WebSocket clients
- Frontend updates UI in real-time

**8. Monitoring:**
- All services expose `/metrics` endpoint (Prometheus format)
- Prometheus scrapes metrics every 15 seconds
- All services log to stdout using structlog (JSON format with `request_id` + `image_id` correlation)
- Promtail collects logs and sends to Loki
- Can view Prometheus metrics at port 9090 and Loki logs at port 3100
- Query logs by correlation IDs: `{service="detection"} | json | image_id="abc-123"`

### Technology Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Ingestion | Python + watchdog | Simple file monitoring |
| Detection | Python + PyTorch/TF (Docker) | Custom model support, isolated env |
| Classification | Python + PyTorch/TF (Docker) | Separate dependencies, isolated env |
| Queue | Redis | Fast, simple pub/sub |
| Storage | MinIO | S3-compatible, self-hosted |
| Database | PostgreSQL + PostGIS | Spatial queries, robust |
| API | FastAPI | Python, async, auto docs |
| Authentication | FastAPI-Users | Production-ready auth, email verification, JWT |
| Email | Gmail SMTP | Simple setup, reliable delivery |
| Frontend | React + Vite | Modern, fast dev experience |
| Orchestration | Docker Compose | Simple multi-container mgmt |
| Monitoring | Prometheus + Loki + structlog | Metrics and structured JSON logs |
| Registry | GitHub Container Registry | Free, private Docker image storage |

---

## ML Model Architecture: Isolated & Swappable

### Key Design Decisions

**1. Completely Isolated Environments**

Detection and classification workers run in **separate Docker containers** with completely isolated dependencies:

For example:
```
services/detection/
├── Dockerfile           # FROM pytorch/pytorch:2.0.1-cuda11.8-cudnn8-runtime
├── requirements.txt     # torch==2.0.1, opencv-python, pillow
├── worker.py
└── model_loader.py

services/classification/
├── Dockerfile           # FROM tensorflow/tensorflow:2.13.0-gpu
├── requirements.txt     # tensorflow==2.13.0, pillow, numpy
├── worker.py
└── model_loader.py
```

**2. Model Storage & Loading**

**Model weights are NOT stored in Docker images** (would make images huge: 2-5GB per model).

Instead, models are:
- Stored on **Hugging Face** (primary source)
- Cached in **MinIO `models/` bucket** (optional, for faster loading)
- Downloaded on **worker startup** and cached locally

```
MinIO Buckets:
├── raw-images/          # Uploaded camera trap images
├── crops/               # Cropped animals
├── thumbnails/          # Web thumbnails
└── models/              # Model weights cache (optional)
    └── project-serengeti/
        ├── detection.pt      # Downloaded from Hugging Face
        └── classification.h5
```

**Worker startup flow:**
```python
# In detection worker
import torch
from huggingface_hub import hf_hub_download

MODEL_HF_REPO = os.getenv("MODEL_HF_REPO", "username/serengeti-detection")
MODEL_CACHE = Path("/cache")

def load_model():
    cache_path = MODEL_CACHE / "detection.pt"

    if not cache_path.exists():
        print(f"Downloading model from Hugging Face: {MODEL_HF_REPO}")
        # Download from Hugging Face
        model_path = hf_hub_download(
            repo_id=MODEL_HF_REPO,
            filename="model.pt",
            cache_dir=str(MODEL_CACHE)
        )
        print("Download complete!")
    else:
        print("Using cached model")

    # Load model (auto-detects GPU vs CPU)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = torch.load(cache_path, map_location=device)
    return model
```

---

## Docker Registry Strategy

### GitHub Container Registry (ghcr.io)

**What goes in the registry?**
- ✅ Docker images with **code + dependencies** (~500MB-2GB each):
  - `ghcr.io/yourusername/addaxai-connect-detection:latest`
  - `ghcr.io/yourusername/addaxai-connect-classification:latest`
  - `ghcr.io/yourusername/addaxai-connect-api:latest`
  - `ghcr.io/yourusername/addaxai-connect-frontend:latest`
- ❌ **NOT model weights** (stored in MinIO or downloaded from Hugging Face)
- ❌ **NOT data** (images, database)
- ❌ **NOT configs** (.env files)

### Development Workflow

**1. Build images locally:**
```bash
# Build all services
docker compose build

# Test locally
docker compose up -d
```

**2. Push to GitHub Container Registry:**
```bash
# Login (one-time setup)
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Push images
docker compose push
```

**docker-compose.yml configuration:**
```yaml
services:
  detection-worker:
    image: ghcr.io/yourusername/addaxai-connect-detection:latest
    build: ./services/detection
    # ...

  classification-worker:
    image: ghcr.io/yourusername/addaxai-connect-classification:latest
    build: ./services/classification
    # ...

  api:
    image: ghcr.io/yourusername/addaxai-connect-api:latest
    build: ./services/api
    # ...

  frontend:
    image: ghcr.io/yourusername/addaxai-connect-frontend:latest
    build: ./services/frontend
    # ...
```

### Production Deployment Workflow

**On production VM:**
```bash
# Clone repo
git clone https://github.com/yourusername/addaxai-connect.git
cd addaxai-connect

# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull latest images (no building needed!)
docker compose pull

# Start services
docker compose up -d
```

**Update to latest version:**
```bash
# Pull code changes
git pull

# Pull new images
docker compose pull

# Restart with new images
docker compose up -d
```

### CI/CD with GitHub Actions (Optional)

Automate image building on every push:

**.github/workflows/build-and-push.yml:**
```yaml
name: Build and Push Docker Images

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build-and-push:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push all images
        run: |
          docker compose build
          docker compose push

      - name: Logout
        run: docker logout ghcr.io
```

Now every `git push` automatically builds and uploads new images!

## Docker stuff
We're going to build the containers directly on VM to avoid the hassle with repos.

### Build Directly on VM (Simpler for Initial Development)

If you want to **skip the registry initially**:

```bash
# On production VM
git clone repo
cd repo

# Build directly on VM
docker compose up -d --build
```

**Pros:**
- ✅ No registry setup needed
- ✅ Simpler for single VM

**Cons:**
- ❌ Slow (builds on production)
- ❌ Doesn't work for multi-VM (GPU + main VM)
- ❌ Can't easily roll back to previous versions

---

## Project Phases

### Phase 1: Foundation & Infrastructure
**Goal:** Set up development environment and core infrastructure

### Phase 2: ML Pipeline
**Goal:** Implement image processing pipeline with ML models

### Phase 3: Web Application
**Goal:** Build web interface for viewing and managing data

### Phase 4: Monitoring & Security
**Goal:** Add observability and secure the platform

### Phase 5: Testing & Deployment
**Goal:** Test thoroughly and deploy to production

### Phase 6: Iteration & Optimization
**Goal:** Monitor, tune, and add features based on feedback

---

## Detailed Implementation Plan

## Phase 1: Foundation & Infrastructure

### 1.1 Repository Structure
✅ **COMPLETE** - Repository structure established with services/, shared/, models/, monitoring/, ansible/, scripts/, docs/

---

### 1.2 Database Setup
- [x] Create `docker-compose.yml` service for PostgreSQL + PostGIS
- [x] Design database schema:
  - [x] `images` table (id, filename, camera_id, uploaded_at, storage_path, status)
  - [x] `cameras` table (id, name, location as geography, installed_at, config)
  - [x] `detections` table (id, image_id, bbox, confidence, crop_path)
  - [x] `classifications` table (id, detection_id, species, confidence)
  - [x] `users` table (id, email, hashed_password, is_active, is_verified, is_superuser) - FastAPI-Users schema
  - [x] `email_allowlist` table (id, email, domain, added_by_user_id, created_at) - for registration control
  - [x] `alert_rules` table (id, name, rule_type, condition, notification_method, is_active, created_at)
  - [x] `alert_logs` table (id, rule_id, triggered_at, details, status)
- [x] Set up Alembic for migrations in `services/api/`
- [x] Create initial migration with all tables
- [x] Add indexes:
  - [x] `images(camera_id, uploaded_at DESC)`
  - [x] `images(status)`
  - [x] `images(uuid)` - unique index
  - [x] `classifications(species)`
  - [x] `classifications(detection_id)`
  - [x] `detections(image_id)`
  - [x] `users(email)` - unique index
  - [x] `email_allowlist(email)` - unique index
  - [x] PostGIS spatial index on `cameras(location)` - auto-created by GeoAlchemy2

**Deliverable:** ✅ PostgreSQL running with complete schema

---

### 1.3 Object Storage Setup
- [x] Add MinIO service to `docker-compose.yml`
- [x] Configure MinIO with persistent volumes
- [x] Create initialization script to set up buckets:
  - [x] `raw-images`
  - [x] `crops`
  - [x] `thumbnails`
  - [x] `models`
- [x] Test S3 client connectivity (boto3)
- [x] Create `shared/shared/storage.py` with MinIO client wrapper

**Deliverable:** ✅ MinIO running with all buckets created

---

### 1.4 Message Queue Setup
- [x] Add Redis service to `docker-compose.yml`
- [x] Configure Redis with AOF persistence
- [x] Test queue operations (push/pop)
- [x] Document queue naming convention:
  - [x] `image-ingested`
  - [x] `detection-complete`
  - [x] `classification-complete`
  - [ ] `failed-jobs` (not yet implemented - dead-letter queue missing)
- [x] Create `shared/shared/queue.py` with RedisQueue wrapper (FIFO implementation)

**Deliverable:** ✅ Redis running and ready for queue operations (dead-letter queue pending)

---

### 1.5 Shared Python Utilities
- [x] Create `shared/shared/` directory (installable package)
- [x] Implement common utilities:
  - [x] `models.py` - SQLAlchemy models (shared across services)
  - [x] `queue.py` - Redis queue wrapper with RedisQueue class
  - [x] `storage.py` - MinIO/S3 wrapper with MinIOClient class
  - [x] `config.py` - Environment variable loading with Pydantic Settings
  - [x] `logger.py` - Structured JSON logging with correlation IDs (`request_id`, `image_id`, `user_id`)
  - [x] `database.py` - SQLAlchemy session management
- [x] Make shared library installable as package (`pyproject.toml` with dependencies)

**Deliverable:** ✅ Reusable utilities for all services

---

### 1.6 API Backend Scaffold
- [x] Create `services/api/` structure:
  ```
  api/
  ├── Dockerfile
  ├── requirements.txt
  ├── main.py
  ├── routers/
  │   ├── admin.py
  │   └── logs.py
  ├── auth/           # FastAPI-Users auth
  │   ├── routes.py
  │   ├── manager.py
  │   └── schemas.py
  ├── middleware/     # Custom middleware
  │   └── logging.py
  ├── mailer/         # Email utilities
  ├── alembic/        # Migrations
  └── schemas/        # Pydantic schemas (partial)
  ```
- [x] Set up FastAPI app with basic structure
- [x] Implement database connection pooling (via middleware injection)
- [x] Create basic health check endpoints: `GET /` and `GET /health`
- [x] Add CORS middleware
- [x] Set up structured JSON logging with RequestLoggingMiddleware

**Deliverable:** ✅ FastAPI running with health check endpoint

---

### 1.7 Authentication System (FastAPI-Users)
- [x] Install FastAPI-Users: `pip install fastapi-users[sqlalchemy]`
- [x] Configure FastAPI-Users with SQLAlchemy models:
  - [x] Create User model (extends FastAPI-Users base) in `shared/shared/models.py`
  - [x] Add `project_id` field for multi-project support
  - [x] Add `role` field (Admin, Analyst, Viewer) for RBAC
  - [x] Set up UserManager with custom logic in `services/api/auth/manager.py`
- [x] Configure email allowlist system:
  - [x] Create `email_allowlist` table migration
  - [x] Implement allowlist validation in registration flow
  - [x] Support both specific emails and domain patterns (e.g., `@university.edu`)
- [x] Configure SMTP for transactional emails:
  - [x] Set up environment variables (MAIL_SERVER, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD)
  - [x] Configure email sender utility in `services/api/mailer/`
- [x] Implement authentication endpoints (via FastAPI-Users):
  - [x] `POST /auth/register` - Email/password registration with allowlist check
  - [x] `POST /auth/jwt/login` - Email/password login
  - [x] `POST /auth/jwt/logout` - Logout
  - [x] `POST /auth/request-verify-token` - Request verification email
  - [x] `POST /auth/verify` - Email verification
  - [x] `POST /auth/forgot-password` - Request password reset
  - [x] `POST /auth/reset-password` - Reset password with token
  - [x] `GET /users/me` - Get current user info
- [x] Create email templates in `services/api/mailer/templates.py`:
  - [x] Welcome email with verification link
  - [x] Password reset email
- [x] Implement allowlist management endpoints (Admin only) in `services/api/routers/admin.py`:
  - [x] `POST /api/admin/allowlist` - Add email or domain to allowlist
  - [x] `GET /api/admin/allowlist` - List allowed emails/domains
  - [x] `DELETE /api/admin/allowlist/{id}` - Remove from allowlist
- [ ] Add RBAC middleware:
  - [ ] Check user role on protected endpoints
  - [ ] Define role permissions (Admin, Analyst, Viewer)
  - [ ] Implement `@requires_role` decorator
- [ ] Create initial admin user script: `scripts/create_admin_user.py`
- [x] Password requirements:
  - [x] Minimum 8 characters
  - [x] Validated by FastAPI-Users
- [ ] Write authentication tests

**Deliverable:** ✅ Working authentication system with FastAPI-Users, email verification, password reset, and allowlist-based registration (RBAC middleware pending)

---

### 1.8 Local Development Setup
- [ ] Document local setup in `docs/development.md` (missing)
- [x] Create production Docker Compose (`docker-compose.yml`)
- [ ] Create development Docker Compose with:
  - [ ] Hot reload for API (mount source code)
  - [ ] Development database with test data
  - [ ] Exposed ports for debugging
- [x] Test full stack startup works (production compose on VM)
- [x] Verify services are healthy (PostgreSQL, Redis, MinIO, API, Ingestion, Frontend)

**Deliverable:** ⚠️ Partially complete - Production Docker Compose works, but development setup and documentation missing

---

### 1.9 Structured Logging System

**Goal:** Implement centralized structured logging with correlation IDs for easy debugging across all services

#### Overview
- Use **structlog** for JSON-formatted logs
- All logs flow to **Loki** (already deployed via Promtail)
- **Correlation IDs:**
  - `request_id` - Technical tracing (per API call / worker operation)
  - `image_id` - Business tracing (track one image through pipeline)
- **Frontend logs** sent to backend `/api/logs` endpoint
- **LOG_LEVEL** environment variable (INFO default, DEBUG optional)
- **Prometheus alerts** on error rate spikes

#### 1.9.1 Shared Logger Utility
- [x] Create `shared/shared/logger.py`:
  - [x] Configure python-json-logger with JSON renderer
  - [x] Add processor for auto-injecting `service`, `timestamp`, `level`
  - [x] Support for `request_id`, `image_id`, and `user_id` in log context via ContextVars
  - [x] Read `LOG_LEVEL` from environment (default: INFO)
  - [x] Export `get_logger(service_name)` function
  - [x] StructuredLogger wrapper for keyword argument support
- [x] Add `python-json-logger` dependency to `shared/pyproject.toml`
- [ ] Write unit tests for logger utility

#### 1.9.2 Update Backend Services
- [x] Update `services/api/main.py`:
  - [x] Import and use shared logger
  - [x] Add RequestLoggingMiddleware to generate `request_id` for each API call
  - [x] Auto-inject `request_id` into all log messages within request scope
- [x] Create `/api/logs` endpoint in `services/api/routers/logs.py`:
  - [x] Accept JSON payload: `{level, message, context}`
  - [x] Log frontend messages to backend log stream
  - [x] Include `user_id` if authenticated
  - [ ] Rate limit to prevent abuse (100 logs/min per user) - not implemented
- [x] Update existing API routers to use shared logger
- [x] Add `LOG_LEVEL` to docker-compose.yml environment

#### 1.9.3 Frontend Logging
- [x] Create `services/frontend/src/utils/logger.ts`:
  - [x] Console wrapper that also sends to `/api/logs`
  - [x] Methods: `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
  - [x] Auto-capture unhandled errors and promise rejections in `main.tsx`
  - [x] Include page URL, user agent in context
- [ ] Replace console.log usage in critical paths (minimal usage currently)
- [x] Add error boundary component for React error capturing (`ErrorBoundary.tsx`)

#### 1.9.4 Worker Services
- [x] Ingestion service uses shared logger with `image_id` correlation (implemented)
- [ ] Detection worker (not yet implemented)
- [ ] Classification worker (not yet implemented)

#### 1.9.5 Prometheus Alerts
- [ ] Update `monitoring/prometheus-alerts.yml`:
  - [ ] Alert: Error rate > 5 errors/min for 5 minutes
  - [ ] Alert: Critical errors (level=CRITICAL) > 1 in 1 minute
  - [ ] Alert: Any service logging zero messages (service down)
- [ ] Configure Alertmanager webhook (future: to Alert Worker)

#### 1.9.6 Documentation
- [x] Create `docs/logging.md`:
  - [x] How to use shared logger in new services
  - [x] Loki query examples:
    - `{service="detection"} | json | level="ERROR"`
    - `{service="detection"} | json | image_id="abc-123"`
    - `{service="api"} | json | request_id="xyz-789"`
    - `{} | json | level="CRITICAL"` (all critical errors)
  - [x] How to toggle log levels (LOG_LEVEL env var)
  - [x] Frontend logging best practices
- [x] Add logging section to README.md

**Deliverable:** ✅ Centralized structured logging system with correlation IDs, fully implemented and documented (minor items pending: rate limiting, Prometheus alerts)

---

## Phase 1.10: Camera Management Schema Extension

**Goal:** Extend database with field operations and camera lifecycle management capabilities

### 1.10.1 Database Schema for Camera Management
- [ ] Create `projects` table (tenant isolation via project_id) - NOT IMPLEMENTED
  - Name, description, default settings/firmware references
  - Maintenance thresholds (battery_low_threshold, sd_high_threshold, silence_threshold_hours)
  - Default placement values (FOV, range)
- [ ] Extend `cameras` table with camera management fields - BASIC SCHEMA EXISTS but needs extension
  - **Identifiers:** `serial_number` (IMEI), `imei`, `manufacturer`, `model`, `hardware_revision`
  - **Assignment:** `project_id` (FK), `status` (inventory/assigned/deployed/suspended/retired)
  - **Health metrics:** `battery_percent`, `sd_used_mb`, `sd_total_mb`, `temperature_c`, `signal_quality`
  - **Timestamps:** `last_seen`, `last_daily_report_at`, `last_image_at`, `last_maintenance_at`
  - **Metadata:** `tags` (JSON), `notes` (text), `created_at`, `updated_at`
  - **Indexes:** serial_number (unique), imei (unique), project_id, status, last_seen, manufacturer, model
- [ ] Add `project_id` to existing tables:
  - [ ] Add `users.project_id` with FK and index (schema has field, not FK)
  - [ ] Add `images.project_id` with FK and index
- [ ] Create `sims` table (SIM inventory) - NOT IMPLEMENTED
- [ ] Create `camera_sim_assignments` table (assignment history) - NOT IMPLEMENTED
- [ ] Create `settings_profiles` table (offline settings, project-scoped) - NOT IMPLEMENTED
- [ ] Create `firmware_releases` table (offline firmware, project-scoped) - NOT IMPLEMENTED
- [ ] Create `placement_plans` table (planned vs actual placement) - NOT IMPLEMENTED
- [ ] Create `maintenance_tasks` table (task management) - NOT IMPLEMENTED
- [ ] Create `unknown_devices` table (quarantine queue) - NOT IMPLEMENTED
- [x] Create Alembic migration scripts (basic schema exists)
- [x] Run migration on dev database
- [ ] Verify all tables created, indexes exist, foreign keys enforced
- [x] Basic models exist in `shared/shared/models.py` (Image, Camera, Detection, Classification, User, EmailAllowlist, AlertRule, AlertLog)
- [ ] Write unit tests for model relationships

**Deliverable:** ❌ NOT COMPLETE - Basic schema exists but extended camera management features not implemented

**Estimated Time:** 2-3 days (still required)

---

## Phase 2: ML Pipeline

### 2.1 FTPS Ingestion Service (Enhanced for Camera Management)
- [x] Create `services/ingestion/` structure:
  ```
  ingestion/
  ├── Dockerfile
  ├── requirements.txt
  ├── main.py                 # Main watcher loop ✅
  ├── validators.py           # File validation ✅
  ├── exif_parser.py          # EXIF extraction ✅
  ├── camera_profiles.py      # Camera profile detection ✅
  ├── db_operations.py        # Database operations ✅
  ├── storage_operations.py   # MinIO operations ✅
  ├── daily_report_parser.py  # Daily report parsing ✅
  ├── utils.py                # Rejection/error handling ✅
  └── tests/                  # NOT IMPLEMENTED
  ```
- [x] **File type detection:**
  - [x] Images: `*.jpg`, `*.jpeg` (case-insensitive)
  - [x] Daily reports: `*.txt` files
  - [x] Unknown files: reject to `/uploads/rejected/unsupported_file_type/`
- [x] **Daily report parser** (`daily_report_parser.py`):
  - [x] Parse key:value format from TXT file
  - [x] Extract: IMEI, battery%, SD usage, temperature, signal quality
  - [x] Extract: GPS coordinates, timestamp, image counts
  - [x] Validate data types and handle malformed reports
- [x] **Image EXIF parser** (`exif_parser.py`):
  - [x] Use `exiftool` to extract EXIF metadata
  - [x] Extract: Serial Number, GPS, Make, Model, DateTime
  - [x] Handle missing EXIF fields gracefully
  - [x] Convert GPS to decimal degrees
- [x] **Camera identifier matching** (via camera profiles):
  - [x] Identify camera profile from EXIF (Willfine, SY, extensible)
  - [x] Extract camera ID per profile rules
  - [x] Query `cameras` table to get/create camera
  - [x] Duplicate detection by camera_id + filename + datetime
- [ ] **Unknown device handling** - NOT FULLY IMPLEMENTED
  - [ ] `unknown_devices` table doesn't exist yet
  - [x] Rejects unsupported cameras to rejection directory
- [x] **Update camera health from daily reports:**
  - [x] Update battery, SD, temperature, signal via `update_camera_health()`
  - [x] Implements flag_modified() for JSONB updates
  - [ ] Placement plan updates not implemented (table doesn't exist)
  - [ ] Maintenance threshold checks not implemented
- [x] **Process images:**
  - [x] Validate image file (MIME type via libmagic)
  - [x] Generate UUID for image
  - [x] Upload to MinIO (`raw-images` bucket)
  - [x] Create record in `images` table (status: 'pending')
  - [x] Extract GPS from EXIF if present
  - [x] Link to camera via profile-detected camera_id
  - [x] Publish message to `image-ingested` queue
- [x] Handle errors with rejection system (move to rejection subdirectories by reason)
- [x] Implement file system watcher with `watchdog` library
  - [x] Watch `/uploads` directory for new files
  - [x] Debounce: 0.5s wait after file created
  - [x] Delete processed files (not moved)
  - [x] Rejected files moved to categorized subdirectories
- [x] Use shared logger with `image_id` correlation
- [ ] Expose `/metrics` endpoint for Prometheus - NOT IMPLEMENTED
- [ ] Write unit tests - NOT IMPLEMENTED

**Deliverable:** ✅ Core ingestion service fully functional (images + daily reports + camera profiles + health updates). Missing: unit tests, metrics endpoint, unknown_devices table integration, placement plans, maintenance thresholds

**Estimated Time:** COMPLETED (additional 1-2 days for remaining items)

---

### 2.2 Detection Worker - Part 1 (Infrastructure)
- [ ] Create `services/detection/` structure:
  ```
  detection/
  ├── Dockerfile          # Base image with PyTorch/TensorFlow
  ├── requirements.txt
  ├── worker.py           # Queue consumer
  ├── model.py            # Model loading and inference
  ├── config.py
  └── tests/
  ```
- [ ] Set up Dockerfile with GPU support (CUDA, optional)
- [ ] Implement Redis queue consumer (BRPOP on `image-ingested`)
- [ ] Implement message processing loop with:
  - [ ] Fetch image from MinIO
  - [ ] Load image into memory
  - [ ] Update image status to 'processing'
  - [ ] Error handling with dead-letter queue
- [ ] Use shared logger (from Phase 1.9) with `request_id` (per message) and `image_id` correlation

**Deliverable:** Detection worker consuming messages (no model yet)

---

### 2.3 Detection Worker - Part 2 (Model Integration)
- [ ] Implement model loading in `model.py`:
  - [ ] Load model weights from `/models/detection.pt`
  - [ ] Support GPU and CPU modes (configurable)
  - [ ] Model warmup on startup
- [ ] Implement inference:
  - [ ] Run detection model on image
  - [ ] Extract bounding boxes and confidence scores
  - [ ] Filter detections by confidence threshold (e.g., >0.5)
- [ ] Implement cropping:
  - [ ] Crop detected animals from image
  - [ ] Save crops to MinIO (`crops` bucket)
  - [ ] Generate crop filenames: `{image_id}_{detection_idx}.jpg`
- [ ] Store results:
  - [ ] Insert detections into `detections` table (bbox, confidence, crop_path)
  - [ ] Publish message to `detection-complete` queue with crop paths
  - [ ] Update image status to 'detected'
- [ ] Log all steps with shared logger (model load time, inference time, detection count, errors)
- [ ] Write unit tests with mock model

**Deliverable:** Detection worker processing images and generating crops

---

### 2.4 Classification Worker
- [ ] Create `services/classification/` structure (similar to detection)
- [ ] Set up Dockerfile with different ML environment (TensorFlow if detection used PyTorch, or vice versa)
- [ ] Implement Redis queue consumer (BRPOP on `detection-complete`)
- [ ] Implement model loading:
  - [ ] Load classification model from `/models/classification.pt`
  - [ ] Support GPU and CPU modes
- [ ] Implement inference:
  - [ ] Fetch crop from MinIO
  - [ ] Run classification model
  - [ ] Get species prediction and confidence
- [ ] Store results:
  - [ ] Insert into `classifications` table (species, confidence)
  - [ ] Publish to `classification-complete` queue
  - [ ] Update image status to 'completed'
- [ ] Generate thumbnail:
  - [ ] Resize image for web display
  - [ ] Save to MinIO (`thumbnails` bucket)
- [ ] Use shared logger (from Phase 1.9) with `request_id` and `image_id` correlation
- [ ] Log all steps (model load, inference time, species predictions, confidence scores, errors)
- [ ] Write unit tests with mock model

**Deliverable:** Classification worker completing the pipeline

---

### 2.5 End-to-End Pipeline Testing
- [ ] Create test images with known objects
- [ ] Upload test image via FTPS
- [ ] Monitor pipeline execution:
  - [ ] Verify ingestion picks up image
  - [ ] Verify detection runs and creates crops
  - [ ] Verify classification runs on crops
  - [ ] Verify database records are created
  - [ ] Verify all files are in MinIO buckets
- [ ] Test error scenarios:
  - [ ] Corrupted image file
  - [ ] Model inference failure
  - [ ] Database connection lost
  - [ ] MinIO unavailable
- [ ] Verify retry logic and dead-letter queue
- [ ] Document pipeline behavior in `docs/pipeline.md`

**Deliverable:** Fully working ML pipeline from FTPS to database

---

### 2.6 Maintenance Task Engine

**Goal:** Automatically generate maintenance tasks based on camera health thresholds

#### 2.6.1 Maintenance Monitor Background Service
- [ ] Create `services/maintenance-monitor/` structure:
  ```
  maintenance-monitor/
  ├── Dockerfile
  ├── requirements.txt
  ├── main.py              # Background scheduler loop
  ├── threshold_checker.py # Threshold logic
  ├── task_creator.py      # Task creation with cooldown
  └── tests/
  ```
- [ ] **Background scheduler:**
  - Run every 15 minutes (configurable via env var)
  - Query all cameras with recent data (last_seen within past week)
  - For each camera: Check health against project thresholds
  - Use APScheduler or simple while loop with sleep
- [ ] **Battery threshold check:**
  - If `cameras.battery_percent < project.battery_low_threshold`:
    - Create task: type='battery_replacement'
    - Priority: 'high' if <10%, 'medium' if <20%, otherwise 'low'
    - Reason: "Battery at {battery_percent}% (threshold: {threshold}%)"
    - Origin: 'system'
- [ ] **SD utilization threshold check:**
  - Calculate: `sd_percent = (cameras.sd_used_mb / cameras.sd_total_mb) * 100`
  - If `sd_percent > project.sd_high_threshold`:
    - Create task: type='sd_swap'
    - Priority: 'high' if >95%, 'medium' if >80%, otherwise 'low'
    - Reason: "SD card at {sd_percent:.0f}% full (threshold: {threshold}%)"
    - Origin: 'system'
- [ ] **Silence threshold check (no daily reports):**
  - Calculate: `hours_silent = (now - cameras.last_daily_report_at).total_seconds() / 3600`
  - If `hours_silent > project.silence_threshold_hours`:
    - Create task: type='connectivity_investigation'
    - Priority: 'high' if >72h, 'medium' if >48h, otherwise 'low'
    - Reason: "No daily report for {hours_silent:.0f} hours (threshold: {threshold}h)"
    - Origin: 'system'
- [ ] **Cooldown logic to prevent duplicate tasks:**
  - Before creating task: Check if similar task already exists
  - Query: `WHERE camera_id=X AND task_type=Y AND status IN ('open','planned','in_progress') AND created_at > (now - 24 hours)`
  - If exists: Skip creation (don't spam duplicate tasks)
  - If not exists: Create new task
- [ ] **Task creation helper:**
  - Insert into `maintenance_tasks` table
  - Set: camera_id, project_id, task_type, priority, origin='system', reason, status='open'
  - Set: created_at to now
  - Log: "Created maintenance task: {task_type} for camera {serial_number}"
- [ ] Use shared logger (from Phase 1.9) with `request_id` for each check cycle
- [ ] Log tasks created, checks performed, thresholds exceeded, errors
- [ ] Expose `/metrics` endpoint for Prometheus (tasks created per type, checks per minute)
- [ ] Write unit tests:
  - Test threshold checks with mock camera data
  - Test cooldown logic (no duplicates)
  - Test task priority calculation
  - Mock database for testing

**Deliverable:** Automated maintenance task generation from health thresholds

**Estimated Time:** 3-4 days

---

## Phase 3: Web Application

### 3.1 Images API
- [ ] Implement `GET /api/images`:
  - [ ] Query parameters: `camera_id`, `date_from`, `date_to`, `species`, `status`, `page`, `limit`, `sort`, `order`
  - [ ] Return paginated list with thumbnails
  - [ ] Include detection and classification counts
  - [ ] Add response caching (Redis, 1 minute TTL)
- [ ] Implement `GET /api/images/{id}`:
  - [ ] Return full image details
  - [ ] Include all detections with bounding boxes
  - [ ] Include all classifications with species and confidence
  - [ ] Generate presigned URL for image download
- [ ] Implement `POST /api/images/{id}/approve`:
  - [ ] Update image approval status
  - [ ] Log action in audit_logs
  - [ ] Require Analyst or Admin role
- [ ] Write API tests

**Deliverable:** Images API with filtering and pagination

---

### 3.2 Cameras API
- [ ] Implement `GET /api/cameras`:
  - [ ] Return list of all cameras
  - [ ] Include location as GeoJSON
  - [ ] Include last_image_at timestamp
  - [ ] Include image count per camera
- [ ] Implement `GET /api/cameras/{id}`:
  - [ ] Return camera details
  - [ ] Include recent images (last 10)
- [ ] Implement `POST /api/cameras` (Admin only):
  - [ ] Create new camera
  - [ ] Validate location coordinates
- [ ] Implement `PUT /api/cameras/{id}` (Admin only):
  - [ ] Update camera config
- [ ] Write API tests

**Deliverable:** Cameras API with spatial data

---

### 3.3 Statistics API
- [ ] Implement `GET /api/stats/species`:
  - [ ] Aggregate classifications by species
  - [ ] Filter by camera_id, date_from, date_to
  - [ ] Return `{species: count}` map
  - [ ] Cache results (5 minutes)
- [ ] Implement `GET /api/stats/timeline`:
  - [ ] Group images by time interval (hour/day/week/month)
  - [ ] Filter by camera_id, date_from, date_to
  - [ ] Return array of `{timestamp, count}` objects
  - [ ] Cache results (5 minutes)
- [ ] Implement `GET /api/stats/cameras`:
  - [ ] Per-camera statistics (image count, species count, last active)
  - [ ] Cache results (5 minutes)
- [ ] Write API tests

**Deliverable:** Statistics API with aggregations

---

### 3.4 WebSocket Real-time Updates
- [ ] Implement WebSocket endpoint: `ws://api/updates`
- [ ] Authenticate WebSocket connections (JWT in query param)
- [ ] Subscribe to Redis pub/sub channels:
  - `image_ingested`
  - `detection_complete`
  - `classification_complete`
- [ ] Broadcast events to connected clients:
  - Event type
  - Payload (image_id, camera_id, species, etc.)
- [ ] Handle client disconnections gracefully
- [ ] Test WebSocket with multiple clients

**Deliverable:** Real-time updates via WebSocket

---

### 3.5 Frontend Scaffold
- [ ] Create `services/frontend/` structure:
  ```
  frontend/
  ├── Dockerfile
  ├── package.json
  ├── vite.config.js
  ├── index.html
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── api/
  │   │   └── client.js      # Axios instance
  │   ├── hooks/
  │   │   ├── useAuth.js
  │   │   ├── useImages.js
  │   │   └── useWebSocket.js
  │   ├── components/
  │   ├── pages/
  │   └── styles/
  └── tests/
  ```
- [ ] Set up Vite with React
- [ ] Install dependencies:
  - `react`, `react-router-dom`
  - `axios`, `@tanstack/react-query` (or `swr`)
  - `leaflet`, `react-leaflet`
  - `chart.js`, `react-chartjs-2`
  - `tailwindcss` (or `@mui/material`)
  - `zustand` (or `jotai`) for state management
- [ ] Set up Tailwind CSS (or Material-UI)
- [ ] Configure routing with React Router
- [ ] Create Axios client with JWT interceptor

**Deliverable:** Frontend scaffold with routing and API client

---

### 3.6 Authentication UI
- [ ] Create Login page:
  - [ ] Email and password form
  - [ ] Submit to `POST /api/auth/login`
  - [ ] Store JWT in memory (not localStorage)
  - [ ] Redirect to dashboard on success
- [ ] Create `useAuth` hook:
  - [ ] Login/logout functions
  - [ ] Current user state
  - [ ] Token refresh logic
- [ ] Create protected route wrapper (redirect to login if not authenticated)
- [ ] Add logout button in header

**Deliverable:** Working login/logout flow

---

### 3.7 Image Gallery View
- [ ] Create Gallery page:
  - [ ] Grid layout with thumbnail images
  - [ ] Lazy loading with Intersection Observer
  - [ ] Pagination controls (previous/next, page numbers)
  - [ ] Click image to open detail modal
- [ ] Create Filters sidebar:
  - [ ] Date range picker (date_from, date_to)
  - [ ] Camera dropdown (multi-select)
  - [ ] Species dropdown (multi-select)
  - [ ] Confidence slider
  - [ ] Status filter (pending, processing, completed)
  - [ ] Apply/Reset buttons
- [ ] Fetch images with `useImages` hook (React Query)
- [ ] Show loading skeletons while fetching

**Deliverable:** Image gallery with filters and pagination

---

### 3.8 Image Detail View
- [ ] Create ImageDetail modal/page:
  - [ ] Display full-size image
  - [ ] Canvas overlay for bounding boxes:
    - [ ] Draw rectangles from detection bboxes
    - [ ] Color-code by species
    - [ ] Show species label + confidence on hover
  - [ ] Metadata panel:
    - [ ] Camera name and location
    - [ ] Upload timestamp
    - [ ] Processing status
    - [ ] Number of detections
  - [ ] Detections list:
    - [ ] Show all detections with species and confidence
    - [ ] Click to highlight bounding box
  - [ ] Approval buttons (Analyst role):
    - [ ] Approve
    - [ ] Reject
    - [ ] Flag for review
  - [ ] Navigation: Previous/Next image buttons
- [ ] Implement bounding box drawing with Canvas API

**Deliverable:** Image detail view with bounding boxes

---

### 3.9 Map View
- [ ] Create Map page:
  - [ ] Initialize Leaflet map with OpenStreetMap tiles
  - [ ] Fetch cameras from `GET /api/cameras`
  - [ ] Plot camera markers on map (GeoJSON coordinates)
  - [ ] Add camera popup with info:
    - [ ] Camera name
    - [ ] Last image timestamp
    - [ ] Total images
    - [ ] Link to view recent images
  - [ ] Optional: Heatmap overlay for detection density
- [ ] Add map controls:
  - [ ] Date range filter
  - [ ] Species filter
  - [ ] Zoom to fit all cameras button

**Deliverable:** Interactive map with camera locations

---

### 3.10 Statistics Dashboard
- [ ] Create Stats page:
  - [ ] Summary cards:
    - [ ] Total images processed
    - [ ] Unique species count
    - [ ] Active cameras count
    - [ ] Images processed today
  - [ ] Species distribution pie chart (Chart.js):
    - [ ] Fetch from `GET /api/stats/species`
    - [ ] Interactive legend
  - [ ] Timeline graph:
    - [ ] Fetch from `GET /api/stats/timeline`
    - [ ] Line/bar chart of detections over time
    - [ ] Interval selector (hour/day/week/month)
  - [ ] Top cameras by activity:
    - [ ] Fetch from `GET /api/stats/cameras`
    - [ ] Bar chart or table
  - [ ] Filters:
    - [ ] Date range
    - [ ] Camera selection
- [ ] Add auto-refresh (every 30 seconds)

**Deliverable:** Statistics dashboard with charts

---

### 3.11 Real-time Updates Integration
- [ ] Create `useWebSocket` hook:
  - [ ] Connect to `ws://api/updates?token={jwt}`
  - [ ] Listen for events: `image_ingested`, `detection_complete`, `classification_complete`
  - [ ] Update UI state on new events
- [ ] Add toast notifications on new events:
  - "New image uploaded from Camera X"
  - "Detection complete for Image Y"
  - "Classification complete: 2 lions detected"
- [ ] Invalidate React Query cache on relevant events
- [ ] Show live indicator in header ("Live" badge when WebSocket connected)

**Deliverable:** Real-time UI updates via WebSocket

---

### 3.12 Admin User Management (Optional)
- [ ] Create Admin page:
  - [ ] List all users (table)
  - [ ] Create new user (form)
  - [ ] Edit user role (dropdown)
  - [ ] Delete user (with confirmation)
  - [ ] Show audit log (recent actions)
- [ ] Require Admin role for access

**Deliverable:** User management interface for admins

---

### 3.9 Camera Management Frontend

**Goal:** Build field operations UI for camera lifecycle management

**Reference:** See `docs/camera-management-spec.md` for detailed specifications

#### 3.9.1 Camera Registry Page
- [ ] Searchable camera list DataTable (columns: Serial #, Name, Project, Status, Battery %, SD %, Last Seen, Location)
- [ ] Filters: project, status, manufacturer, model, last-seen date range, battery range, SD range
- [ ] Search by serial number, name, IMEI
- [ ] Bulk actions: Assign to project, change status, export CSV
- [ ] Import Cameras CSV button with validation
- [ ] Create Camera button (modal form)
- [ ] Pagination (50 cameras per page)

**Estimated Time:** 2 days

#### 3.9.2 Camera Detail Page
- [ ] Section: Identifiers (Serial #, IMEI, Make, Model, Hardware Rev) with edit
- [ ] Section: Assignment & Status (Project link, status badge, dates) with actions
- [ ] Section: Health Metrics (Battery gauge, SD progress bar, Temp, Signal) with charts over time
- [ ] Section: Location & Map (Leaflet map with marker, lat/lon display)
- [ ] Section: Timestamps (Last Seen, Last Daily Report, Last Image, Last Maintenance)
- [ ] Section: Assigned SIM (ICCID, Provider, Status, Subscription End) with assign/unassign actions
- [ ] Section: Settings & Firmware (Current profile, Target firmware) with download buttons and instructions
- [ ] Section: Placement Plan (Planned vs Actual on map, deviation calculation)
- [ ] Section: Maintenance Tasks (Open tasks table) with create task button
- [ ] Section: History (accordion with Project/SIM/Settings/Firmware history)
- [ ] Action buttons: Edit, Delete (admin), View All Images

**Estimated Time:** 3 days

#### 3.9.3 Placement Planning Map
- [ ] Leaflet map with OpenStreetMap tiles
- [ ] Display camera markers: Planned (blue), Actual (green), No plan (grey)
- [ ] Color-code by status: deployed=green, planned=yellow, offline=red
- [ ] Marker popups: Camera name, Serial #, Battery %, SD %, Last Seen, link to detail
- [ ] Add Placement Plan mode: Select camera, click map, form for bearing/range/FOV
- [ ] Edit Placement Plan: Click marker, modal to update or drag marker
- [ ] Show deviation: Dashed line between planned/actual with distance label
- [ ] Filters: Show All / Planned Only / Actual Only / Deviation > X meters
- [ ] Side panel with camera list (click to center map)

**Estimated Time:** 2-3 days

#### 3.9.4 Maintenance List Page
- [ ] Summary cards: Critical Tasks, High Priority, Overdue, Completed This Week
- [ ] Maintenance tasks table with filters (priority, status, type, assigned to, due date, camera)
- [ ] Expandable rows: Click to show full reason, resolution notes, history
- [ ] Actions: Change Status, Assign To, Add Notes, Mark Complete
- [ ] Bulk actions: Assign selected, change status
- [ ] Create Task button (modal form)
- [ ] Sorting: Priority, Due Date, Created Date
- [ ] Pagination (50 tasks per page)

**Estimated Time:** 2-3 days

#### 3.9.5 SIM Inventory Page
- [ ] SIM list DataTable (ICCID, Provider, Status, Subscription Type, End Date, Assigned Camera)
- [ ] Filters: Provider, Status, Subscription Type, Expiring Soon, Assigned/Unassigned
- [ ] Search by ICCID or MSISDN
- [ ] Import SIMs CSV button
- [ ] Create SIM button (modal form)
- [ ] Actions per row: View Detail, Assign to Camera, Unassign, Edit, Delete
- [ ] SIM Detail Modal with assignment history

**Estimated Time:** 1-2 days

#### 3.9.6 Settings Profiles Library
- [ ] Settings profiles list (project-scoped): Name, Version, Status, Compatible Models, Created At
- [ ] Create Profile button: Upload file, metadata form, install instructions (Markdown)
- [ ] Actions: Download File, View Instructions, Edit (metadata only), Change Status, Assign to Cameras, Delete
- [ ] Filters: Status, Compatible Models
- [ ] Search by name or version

**Estimated Time:** 1-2 days

#### 3.9.7 Firmware Releases Library
- [ ] Firmware releases list (project-scoped): Version, Date, Status, Criticality, Compatible Models
- [ ] Create Release button: Upload file (auto-calculate checksum), metadata form, release notes, instructions
- [ ] Actions: Download File (with checksum display), View Notes, View Instructions, Edit, Change Status, Assign to Cameras, Delete
- [ ] Warning for Recalled status
- [ ] Client-side checksum verification after download
- [ ] Filters: Status, Criticality, Compatible Models

**Estimated Time:** 1-2 days

#### 3.9.8 Unknown Devices Queue (Admin Only)
- [ ] Unknown devices list: Serial #, First Contact, Last Contact, Count, Make, Model, GPS
- [ ] Admin-only route guard
- [ ] Auto-refresh every 30 seconds
- [ ] Claim Device action: Modal form (assign to project, camera name, optional SIM assignment)
- [ ] Ignore action (marks claimed without creating camera)
- [ ] Filters: Claimed/Unclaimed, date range
- [ ] Alert badge: "X Unclaimed Devices"

**Estimated Time:** 1 day

#### 3.9.9 Camera Onboarding Page (Field Technician)
- [ ] Mobile-optimized UI (large touch targets, responsive)
- [ ] Barcode scan input using `html5-qrcode` library (camera-based)
- [ ] Manual serial number input fallback
- [ ] Lookup camera endpoint call
- [ ] If not found: "Camera Not Registered" with create option
- [ ] If found: Onboarding checklist (Project, SIM, Settings, Firmware, Placement)
- [ ] Download buttons for settings/firmware files
- [ ] Install instructions (collapsible Markdown sections)
- [ ] Placement guidance: Show planned location on map, coordinates, bearing
- [ ] Mark as Deployed button with deployment form (installer name, notes, photo upload)
- [ ] Success screen with summary

**Estimated Time:** 2-3 days

**Total Frontend Estimated Time:** 15-20 days

---

### 3.11 Camera Management API Endpoints

**Goal:** Build REST API for all camera management functionality

**Reference:** See `docs/camera-management-spec.md` for detailed endpoint specifications

#### 3.11.1 Projects API
- [ ] `GET /api/projects` - List all projects (paginated)
- [ ] `POST /api/projects` - Create new project (admin only)
- [ ] `GET /api/projects/{id}` - Get project detail with defaults and thresholds
- [ ] `PUT /api/projects/{id}` - Update project metadata, defaults, thresholds (admin only)
- [ ] `DELETE /api/projects/{id}` - Delete project (admin only, if no cameras assigned)
- [ ] `GET /api/projects/{id}/cameras` - List all cameras in project
- [ ] `GET /api/projects/{id}/placement-plans` - Get all placement plans for project (map data)
- [ ] `GET /api/projects/{id}/maintenance-list` - Get prioritized maintenance list for project

#### 3.11.2 Cameras API (Extended)
- [ ] `GET /api/cameras` - List cameras with filters (project_id, status, manufacturer, model, last_seen_after, battery_lt, sd_gt, search)
- [ ] `POST /api/cameras` - Create camera
- [ ] `POST /api/cameras/bulk-import` - Bulk import from CSV
- [ ] `GET /api/cameras/{id}` - Get camera detail with all relationships
- [ ] `PUT /api/cameras/{id}` - Update camera metadata
- [ ] `DELETE /api/cameras/{id}` - Delete camera (admin only)
- [ ] `POST /api/cameras/{id}/assign-to-project` - Assign camera to project
- [ ] `POST /api/cameras/{id}/change-status` - Change camera status
- [ ] `GET /api/cameras/{id}/history` - Get assignment and change history

#### 3.11.3 SIMs API
- [ ] `GET /api/sims` - List SIMs with filters (provider, status, expiring_within_days, assigned, project_id)
- [ ] `POST /api/sims` - Create SIM
- [ ] `POST /api/sims/bulk-import` - Bulk import from CSV
- [ ] `GET /api/sims/{id}` - Get SIM detail with assignment history
- [ ] `PUT /api/sims/{id}` - Update SIM metadata
- [ ] `DELETE /api/sims/{id}` - Delete SIM (only if not assigned)
- [ ] `POST /api/sims/{id}/assign-to-camera` - Assign SIM to camera
- [ ] `POST /api/sims/{id}/unassign` - Unassign SIM from current camera

#### 3.11.4 Settings Profiles API
- [ ] `GET /api/settings-profiles` - List profiles for project
- [ ] `POST /api/settings-profiles` - Create profile with file upload (multipart/form-data)
- [ ] `GET /api/settings-profiles/{id}` - Get profile detail
- [ ] `GET /api/settings-profiles/{id}/download` - Generate presigned MinIO URL
- [ ] `PUT /api/settings-profiles/{id}` - Update metadata (not file)
- [ ] `POST /api/settings-profiles/{id}/change-status` - Change status
- [ ] `DELETE /api/settings-profiles/{id}` - Delete profile (only if status=draft)

#### 3.11.5 Firmware Releases API
- [ ] `GET /api/firmware-releases` - List releases for project
- [ ] `POST /api/firmware-releases` - Create release with file upload + checksum calculation
- [ ] `GET /api/firmware-releases/{id}` - Get release detail
- [ ] `GET /api/firmware-releases/{id}/download` - Generate presigned MinIO URL + return checksum
- [ ] `PUT /api/firmware-releases/{id}` - Update metadata
- [ ] `POST /api/firmware-releases/{id}/change-status` - Change status (validate Recalled)
- [ ] `DELETE /api/firmware-releases/{id}` - Delete release (only if status=draft)

#### 3.11.6 Placement Plans API
- [ ] `GET /api/placement-plans` - List plans for project
- [ ] `POST /api/placement-plans` - Create plan for camera
- [ ] `GET /api/placement-plans/{id}` - Get plan detail
- [ ] `PUT /api/placement-plans/{id}` - Update plan or actual placement
- [ ] `GET /api/placement-plans/{id}/deviation` - Calculate deviation (distance + bearing difference)
- [ ] `DELETE /api/placement-plans/{id}` - Delete plan (admin only)

#### 3.11.7 Maintenance Tasks API
- [ ] `GET /api/maintenance-tasks` - List tasks with filters (project_id, camera_id, task_type, priority, status, assigned_to, due_before)
- [ ] `POST /api/maintenance-tasks` - Create task manually
- [ ] `GET /api/maintenance-tasks/{id}` - Get task detail with history
- [ ] `PUT /api/maintenance-tasks/{id}/status` - Change status with resolution notes
- [ ] `POST /api/maintenance-tasks/{id}/assign` - Assign task to user
- [ ] `DELETE /api/maintenance-tasks/{id}` - Cancel/delete task

#### 3.11.8 Unknown Devices API (Admin Only)
- [ ] `GET /api/unknown-devices` - List unknown devices (claimed=false for unclaimed)
- [ ] `GET /api/unknown-devices/{id}` - Get unknown device detail
- [ ] `POST /api/unknown-devices/{id}/claim` - Claim device (create camera record)
- [ ] `POST /api/unknown-devices/{id}/ignore` - Mark as claimed without creating camera

#### 3.11.9 Onboarding API (Field Technician)
- [ ] `POST /api/onboarding/lookup-camera` - Lookup camera by serial_number with onboarding checklist
- [ ] `POST /api/onboarding/mark-deployed` - Mark camera as deployed with metadata

#### 3.11.10 API Implementation Details
- [ ] Use FastAPI with Pydantic schemas for request/response validation
- [ ] RBAC: Admin-only endpoints (projects CRUD, unknown devices, delete actions)
- [ ] Project-scoped queries: Filter by user's project_id (except admin sees all)
- [ ] File uploads: Use `UploadFile` from FastAPI
- [ ] MinIO upload helper: Use `shared/shared/storage.py`
- [ ] Presigned URLs: Expire after 1 hour
- [ ] Error handling: 404 not found, 403 forbidden, 400 validation errors
- [ ] Pagination: offset/limit with default limit=50, max limit=200
- [ ] Sorting: Support `sort_by` and `order` query params
- [ ] Write API tests: Use pytest with test database

**Deliverable:** Complete REST API for camera management with 40+ endpoints

**Estimated Time:** 8-10 days

---

## Phase 4: Monitoring & Security

### 4.1 Prometheus Setup
- [ ] Add Prometheus service to `docker-compose.yml`
- [ ] Create `monitoring/prometheus.yml` config:
  - [ ] Scrape targets for all services
  - [ ] Scrape interval: 15 seconds
  - [ ] Retention: 15 days
- [ ] Add Prometheus metrics endpoints to services:
  - [ ] FastAPI: Use `prometheus-fastapi-instrumentator`
  - [ ] Python workers: Use `prometheus-client`
  - [ ] Expose metrics at `/metrics` endpoint
- [ ] Define custom metrics:
  - Queue depth per queue (gauge)
  - Processing time per stage (histogram)
  - Success/failure counts (counter)
  - Images processed per hour (gauge)

**Deliverable:** Prometheus collecting metrics from all services

---

### 4.2 Prometheus Queries & Monitoring
- [ ] Document useful Prometheus queries in `docs/monitoring.md`:
  - [ ] Queue depth: `redis_queue_depth{queue="image-ingested"}`
  - [ ] Processing time: `histogram_quantile(0.95, detection_processing_seconds)`
  - [ ] Throughput: `rate(images_processed_total[1h])`
  - [ ] Success vs failure rate: `rate(processing_errors_total[5m])`
  - [ ] CPU/memory usage: `container_cpu_usage_seconds_total`, `container_memory_usage_bytes`
- [ ] Access Prometheus UI at `http://localhost:9090`
- [ ] Set up Prometheus alerts in `monitoring/prometheus-alerts.yml`:
  - [ ] Queue depth > 100 for 5 minutes
  - [ ] Any service down > 1 minute
  - [ ] Processing latency > 2 minutes (p95)
  - [ ] Error rate > 5% over 5 minutes

**Deliverable:** Prometheus queries and basic alerting

---

### 4.3 Loki & Promtail Setup
- [ ] Add Loki service to `docker-compose.yml`
- [ ] Create `monitoring/loki-config.yml`:
  - [ ] Retention: 7 days
  - [ ] Storage config
- [ ] Add Promtail service to `docker-compose.yml`
- [ ] Create `monitoring/promtail-config.yml`:
  - [ ] Scrape Docker container logs
  - [ ] Parse JSON logs
  - [ ] Add labels (service name, container ID)
- [ ] Access Loki at `http://localhost:3100`
- [ ] Document useful LogQL queries in `docs/monitoring.md` (leveraging JSON format from Phase 1.9):
  - [ ] Error logs: `{service="detection"} | json | level="ERROR"`
  - [ ] Logs for specific image: `{service="detection"} | json | image_id="abc-123"`
  - [ ] Logs for specific request: `{service="api"} | json | request_id="xyz-789"`
  - [ ] All critical errors: `{} | json | level="CRITICAL"`
  - [ ] All errors across services: `{} | json | level="ERROR"`
  - [ ] Detection timing: `{service="detection"} | json | line_format "{{.inference_time_ms}}ms"`

**Deliverable:** Centralized log aggregation with Loki

---

### 4.4 Prometheus Alerting
- [ ] Configure Prometheus Alertmanager:
  - [ ] Add Alertmanager service to `docker-compose.yml`
  - [ ] Create `monitoring/alertmanager.yml` with notification routes
  - [ ] Configure alert channels (email, webhook to Alert Worker)
- [ ] Define alert rules in `monitoring/prometheus-alerts.yml`:
  - [ ] Queue depth > 100 for 5 minutes
  - [ ] Any service down > 1 minute
  - [ ] Disk usage > 80%
  - [ ] Processing latency > 2 minutes (p95)
  - [ ] Error rate > 5% over 5 minutes
  - [ ] Classification confidence < 0.3 for >50% of images
- [ ] Test alerts by triggering conditions:
  - [ ] Stop a service
  - [ ] Fill up queue
  - [ ] Simulate high latency
- [ ] Configure Alertmanager to send webhooks to Alert Worker for system health alerts
- [ ] Document alert response procedures in `docs/alerts.md`

**Deliverable:** Working Prometheus alerting system

---

### 4.5 HTTPS/TLS Setup
- [ ] Obtain SSL certificate (Let's Encrypt):
  - [ ] Install certbot on VM
  - [ ] Run `certbot certonly --standalone -d cameratrap.example.com`
  - [ ] Configure auto-renewal (cron job)
- [ ] Configure Nginx reverse proxy:
  - [ ] Create `nginx.conf`
  - [ ] Proxy `/api` to FastAPI backend
  - [ ] Serve React build at `/`
  - [ ] Enable HTTPS with certificate
  - [ ] Force HTTPS redirect (HTTP → HTTPS)
  - [ ] Add HSTS headers
- [ ] Update frontend to use HTTPS endpoints

**Deliverable:** HTTPS enabled for all web traffic

---

### 4.6 Security Audit & Hardening
- [ ] API Security:
  - [ ] Add rate limiting (100 requests/minute per IP)
  - [ ] CORS whitelist (only allow frontend domain)
  - [ ] Content Security Policy (CSP) headers
  - [ ] Input validation on all endpoints (Pydantic)
  - [ ] Sanitize filenames (prevent path traversal)
- [ ] Database Security:
  - [ ] Strong passwords (generated, stored in `.env`)
  - [ ] Disable remote access (only via Docker network)
  - [ ] Enable audit logging
- [ ] MinIO Security:
  - [ ] Bucket policies (least privilege)
  - [ ] Presigned URLs for temporary access (expiry 1 hour)
  - [ ] Access logs enabled
- [ ] Network Security:
  - [ ] Configure UFW firewall (allow 22, 80, 443, 21-22 only)
  - [ ] Restrict FTPS access by IP (if possible)
- [ ] Secrets Management:
  - [ ] Ensure `.env` is gitignored
  - [ ] Rotate JWT secret
  - [ ] Document secret rotation procedure
- [ ] Run security scan (e.g., `safety check`, `npm audit`)

**Deliverable:** Hardened security configuration

---

### 4.7 Backup & Recovery Setup
- [ ] Create backup script: `scripts/backup.sh`
  - [ ] Daily full PostgreSQL backup (`pg_dump`)
  - [ ] Upload to DigitalOcean Spaces / S3
  - [ ] Rotate old backups (keep 30 days)
- [ ] Enable PostgreSQL WAL archiving:
  - [ ] Configure continuous archiving
  - [ ] Store WAL files on external storage
- [ ] Enable MinIO versioning:
  - [ ] Set up versioning on all buckets
- [ ] Create restore script: `scripts/restore.sh`
  - [ ] Restore from backup file
  - [ ] Point-in-time recovery from WAL
- [ ] Set up automated backups (cron):
  - [ ] Daily full backup at 2 AM
  - [ ] Hourly incremental backups
- [ ] Test restore procedure:
  - [ ] Restore to staging environment
  - [ ] Verify data integrity
- [ ] Document recovery procedures in `docs/disaster-recovery.md`

**Deliverable:** Automated backup system with tested restore procedure

---

## Phase 5: Testing & Deployment

### 5.1 Unit Tests
- [ ] Write unit tests for all services:
  - [ ] Ingestion service (80%+ coverage)
  - [ ] Detection worker (80%+ coverage)
  - [ ] Classification worker (80%+ coverage)
  - [ ] API backend (80%+ coverage)
  - [ ] Frontend components (70%+ coverage)
- [ ] Use mocks for external dependencies:
  - [ ] Mock Redis
  - [ ] Mock MinIO
  - [ ] Mock database
  - [ ] Mock ML models
- [ ] Run tests in CI (GitHub Actions):
  ```yaml
  - name: Run tests
    run: docker compose -f docker-compose.test.yml up --abort-on-container-exit
  ```

**Deliverable:** Comprehensive unit test suite

---

### 5.2 Integration Tests
- [ ] Create integration test suite:
  - [ ] Test FTPS → Ingestion → Detection → Classification pipeline
  - [ ] Test API endpoints with real database
  - [ ] Test WebSocket connections
  - [ ] Test authentication flow
- [ ] Use test database and MinIO
- [ ] Use small test ML models (or mocks) for speed
- [ ] Run integration tests in CI

**Deliverable:** Integration tests covering full pipeline

---

### 5.3 End-to-End Tests
- [ ] Set up Playwright (or Selenium):
  - [ ] Install Playwright
  - [ ] Create `services/frontend/tests/e2e/`
- [ ] Write E2E tests:
  - [ ] Login flow
  - [ ] View image gallery
  - [ ] Apply filters
  - [ ] View image detail with bounding boxes
  - [ ] Navigate map
  - [ ] View statistics dashboard
  - [ ] Approve image (Analyst role)
  - [ ] Create user (Admin role)
- [ ] Run E2E tests against staging environment

**Deliverable:** End-to-end test suite for user flows

---

### 5.4 Load Testing
- [ ] Set up Locust (or k6):
  - [ ] Install Locust
  - [ ] Create `tests/load/locustfile.py`
- [ ] Define load test scenarios:
  - [ ] 100 concurrent users browsing gallery
  - [ ] 50 users viewing image details
  - [ ] 20 users applying filters
  - [ ] 10 images/minute ingestion rate
- [ ] Run load tests:
  - [ ] Identify bottlenecks
  - [ ] Tune database queries (add indexes)
  - [ ] Tune worker counts
  - [ ] Add caching where needed
- [ ] Document load test results in `docs/performance.md`

**Deliverable:** Load tested system with performance tuning

---

### 5.5 Create Ansible Deployment Automation

- [ ] **Create Ansible directory structure:**
  ```
  ansible/
  ├── playbook.yml
  ├── inventory.yml.example
  ├── group_vars/
  │   └── production.yml.example
  └── roles/
      ├── docker/
      ├── vsftpd/
      ├── firewall/
      ├── ssl/
      └── app/
  ```

- [ ] **Create main playbook (`ansible/playbook.yml`):**
  - [ ] Define plays for each role (docker, vsftpd, firewall, ssl, app)
  - [ ] Add tags for selective execution
  - [ ] Add error handling and rollback logic

- [ ] **Create Docker role (`ansible/roles/docker/`):**
  - [ ] Install Docker via apt
  - [ ] Install Docker Compose
  - [ ] Add application user to docker group
  - [ ] Configure Docker to start on boot

- [ ] **Create vsftpd role (`ansible/roles/vsftpd/`):**
  - [ ] Install vsftpd
  - [ ] Create Jinja2 template for vsftpd.conf (FTPS enabled)
  - [ ] Create FTP user with chroot
  - [ ] Set up upload directory with correct permissions
  - [ ] Generate self-signed cert or use Let's Encrypt cert
  - [ ] Enable and start vsftpd service

- [ ] **Create firewall role (`ansible/roles/firewall/`):**
  - [ ] Install ufw
  - [ ] Configure default policies (deny incoming, allow outgoing)
  - [ ] Allow SSH (port 22)
  - [ ] Allow HTTP/HTTPS (ports 80, 443)
  - [ ] Allow FTP/FTPS (ports 21, 990, passive range 40000-50000)
  - [ ] Enable ufw

- [ ] **Create SSL role (`ansible/roles/ssl/`):**
  - [ ] Install certbot
  - [ ] Obtain Let's Encrypt certificate for domain
  - [ ] Configure auto-renewal cron job
  - [ ] Copy certificates to vsftpd directory

- [ ] **Create app role (`ansible/roles/app/`):**
  - [ ] Clone Git repository to `/opt/addaxai-connect`
  - [ ] Template `.env` file from Ansible variables
  - [ ] Build Docker images
  - [ ] Run database migrations
  - [ ] Start services with docker compose
  - [ ] Set up log rotation for Docker containers

- [ ] **Create template files:**
  - [ ] `ansible/inventory.yml.example` - VM inventory template
  - [ ] `ansible/group_vars/production.yml.example` - Variables template
  - [ ] `ansible/roles/vsftpd/templates/vsftpd.conf.j2` - vsftpd config template
  - [ ] `ansible/roles/app/templates/env.j2` - .env file template

- [ ] **Create Ansible documentation:**
  - [ ] `ansible/README.md` - Quick start guide
  - [ ] Add deployment section to `docs/deployment.md`

- [ ] **Update .gitignore:**
  - [ ] Exclude `ansible/inventory.yml`
  - [ ] Exclude `ansible/group_vars/production.yml`

- [ ] **Test Ansible playbook:**
  - [ ] Create test VM on DigitalOcean
  - [ ] Run playbook against test VM
  - [ ] Verify all services are running
  - [ ] Destroy test VM

**Deliverable:** Complete Ansible automation for production deployment

---

### 5.6 Production Deployment with Ansible

**Automated deployment using Ansible playbook:**

- [ ] **Provision production VM on DigitalOcean:**
  - [ ] Create Ubuntu 22.04 LTS Droplet
  - [ ] Choose size: 8 GB RAM, 4 vCPUs, 160 GB SSD (or GPU Droplet)
  - [ ] Add your SSH key during creation
  - [ ] Note the VM's IP address

- [ ] **Configure DNS:**
  - [ ] Point your domain to VM IP (A record: `cameratrap.example.com` → `VM_IP`)
  - [ ] Wait for DNS propagation (verify with `dig cameratrap.example.com`)

- [ ] **Set up Ansible on your Mac:**
  - [ ] Install Ansible: `brew install ansible`
  - [ ] Verify installation: `ansible --version`

- [ ] **Configure Ansible inventory and variables:**
  - [ ] Clone repo on your Mac (if not already)
  - [ ] Copy `ansible/inventory.yml.example` to `ansible/inventory.yml`
  - [ ] Edit `inventory.yml` with your VM IP and SSH settings
  - [ ] Copy `ansible/group_vars/production.yml.example` to `ansible/group_vars/production.yml`
  - [ ] Edit `production.yml` with:
    - Domain name
    - FTPS credentials
    - Database passwords
    - JWT secret
    - Model repository
    - Email for Let's Encrypt

- [ ] **Run Ansible playbook from your Mac:**
  ```bash
  cd ansible/
  ansible-playbook -i inventory.yml playbook.yml
  ```

  This automatically:
  - ✅ Installs Docker, Docker Compose, vsftpd
  - ✅ Configures FTPS server with SSL
  - ✅ Configures UFW firewall (ports 22, 80, 443, 21, 990)
  - ✅ Obtains Let's Encrypt SSL certificate
  - ✅ Clones repo to `/opt/addaxai-connect`
  - ✅ Creates `.env` file from variables
  - ✅ Builds Docker images
  - ✅ Starts all services
  - ✅ Runs database migrations
  - ✅ Sets up Prometheus and Loki monitoring
  - ✅ Configures log rotation

- [ ] **Manual post-deployment steps:**
  - [ ] Upload ML model weights to VM (if not using Hugging Face auto-download):
    ```bash
    scp models/detection.pt root@VM_IP:/opt/addaxai-connect/models/detection/
    scp models/classification.pt root@VM_IP:/opt/addaxai-connect/models/classification/
    ```
  - [ ] Create admin user:
    ```bash
    ssh root@VM_IP
    cd /opt/addaxai-connect
    docker compose exec api-backend python scripts/create_user.py
    ```

**Deliverable:** Fully automated production deployment on VM

---

### 5.7 Post-Deployment Verification
- [ ] Upload test image via FTPS
- [ ] Verify full pipeline execution:
  - [ ] Check ingestion logs
  - [ ] Check detection logs
  - [ ] Check classification logs
  - [ ] Verify database records
  - [ ] Verify files in MinIO
- [ ] Test web UI:
  - [ ] Login
  - [ ] View images
  - [ ] Apply filters
  - [ ] View map
  - [ ] View stats
- [ ] Test WebSocket (real-time updates)
- [ ] Verify Grafana dashboards (all metrics flowing)
- [ ] Test alerts (trigger test condition)
- [ ] Test backup script

**Deliverable:** Verified production system

---

### 5.8 Documentation
- [ ] Write `README.md`:
  - [ ] Project overview
  - [ ] Quick start guide
  - [ ] Architecture summary
- [ ] Write `docs/architecture.md`:
  - [ ] Detailed architecture
  - [ ] Component descriptions
  - [ ] Data flow diagrams
  - [ ] Technology stack rationale
- [ ] Write `docs/api.md`:
  - [ ] API endpoint reference
  - [ ] Request/response examples
  - [ ] Authentication guide
- [ ] Write `docs/deployment.md`:
  - [ ] Production deployment guide
  - [ ] VM setup instructions
  - [ ] SSL/TLS configuration
  - [ ] Monitoring setup
- [ ] Write `docs/development.md`:
  - [ ] Local development setup
  - [ ] Running tests
  - [ ] Database migrations
  - [ ] Contributing guide
- [ ] Write `docs/troubleshooting.md`:
  - [ ] Common issues and solutions
  - [ ] Debugging tips
  - [ ] Log locations
- [ ] Write `docs/disaster-recovery.md`:
  - [ ] Backup procedures
  - [ ] Restore procedures
  - [ ] RTO/RPO targets

**Deliverable:** Complete documentation

---

## Phase 6: Iteration & Optimization

### 6.1 Monitoring & Tuning
- [ ] Monitor Prometheus metrics daily (queue depth, processing time, error rates)
- [ ] Query Loki for error logs weekly
- [ ] Tune worker counts based on queue depth
- [ ] Optimize slow database queries
- [ ] Add caching where needed
- [ ] Review and adjust confidence thresholds

### 6.2 Alert System (Wildlife & Camera Health)
- [ ] Add database tables: `alert_rules`, `alert_logs`, `camera_status`
- [ ] Create `services/alerts/` worker:
  - [ ] Subscribe to `classification-complete` queue
  - [ ] Check alert rules (species, battery, camera offline)
  - [ ] Send notifications via Signal/Email/WhatsApp/EarthRanger
- [ ] Extract EXIF metadata (battery, temperature) in ingestion service
- [ ] Add API endpoints for alert rule CRUD
- [ ] Create Admin Alert Rules page in frontend:
  - [ ] List/create/edit/delete rules
  - [ ] Simple dropdown templates (species, battery low, camera offline)
  - [ ] Configure notification method and trigger mode (immediate/batched)
  - [ ] View alert history logs
- [ ] Implement notification services (Signal, Email, WhatsApp, EarthRanger)
- [ ] Add scheduled task for batched alerts (daily/hourly summaries)
- [ ] Configure Prometheus Alertmanager → webhook to Alert Worker for system health (memory, crashes, service down)

**Deliverable:** Configurable alerting system for wildlife detections and camera health

---

### 6.3 User Feedback & Features
- [ ] Collect user feedback
- [ ] Prioritize feature requests
- [ ] Add filters (e.g., time of day, weather)
- [ ] Add export functionality (CSV, Excel)
- [ ] Add bulk approval actions
- [ ] Add species suggestion system

### 6.4 Scaling
- [ ] Monitor resource usage
- [ ] Scale workers horizontally when needed:
  ```bash
  docker compose up -d --scale detection-worker=4
  ```
- [ ] Plan multi-VM migration if needed
- [ ] Consider cloud migration (AWS, GCP) if outgrown VM

---

## Priority Order (What to Build First)

### Critical Path (Must Have for MVP)

**Phase 1: Foundation (COMPLETED ✅)**
1. **Database Setup** (1.2) ✅ - Foundation for all data
2. **Object Storage Setup** (1.3) ✅ - Required for storing images
3. **Message Queue Setup** (1.4) ✅ - Required for decoupling
4. **API Backend Scaffold** (1.6) ✅ - Foundation for all APIs
5. **Authentication System** (1.7) ✅ - Required for security

**Phase 1 (Continued - NEW PRIORITIES)**
6. **Structured Logging System** (1.9) - **Do this first** - Centralized logging with correlation IDs for easy debugging
7. **Database Schema Migration** (1.10.1) - Extend with camera management tables

**Phase 2: ML Pipeline with Enhanced Ingestion**
8. **Enhanced Ingestion Service** (2.1) - Entry point for images + daily reports + unknown devices
9. **Detection Worker** (2.2, 2.3) - Core ML processing
10. **Classification Worker** (2.4) - Core ML processing
11. **Maintenance Task Engine** (2.6) - Auto-generate tasks from thresholds

**Phase 3: Web Application**
12. **Frontend Scaffold** (3.5) - Display data to users
13. **Authentication UI** (3.6) - User login
14. **Camera Registry Page** (3.9.1) - Camera management UI
15. **Camera Detail Page** (3.9.2) - Camera health and history
16. **Maintenance List Page** (3.9.4) - Operations dashboard
17. **Camera Management API Endpoints** (3.11) - Backend for camera management
18. **Images API** (3.1) - View processed images
19. **Image Gallery View** (3.7) - Primary ML interface

**Phase 3: Camera Management (Core Operations)**
20. **SIM Inventory Page** (3.9.5) - SIM management
21. **Camera Onboarding Page** (3.9.9) - Field technician workflow
22. **Unknown Devices Queue** (3.9.8) - Admin claiming

### Important (Needed for Field Operations)

23. **Placement Planning Map** (3.9.3) - Planned vs actual visualization
24. **Settings Profiles Library** (3.9.6) - Settings file management
25. **Firmware Releases Library** (3.9.7) - Firmware file management
26. **Statistics API** (3.3) - Business insights
27. **Statistics Dashboard** (3.10) - Visualize data
28. **Prometheus Setup** (4.1) - Monitoring
29. **HTTPS/TLS Setup** (4.5) - Security
30. **Backup & Recovery** (4.7) - Data protection

### Nice to Have (Can Add Later)

31. **Image Detail View** (3.8) - View individual images (lower priority than camera mgmt)
32. **Cameras API** (3.2) - Original cameras API (superseded by 3.11.2)
33. **WebSocket Real-time Updates** (3.4, 3.11) - Enhance UX
34. **Loki & Promtail** (4.3) - Log aggregation (infrastructure already deployed, just needs query examples)
35. **Prometheus Alerting** (4.4) - Proactive monitoring
36. **Admin User Management** (3.12) - User administration
37. **Coverage Sector Visualization** (Phase 4+) - Advanced map features
38. **Location-aware Task Sorting** (Phase 4+) - GPS-based technician routing

---

## Key Decisions Needed Before Starting

### 1. ML Framework Choice
**Decision:** PyTorch or TensorFlow?
**Impact:** Affects Dockerfile, requirements.txt, model loading code
**Recommendation:** Use whatever framework your models are already trained in

### 2. Queue Technology
**Decision:** Redis or RabbitMQ?
**Impact:** Affects queue client code, Docker Compose config
**Recommendation:** Redis (simpler, faster for this scale)

### 3. Frontend UI Library
**Decision:** Material-UI, Tailwind CSS, or Ant Design?
**Impact:** Affects component styling, bundle size
**Recommendation:** Tailwind CSS (modern, flexible, smaller bundle)

### 4. Map Provider
**Decision:** Leaflet (free) or Mapbox (paid)?
**Impact:** Affects map features, cost
**Recommendation:** Start with Leaflet, migrate to Mapbox if needed

### 5. GPU vs CPU
**Decision:** Use GPU for inference?
**Impact:** Affects VM cost, processing speed
**Recommendation:** Start with CPU, add GPU if latency is too high

### 6. FTPS vs SFTP
**Decision:** Camera traps use FTPS or SFTP?
**Impact:** Affects ingestion service implementation
**Recommendation:** Clarify with camera trap vendor (FTPS = FTP over SSL, SFTP = SSH File Transfer)

---

## Risk Assessment

### High Priority Risks

1. **ML Model Integration Complexity**
   - **Risk:** Models have conflicting dependencies
   - **Mitigation:** Separate Docker containers with isolated environments

2. **FTPS Connection Reliability**
   - **Risk:** Network hiccups cause missed images
   - **Mitigation:** Retry logic, persistent queue, monitoring

3. **Database Performance at Scale**
   - **Risk:** Slow queries as data grows
   - **Mitigation:** Proper indexing, query optimization, read replicas if needed

4. **GPU Availability**
   - **Risk:** GPU VMs are expensive or unavailable
   - **Mitigation:** Design system to work on CPU, add GPU optionally

### Medium Priority Risks

5. **Team Capacity**
   - **Risk:** Small team (2-3 people) may struggle with full stack
   - **Mitigation:** Focus on MVP first, iterate later

6. **Model Accuracy Issues**
   - **Risk:** Low confidence predictions, false positives
   - **Mitigation:** Tunable confidence thresholds, manual review workflow

7. **Storage Costs**
   - **Risk:** Hundreds of images/day = lots of storage
   - **Mitigation:** Compression, retention policies, archive old images

---

## Success Criteria

### MVP Success (Original ML Pipeline)
- [ ] System processes test images end-to-end (FTPS → detection → classification → web UI)
- [ ] Users can log in and view processed images with bounding boxes
- [ ] System handles 100 images/day without manual intervention
- [ ] All services are monitored with Prometheus metrics
- [ ] System is deployed on production VM with HTTPS

### MVP Success (Camera Management Addition)
- [ ] System processes daily reports and updates camera health automatically
- [ ] Unknown devices are queued for admin claiming
- [ ] Maintenance tasks auto-generate from thresholds (battery, SD, silence)
- [ ] Field technicians can onboard cameras via barcode scanning
- [ ] Admins can manage SIM inventory and assignments
- [ ] Placement plans show planned vs actual location with deviation
- [ ] Settings and firmware files can be uploaded/downloaded with instructions
- [ ] All camera management data is project-scoped (multi-tenancy)

### Production Success (Combined System)
- [ ] System processes 300 images/day + 100 daily reports reliably
- [ ] Processing latency < 1 minute per image (p95)
- [ ] Zero data loss (all images and daily reports ingested)
- [ ] Uptime > 99% (< 7 hours downtime/month)
- [ ] Users are actively using the platform (5+ active users)
- [ ] Alerts are actionable and not noisy (<5 false alarms/week)
- [ ] 100+ cameras tracked with real-time health metrics
- [ ] Maintenance tasks processed and completed by field technicians
- [ ] Unknown devices claimed within 24 hours of first contact
- [ ] Camera registry searched efficiently (response <1s for 1000 cameras)
- [ ] Placement planning map renders 200+ cameras without performance issues
- [ ] Field onboarding workflow completed in <5 minutes per camera

### Long-term Success
- [ ] System scales to 1000+ images/day + 10,000 cameras
- [ ] Model accuracy improved via retraining
- [ ] Users report high satisfaction with platform
- [ ] System requires <4 hours/week maintenance
- [ ] Cost per image processed is optimized
- [ ] Field operations streamlined (minimal manual camera configuration)
- [ ] Maintenance tasks predicted before failures occur

---

## Estimated Timeline

### Original ML Pipeline (Without Camera Management)
| Phase | Component | Duration |
|-------|-----------|----------|
| **Phase 1** | Foundation & Infrastructure | 10-15 days |
| **Phase 2** | ML Pipeline (Ingestion, Detection, Classification) | 15-20 days |
| **Phase 3** | Web Application (API + Frontend) | 15-20 days |
| **Phase 4** | Monitoring & Security | 5-7 days |
| **Phase 5** | Testing & Deployment | 5-7 days |
| **Total** | **Original System** | **50-69 days (10-14 weeks)** |

### Camera Management Addition
| Phase | Component | Duration |
|-------|-----------|----------|
| **Phase 1.9** | Database migration | 2-3 days |
| **Phase 2.1** | Enhanced ingestion (daily reports + EXIF) | 4-5 days |
| **Phase 2.6** | Maintenance task engine | 3-4 days |
| **Phase 3.11** | Camera management API (40+ endpoints) | 8-10 days |
| **Phase 3.9** | Frontend (9 pages: registry, detail, map, etc.) | 15-20 days |
| **Phase 5.2** | Testing & refinement | 4-5 days |
| **Total** | **Camera Management Module** | **36-47 days (7-9 weeks)** |

### Combined System Timeline
**For 1 developer:** 86-116 days (17-23 weeks / 4-6 months)
**For 2 developers:** 50-70 days (10-14 weeks / 2.5-3.5 months) with good parallelization

### Recommended Approach (Phased Delivery)

**Phase A: Core ML Pipeline (10-14 weeks)**
- Deliver working image processing system first
- Users can view images, detections, classifications
- Provides immediate value

**Phase B: Camera Management (7-9 weeks)**
- Add field operations capabilities
- Build on top of working ML pipeline
- Can start after Phase A is stable

**Total with Phased Approach:** 17-23 weeks (4-6 months)

**Note:** Camera management can be developed in parallel with ML pipeline if resources allow, reducing total timeline to 12-16 weeks (3-4 months) for 2 developers.

---

## Next Immediate Steps

1. **Review this plan** with the team and collaborator - Get feedback on camera management integration, adjust priorities
2. **Implement Phase 1.9: Structured Logging System** - Set up shared logger with correlation IDs (2-3 hours)
3. **Run database migration (Phase 1.10)** - Apply camera management schema: `alembic upgrade head`
4. **Review data formats documentation** - Study `docs/data-formats.md` for EXIF and daily report parsing
5. **Make key technology decisions** - ML framework, UI library, etc.
6. **Set up development environment** - Clone repo, install Docker
7. **Start Phase 2.1: Enhanced Ingestion** - Implement daily report parser and unknown device handler
8. **Build Phase 2.6: Maintenance Engine** - Implement threshold monitoring and task generation
9. **Schedule regular check-ins** - Review progress, unblock issues
