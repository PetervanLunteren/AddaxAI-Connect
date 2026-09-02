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

### Site-restricted viewers
A project-viewer membership can carry a site allow-list in
`project_memberships.site_ids`. Null means all sites (every membership
made before this feature), a non-empty list restricts the viewer to
those sites, an empty list is rejected so "all sites" has one
representation. Only viewers can be scoped; admins are always
project-wide.

The rules for a restricted viewer:
- Hard hide: out-of-scope sites do not exist for them anywhere (site
  lists, cameras, images, statistics, exports, feed, image bytes).
  Totals mean totals over their sites.
- Fail closed: data without a resolved site (images with no deployment,
  rejections, inventory cameras) is invisible to them.
- A camera is visible when its current site (latest deployment) is in
  the allow-list. Statistics filters use the image's own deployment,
  which is time-correct for historical data.
- Alert rules are clamped to the allow-list at write time (API) and at
  evaluation time (worker), so rules created before a restriction cannot
  leak. Project-wide preference emails (`email_report`,
  `excessive_images`) are blocked for them.
- New sites are not visible until an admin adds them to the scope.

The scope is resolved in one place, `get_allowed_site_ids` in
`services/api/auth/project_access.py` (None = unrestricted, list = only
these sites), and the shared SQL clauses and pure helpers live in
`services/api/utils/site_scope.py`. Every new viewer-reachable endpoint
that touches per-site data must apply the scope through these helpers.

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
│   │   ├── worker.py                  # Entry point (event loop + APScheduler)
│   │   ├── detection_alerts.py        # Real-time detection alert rules (live event path)
│   │   ├── email_report.py            # Daily/weekly/monthly email report generation
│   │   ├── scheduled_species_reports.py # Scheduled species report emails (per-user rules)
│   │   ├── report_stats.py            # Report statistics
│   │   ├── camera_alerts.py           # User-defined camera condition alert rules
│   │   ├── excessive_images.py        # Excessive image alerts
│   │   ├── project_inactivity.py      # Project inactivity alerts
│   │   ├── disk_usage_alert.py        # Disk usage alerts
│   │   ├── delivery_liveness.py       # Worker heartbeat and queue depth alerts
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
│   ├── notifications-earthranger/     # EarthRanger delivery via the Gundi sensors API
│   │   ├── worker.py                  # Entry point (posts the event, attaches the image)
│   │   └── db_operations.py           # Log status and integration health
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
│   │   │   ├── camera_maintenance.py  # Camera maintenance event log
│   │   │   ├── site_groups.py         # Merged sites (site groups) for the independence interval
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
│   │   │   ├── camera_alert_rules.py  # Camera condition alert rules
│   │   │   ├── integrations.py        # Project integrations (EarthRanger key, status, test event)
│   │   │   ├── detection_alert_rules.py # Real-time detection alert rules
│   │   │   ├── scheduled_reports.py   # Scheduled species report rules
│   │   │   ├── rule_helpers.py        # Shared helpers for the rule routers
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
│   │       ├── camera_recency.py      # Per-camera last-capture / last-arrival lookups
│   │       ├── deployment_edits.py    # Reassign/recompute/merge plumbing (deployments + feed)
│   │       ├── feed.py                # Feed candidate-site helper
│   │       ├── detection_filtering.py # Detection confidence and class filtering
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
│       ├── camera_status.py           # Camera liveness rule (active / inactive / never_reported)
│       ├── earthranger.py             # Gundi event payloads and client for the EarthRanger channel
│       ├── notify_guard.py            # Development server allow-lists for outbound notifications
│       ├── device.py                  # The one rule for cpu vs cuda in the ML workers
│       ├── taxonomy.py                # Species taxonomy utilities
│       ├── species.py                 # Species data helpers
│       ├── geo.py                     # GPS and spatial helpers
│       ├── deployments.py             # Site and deployment grouping logic
│       ├── independence_filter.py     # Independent-detection (capture event) filtering
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
│   ├── inventory.yml.example           # Which servers exist (your copy lives in a private repo)
│   ├── group_vars/all/                 # Settings shared by every server (example only)
│   ├── host_vars/                      # Per-server settings and passwords (example only, real ones vault-encrypted elsewhere)
│   ├── scripts/import-host-vars.sh     # Build host_vars from a running server
│   ├── README.md                       # Layout and how to target one server
│   └── roles/                         # app-deploy, docker, nginx, pure-ftpd, ssl,
│                                      #   security, security-check, dev-tools
│                                      #   (docker/tasks/nvidia.yml: container toolkit when use_gpu)
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
│   ├── install-as-app.md
│   └── architecture.md
│
├── email_previews/                    # HTML previews of all email templates
├── docker-compose.yml                 # All services (profiles: deepfaune, speciesnet, demo)
├── docker-compose.gpu.yml             # Override: GPU for the ML workers, applied via COMPOSE_FILE in .env
├── mkdocs.yml                         # Docs site config
├── pyproject.toml                     # Pytest config
├── CONVENTIONS.md                     # Code conventions
├── DEVELOPERS.md                      # This file
├── TODO.md                            # Active task tracker
├── VERSION                            # Current version, written before each release tag
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
                                                                                        → [notification-earthranger]

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
- `notification-earthranger` carries Gundi events to the EarthRanger worker
- `image-ingested-bulk` and `detection-complete-bulk` are the lower-priority bulk-upload variants of the two pipeline queues
- `bulk-upload-job` and `bulk-upload-job-process` carry bulk-upload jobs to the bulk-upload worker (the process variant jumps ahead of pending jobs)
- `failed-jobs` is the dead-letter queue

## Docker Compose profiles

- **`deepfaune`** is the full stack with DeepFaune classifier (38 European species)
- **`speciesnet`** is the full stack with SpeciesNet classifier (2,498 global species)
- **`demo`** runs only the API, database, and frontend (no ML workers)

## GPU inference

Off by default. One boolean in `host_vars`, `use_gpu`, and everything
follows from it; a server that never sets it runs exactly as before.

- **The device rule** is `select_device` in `shared/shared/device.py`, the
  one place that turns `USE_GPU` into `cpu` or `cuda`. False is always cpu.
  True with a visible CUDA device is cuda. True without one raises, and the
  worker never starts. No silent CPU fallback: it would leave a GPU server
  twenty times slower with nobody told, while a crash-looping worker stops
  its heartbeat and the liveness alert fires within the hour. The function
  takes `cuda_available` as an argument, so it is tested without torch and
  `shared` never imports torch.
- **Workers** decide once in `main()`, before the model download, and pass
  the device to `load_model(device)`. Detection uses megadetector's
  `force_cpu`; DeepFaune keeps reading the checkpoint onto the CPU and only
  moves the model; SpeciesNet passes `device` to its classifier. After the
  load each worker writes the device to `device:detection` or
  `device:classification` (`RedisQueue.record_device`), which the health
  endpoint shows as a GPU or CPU pill, only on a healthy row because the
  key has no TTL.
- **The images need no change.** The PyPI torch wheel they install is the
  CUDA build, so every image, CPU server or not, already carries the CUDA
  13 runtime (which is most of their size). That also sets the host floor:
  CUDA 13 needs the 580 driver branch or newer.
- **Compose.** `docker-compose.gpu.yml` adds `gpus: all` and `USE_GPU=true`
  to the three ML services and nothing else; `docker-compose.yml` is not
  touched. Ansible writes `COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml`
  into `.env` when `use_gpu` is true, and compose reads that from `.env`,
  so no script needs a `-f`. The flag lives in the override on purpose: one
  file grants the device and sets the flag, so they cannot disagree. A
  device request on a host without the NVIDIA runtime fails the container
  start, which is why it cannot be unconditional.
- **Ansible.** `roles/docker/tasks/nvidia.yml`, imported when `use_gpu` is
  true: asserts `nvidia-smi` reports 580 or newer with the fix in the
  message, installs `nvidia-container-toolkit`, registers the runtime with
  docker and restarts it only when it was missing (never
  `--set-as-default`). The driver itself is a prerequisite, documented in
  `docs/deployment.md`: the Canonical-signed `nvidia-driver-580-server`
  package, which works under Secure Boot and rebuilds nothing on kernel
  updates. The toolkit repo is not a security origin, so unattended-upgrades
  never touches it.
- **Gate.** `scripts/verify-server.sh` has a `gpu` check that only appears
  when `.env` says `USE_GPU=true`: each running ML worker must see a CUDA
  device from torch.
- **Known interaction.** A kernel or driver security update can leave
  `nvidia-smi` with a version mismatch until the 04:30 reboot; a worker
  restarted in that window refuses to start, by design, and comes back
  after the reboot. No `apt-mark hold`.

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

## EarthRanger channel

EarthRanger is a third delivery channel next to email and Telegram, not a
mirror of the database. A rule with `earthranger` in `channels` posts one
Gundi event per alert (per camera for camera alerts), with the annotated
image attached; Gundi forwards it to the EarthRanger site the project's
Gundi connection points at. Sent events are never updated or deleted, and
nothing is backfilled. User docs: `docs/integrations/earthranger.md`.

- The channel is project level. Only project admins may put `earthranger`
  on a rule, and only when the project has an enabled row in
  `project_integrations` (kind `earthranger`, the Gundi API key in
  `config`). `check_earthranger_channel` in `routers/rule_helpers.py` is
  the one check. Rule lists take `?channel=earthranger` to show every
  project rule on that channel, and `load_rule_row` lets any admin edit
  those whoever made them.
- Payloads are built by the pure functions in `shared/shared/earthranger.py`
  (`build_detection_event`, `build_camera_event`, `build_test_event`), so the
  coordinator, the worker and the API test endpoint agree. `recorded_at`
  is the naive camera-clock `captured_at` localised with
  `ServerSettings.timezone`; a naive timestamp would be read as UTC by
  Gundi. Events without coordinates are skipped, a ranger cannot act on
  them.
- `services/notifications/earthranger_channel.py` writes the notification
  log row (`channel="earthranger"`, user = the rule creator) and queues
  `{notification_log_id, project_id, event, attachment_minio_path}`. The
  worker posts the event, then the attachment from `thumbnails/annotated/`,
  and stamps `last_sent_at`, `events_sent`, `last_error` and
  `health_status` on the integration row. No retry, like the other
  delivery workers; Gundi itself retries delivery to EarthRanger.
- Gundi's own dedupe is a one hour content hash, and it stores no id in
  EarthRanger, so the notification log is the record of what was sent.
- Development servers: `scripts/restore.sh` deletes the restored
  `project_integrations` rows on a dev box, the same way it drops the
  Telegram bot config. A restored production database carries real Gundi
  keys, and an alert fired on dev would land on a real ranger map. No
  allow-list, dev only holds keys pasted there on purpose.
- Event type slugs (`addaxai_connect_detection`, `addaxai_connect_camera_alert`) are
  constants in `shared/earthranger.py` and must exist on the EarthRanger
  site with the schema from the user docs. Type and detail keys carry the
  `addaxai_connect_` prefix (EarthRanger's one-namespace-per-source
  convention). The plain `addaxai_` namespace stays reserved for the
  desktop AddaxAI, whose events will carry verified labels and updates and
  so get their own type. `project_integrations` is
  generic on purpose: the next outbound integrations (each with its own
  page under the Integrations menu) get a row kind, not a table each.

## Camera liveness status

The `active / inactive / never_reported` badge has one rule, in
`shared/shared/camera_status.py`. It is driven by **last contact**: the most
recent moment a camera reached the server, either with a daily health report
or with a live image.

- Never use health reports alone. Some camera models send no daily report at
  all (INSTAR), and report parsing can break while the camera keeps sending
  photos. A report-only rule marks those cameras silent forever.
- Always pass server receive times (`CameraHealthReport.created_at`,
  `Image.ingested_at`), never the camera-clock columns (`reported_at`,
  `captured_at`). A camera trap clock is often unset or years off at
  deployment. The helper raises on a naive datetime so a camera-clock column
  cannot be wired in by accident.
- Only `Image.origin == 'live'` counts. A bulk upload is an SD card carried
  in by hand, so it must never make a stolen camera look alive.

The API side gets the timestamps from `fetch_camera_recency` in
`services/api/utils/camera_recency.py`, which returns both clocks in two
grouped queries. The camera alert rules and the theft watch define contact the
same way, so all of them agree.

## Rejected files

A file ingestion refuses is moved to `<upload_root>/rejected/<reason>/` and
gets one row in `rejections` (`shared/shared/models.py`). The row is the
record: reason, details, EXIF, device id, `camera_id` and `project_id`
resolved at reject time, and `source_path`, where the file sat under the
upload root before the move. There is no sidecar file. Every reader (Live
feed, the per-camera count and tab, File management, the daily alert) reads
the table; nothing scans the filesystem at read time.

- `camera_id` is set only when the device id was readable before the
  reject (missing or invalid GPS, missing date). Those rows count on the
  camera. Rows without one (no metadata, unknown camera model) show only on
  the server-admin File management page.
- Reprocess moves the file back to `source_path` (`reprocess_destination`
  in `services/api/routers/ingestion_monitoring.py`), so a path-based
  profile identifies it again. Rows from before the column existed have
  NULL and fall back to the upload root; they age out.
- Site-restricted viewers see no rejections anywhere: a rejection has no
  site, fail closed. The API sends `rejected_count_recent: null` for them
  and the UI hides the column, the filter and the tab, so the number is
  never a false zero.
- One count per camera from one query (`fetch_recent_rejection_counts`):
  the last `REJECTED_RECENT_DAYS` (7). It drives the Cameras column, the
  attention chip, the filter and the slide-out Overview row, which all just
  say "rejected files" without the window. The Rejected tab lists every row
  still kept and splits them on the same cutoff (`recent` flag): recent
  open, older collapsed. Users see "recent" and "older", never 7 days. On
  drenthe 30 of 30 cameras had a rejection in 30 days, 24 of them exactly
  one old setup shot; only 2 had rejected anything that week.
- Rejected files have no stored thumbnail. List views ask the live-feed
  image endpoint for `?thumb=true`, which downscales on the fly
  (`REJECTION_THUMB_WIDTH`); a camera with 50 rejections is a few hundred
  KB instead of 20 MB of originals.
- Retention is 30 days, files and rows together, in
  `cleanup_old_rejected_files` (`services/ingestion/main.py`). Every count
  is therefore "within the last 30 days" without a parameter.

## Worker liveness

Every long-running worker proves it is alive by stamping a Redis key with
the current UTC time. One writer, `RedisQueue.stamp_heartbeat`, and one
staleness rule, 15 minutes, in `shared/shared/queue.py`.

- Queue consumers stamp inside `consume_forever` and
  `consume_forever_priority`, at the top of the loop and **before** the
  pop. That asserts "the loop is alive", not "the process exists": a
  callback wedged on a hung inference never comes back to stamp again.
- The BRPOP timeout is therefore finite (`HEARTBEAT_TICK_SECONDS`). An
  idle worker has to return to the loop top and tick, or a quiet night
  would look like an outage.
- Ingestion consumes no queue, it watches the filesystem, so it stamps
  from its own loop and only while the watchdog observer thread is alive
  (`heartbeat_due` in `services/ingestion/main.py`). Watchdog can die
  while the process survives, and nothing would be picked up again.
- No TTL on the keys, so the last seen time survives a restart, and a
  missing key means the worker never ran against this Redis.

Two readers, and they must agree: `/api/health/services` for the page,
and `check_delivery_liveness` for the hourly alert. Never judge a worker
by whether its queue is readable. A queue accepts publishes with no
consumer, so that reported three dead workers as healthy for months.

The queue-depth trigger applies to the delivery workers only. For the
pipeline workers a deep queue is a normal backlog, not a fault.

## Server hardening

Set by the `security` ansible role, checked afterwards by `security-check`.

- **Firewall.** ufw denies incoming by default. Open: SSH, 80, 443, 21, 990
  and the passive FTP range. Postgres, Redis and MinIO stay on the docker
  network and are never published to the host.
- **Automatic security updates.** `unattended-upgrades`, security origins
  only. The `#clear` in the config matters: apt appends to a list instead of
  replacing it, so without it the distro defaults stay.
  Docker is **not** covered. It comes from `download.docker.com`, which is not
  a security origin, and that is on purpose: an unattended daemon upgrade
  restarts every container mid-upload. Upgrade docker during a normal update.
- **Reboots happen only when a patch needs one**, at 04:30, which is a kernel
  or a core library and so roughly monthly. It is not a scheduled reboot: with
  no `/var/run/reboot-required` nothing happens. Measured on dev, the server
  was back in 15 seconds and all 13 containers came up on their own
  (`restart: unless-stopped`). `security-check` warns while a reboot is still
  pending, so a server sitting on a patched-but-not-running kernel is visible.
- **fail2ban on SSH only.** No FTPS jail on purpose. Every camera signs in
  with the same account from a mobile network, and a carrier shares one
  address over many devices, so one camera with a wrong password could ban a
  whole site silently. Pure-FTPd already caps clients per IP.
- **SSH keys only.** Password login off, root reachable by key because
  ansible connects as root. The drop-in is named `01-addaxai-hardening.conf`
  because sshd uses the **first** value it reads for a keyword and cloud
  images leave a `50-cloud-init.conf` behind that turns password login back
  on. A file sorting after that one is read and ignored, which looks hardened
  and is not. The role reads `sshd -T` back and fails the deploy if the
  setting did not take, on every run, so drift shows up too.

If you lock yourself out, the ban lasts one hour. There is no `ignoreip`, so
a fumbled key counts like anyone else. Get in through the provider's web
console and run `fail2ban-client set sshd unbanip <your-ip>`.

`security-check` must run as root (`sudo security-check.sh`). It shells out to
sudo, and as an unprivileged user without a terminal every one of those checks
reports a failure that is not real.

What this does not do: there is no intrusion detection, no file integrity
monitoring and no log shipping. The server notices damage (disk filling,
workers dying, backups failing), not a quiet intruder.

## Infrastructure deployment

See [docs/deployment.md](docs/deployment.md) for deployment, and [docs/update-guide.md](docs/update-guide.md) for updates.

### Which code a server runs

Servers run tagged releases, never the head of `main`. A tag is the commit the
dev sweep tested against every production dataset; main between tags is work
in progress. Three places agree on this:

- The playbook checks out `git_version` (`ansible/roles/dev-tools`). Unset,
  it resolves the newest `vX.Y.Z` tag on the remote at deploy time, so a fresh
  server always gets the latest release. A tag pins one. `main` is for a dev
  server only, set in its host_vars.
- An update is `git fetch origin --tags && git checkout vX.Y.Z` plus a
  rebuild (update guide), so a server sits on a detached HEAD at the tag.
  Rollback is the same command with the previous tag.
- `VERSION` is written and committed before the tag is made, so
  `git show vX.Y.Z:VERSION` equals the tag. Tags before v0.7.0 carry the
  previous version; work out an old server's position from its commit, not
  from VERSION.

`--tags env-refresh` also runs the checkout task, so on an existing server it
moves the code to `git_version` and rebuilds. That is an update, not a config
change. Use `sync-config` for config.

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

## Frontend UI development loop

How to see and verify UI changes in a real browser without deploying to a server. Code edits hot-reload in seconds while all data comes from the dev server.

### Local vite against the dev API

1. Create `services/frontend/.env.local` (gitignored):

   ```
   VITE_PROXY_TARGET=https://dev.addaxai.com
   SWEEP_EMAIL=<test account email>
   SWEEP_PASSWORD=<test account password>
   ```

2. Run the frontend locally:

   ```bash
   cd services/frontend
   npm install
   npm run dev
   ```

3. Open http://localhost:5173 and log in. Edits under `src/` hot-reload instantly.

Without `VITE_PROXY_TARGET` the proxy falls back to the docker-internal API, so container builds behave exactly as before. Auth is a bearer token in localStorage, so nothing cookie-related needs configuring.

The test account is a dedicated server-admin account on the dev server, invited via the User Assignment page. Do not put personal credentials in `.env.local`.

### Screenshot sweep

```bash
cd services/frontend
npm run sweep
```

Logs in with the `SWEEP_*` credentials, visits every page at phone (390px), tablet (768px), and desktop (1440px) widths, and writes screenshots plus `report.txt` to `services/frontend/ui-sweep-output/` (gitignored). The report flags console errors and page-level horizontal overflow per route. The vite dev server must be running. Run the sweep before and after UI changes and compare the screenshots.

The route list lives at the top of `scripts/ui-sweep.mjs`. When adding a page to `src/App.tsx`, add it there too.

The sweep refuses to run against anything but a dev server. It asks the target API via `/api/admin/dev-mode-status`, which uses the deny-list in `services/api/utils/dev_mode.py`, so a wrong proxy target cannot point it at production.

### Interactive browser driving

`.mcp.json` in the repo root registers a Playwright MCP server. Claude Code sessions pick it up automatically and can open a browser, resize it to a phone viewport, click through pages, and take screenshots. Useful for reproducing one specific UI bug interactively; the sweep is for coverage.

### Verification gate for frontend changes

```bash
npm run build      # typechecks first, then bundles; must pass
npm run sweep      # at least the affected viewports, compare screenshots
```

`npm run build` runs `tsc --noEmit && vite build`, so a type error fails the
build and the container image never gets created. The bar is zero type errors,
not "no new errors". Use `npm run typecheck` while working to check types
without bundling.

Keep it at zero. Vite strips types without checking them, so the typecheck is
the only thing standing between a type error and production. A tolerated pile
of errors hides real bugs: the verification panel silently erased sex and
age-class data for months while `tsc` reported it on every run.

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
