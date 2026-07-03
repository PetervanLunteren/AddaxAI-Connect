# Developer documentation

## Project overview

**AddaxAI Connect** is a real-time camera trap platform that:
- Ingests images from remote camera traps via FTPS
- Processes images through ML models (detection, then classification)
- Provides a web interface for viewing and analyzing results

**Architecture:** microservices in a monorepo, orchestrated with Docker Compose
**Deployment:** Ubuntu VM (DigitalOcean or similar), automated with Ansible
**Scale:** hundreds of images per day, 1-10 concurrent users
**Development:** this repo is still in development. Testing and deployment happen on the VM directly, not on the local device.

---

## Role-based access control

Three-tier system:
- **server-admin** has full access to all projects, can create projects and manage all users
- **project-admin** manages specific projects, can invite users to their projects
- **project-viewer** has read-only access to specific projects

Users can have different roles in different projects (e.g., admin of Project A, viewer of Project B).

### Permission model
- `users.is_server_admin` boolean flag for server admins
- `project_memberships` table maps users to projects with roles
- No role = no access to that project

### Inviting users
**Server admin:** can add users to any project with any role via the User Assignment page
**Project admin:** can add users to their own projects only via the Project Users page

User must have at least one project membership to register (enforced at registration).

## Repository structure

Each service directory also contains a `Dockerfile` and `requirements.txt`, and
most contain a `README.md`. Those are omitted below to keep the tree readable.

```
addaxai-connect/
├── services/                          # All microservices
│   ├── ingestion/                     # FTPS watcher, validates and stores images
│   │   ├── main.py                    # Entry point (watchdog file observer)
│   │   ├── camera_profiles.py         # Per-camera-model metadata extraction
│   │   ├── daily_report_parser.py     # Parses camera health reports
│   │   ├── exif_parser.py             # EXIF metadata extraction
│   │   ├── validators.py              # Image validation (MIME, size, etc.)
│   │   ├── db_operations.py
│   │   ├── storage_operations.py
│   │   └── utils.py
│   │
│   ├── detection/                     # Object detection worker
│   │   ├── worker.py                  # Entry point (MegaDetector inference)
│   │   ├── detector.py                # Detection logic
│   │   ├── cropper.py                 # Crop detected regions
│   │   ├── model_loader.py            # Model download and loading
│   │   ├── config.py
│   │   ├── db_operations.py
│   │   └── storage_operations.py
│   │
│   ├── classification-deepfaune/      # DeepFaune species classifier (38 European species)
│   │   ├── worker.py                  # Entry point
│   │   ├── classifier.py              # Classification logic
│   │   ├── annotated_image.py         # Generates annotated images with boxes, labels, privacy blur
│   │   ├── model_loader.py
│   │   ├── config.py
│   │   ├── db_operations.py
│   │   └── storage_operations.py
│   │
│   ├── classification-speciesnet/     # SpeciesNet species classifier (2,498 global species)
│   │   ├── worker.py                  # Entry point
│   │   ├── classifier.py
│   │   ├── annotated_image.py
│   │   ├── model_loader.py
│   │   ├── config.py
│   │   ├── db_operations.py
│   │   └── storage_operations.py
│   │
│   ├── bulk-upload/                    # Bulk-upload worker (SD-card imports)
│   │   └── worker.py                  # Entry point (ingests staged files into the bulk pipeline)
│   │
│   ├── notifications/                 # Notification coordinator and scheduled jobs
│   │   ├── worker.py                  # Entry point (event routing + APScheduler)
│   │   ├── event_handlers.py          # Handles species_detection, low_battery, etc.
│   │   ├── rule_engine.py             # Evaluates per-user notification preferences
│   │   ├── email_report.py            # Daily/weekly/monthly email report generation
│   │   ├── report_stats.py            # Report statistics
│   │   ├── battery_digest.py          # Daily battery status summaries
│   │   ├── excessive_images.py        # Excessive image alerts
│   │   ├── project_inactivity.py      # Project inactivity alerts
│   │   ├── disk_usage_alert.py        # Disk usage alerts
│   │   ├── infra_alert.py             # Infrastructure health alerts
│   │   ├── sim_expiry.py              # SIM card expiry alerts
│   │   ├── reminders.py               # Project reminder digests
│   │   ├── templates/                 # Notification-specific email templates
│   │   └── db_operations.py
│   │
│   ├── notifications-email/           # Email delivery via SMTP
│   │   ├── worker.py                  # Entry point
│   │   ├── email_client.py            # SMTP sending logic
│   │   └── db_operations.py
│   │
│   ├── notifications-telegram/        # Telegram delivery via Bot API
│   │   ├── worker.py                  # Entry point (message queue + /start polling)
│   │   ├── telegram_client.py         # Telegram Bot API client
│   │   ├── image_handler.py           # Image sending for Telegram
│   │   └── db_operations.py
│   │
│   ├── alerts/                        # Alert evaluation (stub, not yet implemented)
│   │   └── worker.py
│   │
│   ├── minio-init/                    # One-shot MinIO bootstrap (buckets, ILM rules)
│   │   └── entrypoint.sh
│   │
│   ├── minio-tier-watchdog/           # Cold-tier watchdog
│   │   ├── watchdog.py                # Entry point (tags old raw images for cold transition)
│   │   └── healthcheck.py             # Docker healthcheck
│   │
│   ├── api/                           # FastAPI backend
│   │   ├── main.py                    # Entry point (FastAPI app, middleware, route registration)
│   │   ├── alembic/                   # Database migrations
│   │   │   └── versions/              # Migration files (chronological)
│   │   ├── alembic.ini
│   │   ├── migrate.sh                 # Run migrations inside the container
│   │   ├── auth/                      # Authentication and permissions
│   │   │   ├── routes.py              # Auth route wiring (FastAPI-Users)
│   │   │   ├── users.py               # User auth backend and dependencies
│   │   │   ├── user_manager.py        # Registration, verification, password reset hooks
│   │   │   ├── permissions.py         # Role checks
│   │   │   ├── project_access.py      # Per-project access checks
│   │   │   └── schemas.py             # Auth request/response schemas
│   │   ├── mailer/                    # Email sending for auth flows
│   │   │   └── sender.py
│   │   ├── middleware/                # Request middleware
│   │   │   └── logging.py             # Request logging and correlation IDs
│   │   ├── routers/                   # API route handlers
│   │   │   ├── admin.py               # Server admin endpoints
│   │   │   ├── cameras.py             # Camera CRUD
│   │   │   ├── camera_groups.py       # Camera group management
│   │   │   ├── camera_reference_images.py # Reference images per camera
│   │   │   ├── sites.py               # Site CRUD
│   │   │   ├── deployments.py         # Deployment list and escape-hatch reassign
│   │   │   ├── feed.py                # Camera updates feed (list, resolve, seen)
│   │   │   ├── images.py              # Image queries
│   │   │   ├── image_admin.py         # Image admin operations
│   │   │   ├── bulk_upload.py         # Bulk-upload job management
│   │   │   ├── live_feed.py           # Live feed endpoints
│   │   │   ├── export.py              # Data export
│   │   │   ├── health.py              # System health checks
│   │   │   ├── ingestion_monitoring.py # Rejected files, upload monitoring
│   │   │   ├── logs.py                # Notification log queries
│   │   │   ├── notifications.py       # Notification preference management
│   │   │   ├── reminders.py           # Project reminders
│   │   │   ├── projects.py            # Project CRUD
│   │   │   ├── project_documents.py   # Project document uploads
│   │   │   ├── project_images.py      # Project image uploads
│   │   │   ├── species.py             # Species data and taxonomy
│   │   │   ├── statistics.py          # Dashboard statistics and pipeline status
│   │   │   ├── devtools.py            # Dev-mode tools (data purge, etc.)
│   │   │   └── users.py               # User management
│   │   ├── static/                    # Static files
│   │   └── utils/                     # API utilities
│   │       ├── activity_analysis.py   # Activity pattern analysis
│   │       ├── annotated_image_generator.py # On-demand annotated image rendering
│   │       ├── camera_status.py       # Camera online/offline status
│   │       ├── deployment_edits.py    # Reassign/recompute/merge plumbing (deployments + feed)
│   │       ├── feed.py                # Feed candidate-site helper
│   │       ├── detection_filtering.py # Detection confidence and class filtering
│   │       ├── independence_filter.py # Independent-detection (capture event) filtering
│   │       ├── occupancy_model.py     # Naive occupancy estimation
│   │       ├── preferred_counts.py    # Preferred per-image counts
│   │       ├── image_processing.py    # Image helpers
│   │       ├── sun_time.py            # Sunrise/sunset times
│   │       ├── timeline.py            # Deployment timeline
│   │       ├── timeline_activity.py   # Activity over the timeline
│   │       └── dev_mode.py            # Dev-mode helpers
│   │
│   └── frontend/                      # React + Vite + TypeScript web interface
│       ├── src/
│       │   ├── main.tsx               # Entry point
│       │   ├── App.tsx                # Root component, routing
│       │   ├── api/                   # API client and typed endpoints
│       │   ├── components/            # Reusable UI components (grouped by feature)
│       │   ├── contexts/              # AuthContext, ProjectContext, ImageCacheContext
│       │   ├── hooks/                 # Custom React hooks
│       │   ├── lib/                   # Stores, query client, feature flags, helpers
│       │   ├── pages/                 # Page components (with admin/, insights/, server/ subdirs)
│       │   ├── geodata/               # Country and timezone lookup data
│       │   ├── workers/               # Web workers (bulk scan)
│       │   ├── styles/                # Global CSS
│       │   └── utils/                 # Helpers (colors, hex-grid, detection overlays)
│       ├── public/                    # Static assets served as-is
│       ├── nginx.conf                 # Nginx config for the frontend container
│       ├── FRONTEND_CONVENTIONS.md    # Frontend-specific conventions
│       ├── vite.config.js
│       └── tailwind.config.js
│
├── shared/                            # Shared Python library (addaxai-connect-shared)
│   └── shared/
│       ├── __init__.py                # Version reading
│       ├── config.py                  # Pydantic settings (env vars)
│       ├── database.py                # SQLAlchemy sync/async engines and sessions
│       ├── models.py                  # ORM models (Image, Camera, Detection, User, Project, etc.)
│       ├── queue.py                   # RedisQueue (publish, consume, consume_forever, priority)
│       ├── storage.py                 # StorageClient (MinIO/S3 wrapper)
│       ├── logger.py                  # Structured JSON logging with correlation IDs
│       ├── email_renderer.py          # Jinja2 email template rendering
│       ├── taxonomy.py                # Species taxonomy utilities
│       ├── species.py                 # Species data helpers
│       ├── geo.py                     # GPS and spatial helpers
│       ├── deployments.py             # Site and deployment grouping logic
│       ├── classification_threshold.py # Per-project classification thresholds
│       └── templates/                 # Shared email templates (base + per-notification)
│
├── models/                            # ML model weights (gitignored, downloaded at runtime)
│   ├── detection/                     # MegaDetector (auto-downloaded from GitHub)
│   └── classification/                # DeepFaune or SpeciesNet (auto-downloaded)
│
├── scripts/
│   ├── create_admin_invitation.py     # Create admin user invitation tokens
│   ├── populate_demo_data.py          # Generate demo dataset
│   ├── shift_demo_dates.py            # Shift demo dates for freshness
│   ├── backfill_deployment_periods.py # Backfill camera deployment data
│   ├── backfill_sites.py              # Backfill sites from camera positions
│   ├── backfill_camera_tags_to_sites.py # Migrate legacy camera tags to sites
│   ├── merge_contiguous_deployments.py # Merge adjacent deployments
│   ├── cleanup_empty_deployments.py   # Remove deployments with no images
│   ├── regenerate_thumbnails.py       # Rebuild image thumbnails
│   ├── rehydrate_cold_to_hot.py       # Pull cold-tier objects back to local storage
│   ├── cold_tier_orphan_check.sh      # Find cold-tier objects with no DB record
│   ├── backup.sh                      # Nightly database and image backup
│   ├── restore.sh                     # Restore from backup
│   ├── update-database.sh             # Run Alembic migrations and backfills
│   └── verify-redis-security.sh       # Redis security validation
│
├── tests/                             # Pytest test suite
│   ├── conftest.py                    # Shared fixtures and env setup
│   ├── api/
│   ├── classification/
│   ├── detection/
│   ├── ingestion/
│   ├── notifications/
│   ├── notifications_email/
│   ├── notifications_telegram/
│   └── shared/
│
├── ansible/                           # Deployment automation
│   ├── playbook.yml                   # Main playbook
│   ├── inventory.yml.example
│   ├── group_vars/                    # Config variables (passwords, domain, email, etc.)
│   └── roles/                         # app-deploy, docker, nginx, pure-ftpd, ssl,
│                                      #   security, security-check, dev-tools
│
├── docs/                              # MkDocs documentation site
│   ├── index.md
│   ├── deployment.md
│   ├── setup-guide.md
│   ├── camera-requirements.md
│   ├── sites-and-deployments.md
│   ├── speciesnet-setup.md
│   ├── update-guide.md
│   ├── operations.md
│   ├── restore-guide.md
│   ├── dev-server-setup.md
│   ├── install-on-phone.md
│   └── architecture.md
│
├── email_previews/                    # HTML previews of all email templates
├── docker-compose.yml                 # All services (profiles: deepfaune, speciesnet, demo)
├── mkdocs.yml                         # Docs site config
├── pyproject.toml                     # Pytest config
├── CONVENTIONS.md                     # Code conventions
├── DEVELOPERS.md                      # This file
├── TODO.md                            # Active task tracker
├── VERSION                            # Current version (updated by CI on git tag)
├── LICENSE                            # MIT
└── README.md                          # User-facing project description
```

## Message queue pipeline

```
FTPS upload → Ingestion → [image-ingested]
                              → Detection → [detection-complete]
                                                → Classification → [notification-events]
                                                                        → Notifications → [notification-email]
                                                                                        → [notification-telegram]

Bulk upload → API stages files → [bulk-upload-job-process]
                                     → Bulk-upload worker → [image-ingested-bulk]
                                                                → Detection → [detection-complete-bulk]
                                                                                  → Classification → ...
```

Camera uploads and bulk (SD-card) uploads run through the same detection and
classification workers. Bulk-origin images use parallel `-bulk` queues, and the
workers consume both with strict priority, so live camera traffic always jumps
ahead of a large import.

Queue names (defined in `shared/shared/queue.py`):
- `image-ingested` carries new images from ingestion to detection
- `detection-complete` carries detected images from detection to classification
- `notification-events` carries notification triggers (from classification and other producers) to the notification coordinator
- `notification-email` carries email messages to the email worker
- `notification-telegram` carries Telegram messages to the Telegram worker
- `image-ingested-bulk` and `detection-complete-bulk` are the lower-priority bulk-upload variants of the two pipeline queues
- `bulk-upload-job` and `bulk-upload-job-process` carry bulk-upload jobs to the bulk-upload worker (the process variant jumps ahead of pending jobs)
- `failed-jobs` is the dead-letter queue

## Docker Compose profiles

- **`deepfaune`** is the full stack with DeepFaune classifier (38 European species)
- **`speciesnet`** is the full stack with SpeciesNet classifier (2,498 global species)
- **`demo`** runs only the API, database, and frontend (no ML workers)

## Database migrations

Migrations live in `services/api/alembic/versions/`. To create a new migration:

```bash
docker compose exec api alembic revision --autogenerate -m "description_of_change"
```

To apply migrations on a running server:

```bash
bash scripts/update-database.sh
```

## Timestamp conventions

Two column kinds, do not mix them up:

- **Camera-clock** (`Image.captured_at`, `CameraHealthReport.reported_at`): naive `TIMESTAMP`, holds the camera's wall-clock reading as-is, interpreted under `ServerSettings.timezone`. Ingestion never converts or anchors it. Never infer the tz from GPS, the server setting is canonical.
- **Server wall-clock** (`verified_at`, `liked_at`, `sent_at`, any `server_default=func.now()`): aware `TIMESTAMPTZ`, always UTC.

Rules:

- Filters on camera-clock columns must use naive datetimes. Use `_server_now(db)` from `services/api/routers/statistics.py`, or `datetime.now(ZoneInfo(server_tz)).replace(tzinfo=None)`. Passing `datetime.now(timezone.utc)` crashes with `can't subtract offset-naive and offset-aware datetimes`.
- Never reintroduce `AT TIME ZONE 'UTC'` on these columns, that was a fix-on-read hack for the pre-refactor mistagged-UTC storage and is gone.
- When serializing a camera-clock value to ISO 8601, localize first with `.replace(tzinfo=ZoneInfo(server_tz))` so the output carries the correct DST-aware offset.
- Server wall-clock filters stay aware UTC as before.

## Infrastructure deployment

See [docs/deployment.md](docs/deployment.md) for deployment, and [docs/update-guide.md](docs/update-guide.md) for updates.

## Logging and debugging

All services write structured JSON to stdout, captured by Docker.

**How to log in your code:**
```python
# Backend (Python)
from shared.logger import get_logger
logger = get_logger("my-service")
logger.info("Processing started", image_id="abc-123", duration_ms=450)
logger.error("Processing failed", error=str(e), exc_info=True)
```

```typescript
// Frontend (TypeScript)
import { logger } from '@/utils/logger';
logger.info('Component mounted');
logger.error('API call failed', { component: 'Dashboard', status: 500 });
```

**View logs:**
```bash
docker compose logs api --tail 50
docker compose logs -f api  # Follow
```

**Correlation IDs for tracing:**
- `request_id` is auto-generated per API request
- `image_id` tracks one image through the entire pipeline
- `user_id` tracks user actions

## Running tests

```bash
# Run all tests
pytest tests/ -v

# Run tests for one service
pytest tests/ingestion/ -v

# Run a specific test file
pytest tests/ingestion/test_daily_report_parser.py -v

# Skip ML-dependent tests (used in CI)
pytest tests/ -m "not ml"
```
</content>
</invoke>
