# AddaxAI Connect - Project Plan

**Status:** Planning & Architecture Phase
**Last Updated:** December 2, 2025
**Target:** Production-ready camera trap platform with AI processing pipeline

---

IMPORTANT: This document is a draft plan. It is not set in stone. Things can change down the line if we start working on it. Its important to know that this PROJECT_PLAN.md was created a the start, and contains the initial general ideas. It is not set in stone, we can always divert from the plan if we think that is best. Never blindly follow that plan, always keep thinking and asking questions. If we divert from the plan, make sure to update it accordingly. 

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
- All services log to stdout (JSON format)
- Promtail collects logs and sends to Loki
- Can view Prometheus metrics at port 9090 and Loki logs at port 3100

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
| Frontend | React + Vite | Modern, fast dev experience |
| Orchestration | Docker Compose | Simple multi-container mgmt |
| Monitoring | Prometheus + Loki | Metrics and log aggregation |
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
- [ ] Create monorepo directory structure:
  ```
  addaxai-connect/
  ├── services/                       # Microservices
  │   ├── ingestion/
  │   ├── detection/
  │   ├── classification/
  │   ├── alerts/
  │   ├── api/
  │   └── frontend/
  ├── models/                         # ML model weights (gitignored)
  │   ├── detection/
  │   └── classification/
  ├── monitoring/                     # Prometheus, Loki configs
  │   ├── prometheus.yml
  │   ├── prometheus-alerts.yml
  │   ├── loki-config.yml
  │   └── promtail-config.yml
  ├── ansible/                        # Ansible deployment automation
  │   ├── playbook.yml                # Main playbook
  │   ├── inventory.yml.example       # VM list template
  │   ├── group_vars/
  │   │   └── production.yml.example  # Config template
  │   └── roles/                      # Ansible roles
  │       ├── docker/                 # Install Docker
  │       ├── vsftpd/                 # Configure FTPS server
  │       ├── firewall/               # Configure UFW firewall
  │       ├── ssl/                    # Let's Encrypt SSL
  │       └── app/                    # Deploy application
  ├── scripts/                        # Admin scripts
  │   ├── create_user.py
  │   ├── backup.sh
  │   └── restore.sh
  ├── docs/                           # Documentation
  │   ├── architecture.md
  │   ├── development.md
  │   └── deployment.md
  ├── docker-compose.yml              # Production config
  ├── docker-compose.dev.yml          # Development config
  ├── .env.example                    # Environment template
  ├── .gitignore
  ├── README.md
  ├── PROJECT_PLAN.md
  └── LLM.md
  ```
- [ ] Set up `.gitignore` (exclude `.env`, `models/*.pt`, `node_modules/`, `ansible/inventory.yml`, `ansible/group_vars/production.yml`)
- [ ] Create `docker-compose.yml` for production
- [ ] Create `docker-compose.dev.yml` for development
- [ ] Create `.env.example` template

**Deliverable:** Clean repository structure ready for development

---

### 1.2 Database Setup
- [ ] Create `docker-compose.yml` service for PostgreSQL + PostGIS
- [ ] Design database schema:
  - [ ] `images` table (id, filename, camera_id, uploaded_at, storage_path, status)
  - [ ] `cameras` table (id, name, location as geography, installed_at, config)
  - [ ] `detections` table (id, image_id, bbox, confidence, crop_path)
  - [ ] `classifications` table (id, detection_id, species, confidence)
  - [ ] `users` table (id, email, password_hash, role)
  - [ ] `audit_logs` table (id, user_id, action, resource_type, timestamp)
- [ ] Set up Alembic for migrations in `services/api/`
- [ ] Create initial migration with all tables
- [ ] Add indexes:
  - `images(camera_id, uploaded_at DESC)`
  - `images(status)`
  - `classifications(species)`
  - PostGIS spatial index on `cameras(location)`

**Deliverable:** PostgreSQL running with complete schema

---

### 1.3 Object Storage Setup
- [ ] Add MinIO service to `docker-compose.yml`
- [ ] Configure MinIO with persistent volumes
- [ ] Create initialization script to set up buckets:
  - `raw-images`
  - `crops`
  - `thumbnails`
- [ ] Test S3 client connectivity (boto3)

**Deliverable:** MinIO running with all buckets created

---

### 1.4 Message Queue Setup
- [ ] Add Redis service to `docker-compose.yml`
- [ ] Configure Redis with AOF persistence
- [ ] Test queue operations (push/pop)
- [ ] Document queue naming convention:
  - `image-ingested`
  - `detection-complete`
  - `classification-complete`
  - `failed-jobs`

**Deliverable:** Redis running and ready for queue operations

---

### 1.5 Shared Python Utilities (Optional)
- [ ] Create `shared/python-common/` directory
- [ ] Implement common utilities:
  - [ ] `db_models.py` - SQLAlchemy models (shared across services)
  - [ ] `queue_client.py` - Redis queue wrapper
  - [ ] `storage_client.py` - MinIO/S3 wrapper
  - [ ] `config.py` - Environment variable loading
  - [ ] `logger.py` - Structured logging setup (structlog)
- [ ] Make shared library installable as package

**Deliverable:** Reusable utilities for all services

---

### 1.6 API Backend Scaffold
- [ ] Create `services/api/` structure:
  ```
  api/
  ├── Dockerfile
  ├── requirements.txt
  ├── main.py
  ├── routers/
  │   ├── images.py
  │   ├── cameras.py
  │   ├── stats.py
  │   └── auth.py
  ├── models/         # SQLAlchemy models
  ├── schemas/        # Pydantic schemas
  ├── auth.py         # JWT handling
  ├── database.py     # DB connection
  ├── alembic/        # Migrations
  └── tests/
  ```
- [ ] Set up FastAPI app with basic structure
- [ ] Implement database connection pooling
- [ ] Create basic health check endpoint: `GET /api/health`
- [ ] Add CORS middleware
- [ ] Set up logging

**Deliverable:** FastAPI running with health check endpoint

---

### 1.7 Authentication System
- [ ] Implement JWT token generation/validation
- [ ] Create user authentication endpoints:
  - [ ] `POST /api/auth/login` - Email/password login
  - [ ] `POST /api/auth/refresh` - Refresh access token
  - [ ] `GET /api/auth/me` - Get current user info
  - [ ] `POST /api/auth/logout` - Invalidate refresh token
- [ ] Implement password hashing (bcrypt)
- [ ] Add role-based access control (RBAC) middleware
- [ ] Define roles: Admin, Analyst, Viewer
- [ ] Create admin user creation script: `scripts/create_user.py`

**Deliverable:** Working authentication system with JWT

---

### 1.8 Local Development Setup
- [ ] Document local setup in `docs/development.md`
- [ ] Create development Docker Compose with:
  - Hot reload for API (mount source code)
  - Development database with test data
  - Exposed ports for debugging
- [ ] Test full stack startup: `docker compose -f docker-compose.dev.yml up -d`
- [ ] Verify all services are healthy

**Deliverable:** Documented, working local development environment

---

## Phase 2: ML Pipeline

### 2.1 FTPS Ingestion Service
- [ ] Create `services/ingestion/` structure:
  ```
  ingestion/
  ├── Dockerfile
  ├── requirements.txt
  ├── main.py
  ├── watcher.py
  ├── processor.py
  └── tests/
  ```
- [ ] Implement FTPS connection using `paramiko` or `pyftpdlib`
- [ ] Implement file system watcher with `watchdog`
- [ ] On new image detected:
  - [ ] Validate image file (MIME type, magic bytes)
  - [ ] Generate UUID for image
  - [ ] Upload to MinIO (`raw-images` bucket)
  - [ ] Insert record into `images` table (status: 'pending')
  - [ ] Publish message to `image-ingested` queue
  - [ ] Handle errors with retry logic (3 attempts, exponential backoff)
- [ ] Add structured logging with correlation IDs
- [ ] Write unit tests

**Deliverable:** Ingestion service that watches FTPS and queues images

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
- [ ] Add structured logging with image_id correlation

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
- [ ] Document useful LogQL queries in `docs/monitoring.md`:
  - [ ] Error logs: `{service="detection"} |= "ERROR"`
  - [ ] Logs for specific image: `{service="detection"} |= "image_id: abc-123"`
  - [ ] All errors across services: `{} |= "ERROR"`

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

1. **Database Setup** (1.2) - Foundation for all data
2. **Object Storage Setup** (1.3) - Required for storing images
3. **Message Queue Setup** (1.4) - Required for decoupling
4. **API Backend Scaffold** (1.6) - Foundation for all APIs
5. **Authentication System** (1.7) - Required for security
6. **Ingestion Service** (2.1) - Entry point for images
7. **Detection Worker** (2.2, 2.3) - Core ML processing
8. **Classification Worker** (2.4) - Core ML processing
9. **Images API** (3.1) - View processed images
10. **Frontend Scaffold** (3.5) - Display data to users
11. **Authentication UI** (3.6) - User login
12. **Image Gallery View** (3.7) - Primary user interface

### Important (Needed for Production)

13. **Image Detail View** (3.8) - View individual images
14. **Cameras API** (3.2) - Manage camera locations
15. **Statistics API** (3.3) - Business insights
16. **Statistics Dashboard** (3.10) - Visualize data
17. **Prometheus Setup** (4.1) - Monitoring
18. **Prometheus Queries** (4.2) - Observability
19. **HTTPS/TLS Setup** (4.5) - Security
20. **Backup & Recovery** (4.7) - Data protection

### Nice to Have (Can Add Later)

21. **WebSocket Real-time Updates** (3.4, 3.11) - Enhance UX
22. **Map View** (3.9) - Spatial visualization
23. **Loki & Promtail** (4.3) - Log aggregation
24. **Prometheus Alerting** (4.4) - Proactive monitoring
25. **Admin User Management** (3.12) - User administration

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

### MVP Success
- [ ] System processes test images end-to-end (FTPS → detection → classification → web UI)
- [ ] Users can log in and view processed images with bounding boxes
- [ ] System handles 100 images/day without manual intervention
- [ ] All services are monitored with Prometheus metrics
- [ ] System is deployed on production VM with HTTPS

### Production Success
- [ ] System processes 300 images/day reliably
- [ ] Processing latency < 1 minute per image (p95)
- [ ] Zero data loss (all images ingested and processed)
- [ ] Uptime > 99% (< 7 hours downtime/month)
- [ ] Users are actively using the platform (5+ active users)
- [ ] Alerts are actionable and not noisy (<5 false alarms/week)

### Long-term Success
- [ ] System scales to 1000+ images/day
- [ ] Model accuracy improved via retraining
- [ ] Users report high satisfaction with platform
- [ ] System requires <4 hours/week maintenance
- [ ] Cost per image processed is optimized

---

## Next Immediate Steps

1. **Review this plan** with the team - Get feedback, adjust priorities
2. **Make key technology decisions** - ML framework, UI library, etc.
3. **Set up development environment** - Clone repo, install Docker
4. **Start Phase 1: Foundation & Infrastructure** - Create repository structure and database schema
5. **Schedule regular check-ins** - Review progress, unblock issues

---

## Questions & Clarifications Needed

Before starting implementation, clarify:

1. **ML Models:**
   - What framework are the models trained in? (PyTorch, TensorFlow, ONNX?)
   - What are the input/output formats?
   - What are the model file sizes?
   - Do models require specific versions of libraries?

2. **FTPS:**
   - FTPS or SFTP? (Confirm with camera trap vendor)
   - What is the FTPS server address and credentials?
   - How frequently do images arrive? (hourly, daily, random?)
   - What is the average image size?

3. **Camera Traps:**
   - How many cameras are deployed?
   - What are the camera locations? (coordinates)
   - Do cameras have unique identifiers in filenames?

4. **Users:**
   - How many users need access initially?
   - What roles are needed? (Admin, Analyst, Viewer)
   - Any specific permissions requirements?

5. **Deployment:**
   - Do you already have a DigitalOcean account?
   - Do you have a domain name for the platform?
   - Any specific compliance requirements? (GDPR, HIPAA, etc.)
