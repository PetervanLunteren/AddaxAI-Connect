# Developer Documentation

## Project Overview

**AddaxAI Connect** is a real-time camera trap platform that:
- Ingests images from remote camera traps via FTPS
- Processes images through ML models (detection → classification)
- Provides a web interface for viewing and analyzing results

**Architecture:** Microservices in a monorepo, orchestrated with Docker Compose
**Deployment:** Ubuntu VM (DigitalOcean)
**Scale:** Hundreds of images per day, 1-10 concurrent users
**Development:** This repo is still in development. We do the testing and deployment on the VM directly, not on the local device. 

---

## Role-based access control

Three-tier system:
- **server-admin** - Full access to all projects, can create projects, manage all users
- **project-admin** - Manages specific projects, can invite users to their projects
- **project-viewer** - Read-only access to specific projects

Users can have different roles in different projects (e.g., admin of Project A, viewer of Project B).

### Permission model
- `users.is_server_admin` boolean flag for server admins
- `project_memberships` table maps users to projects with roles
- No role = no access to that project

### Inviting users
**Server admin:** Can add users to any project with any role via the User Assignment page
**Project admin:** Can add users to their own projects only via the Project Users page

User must have at least one project membership to register (enforced at registration).

## Repository Structure

Can change slightly, but should be something like this.

```
addaxai-connect/
├── services/                    # All microservices
│   ├── ingestion/              # FTPS watcher (Python)
│   ├── detection/              # Object detection worker (Python + PyTorch/TF)
│   ├── classification-deepfaune/ # DeepFaune classification worker (Python + PyTorch/TF)
│   ├── alerts/                 # Alert evaluation worker
│   ├── notifications/          # Notification dispatcher
│   ├── notifications-email/    # Email notification sender
│   ├── notifications-telegram/ # Telegram notification sender
│   ├── api/                    # FastAPI backend
│   └── frontend/               # React + Vite frontend
│
├── models/                     # Model weights (gitignored, downloaded from Hugging Face)
│   ├── detection/
│   └── classification/
│
├── scripts/                    # Admin and deployment scripts
│   ├── create_admin_invitation.py
│   ├── populate_demo_data.py
│   ├── update-database.sh
│   └── verify-redis-security.sh
│
├── docs/                       # Documentation
│   ├── deployment.md
│   ├── dev-server-setup.md
│   └── update-guide.md
│
├── docker-compose.yml          # All services (profiles: deepfaune, speciesnet, demo)
├── CONVENTIONS.md              # Code conventions
├── .gitignore
├── README.md                   # User-facing documentation
└── TODO.md                     # Active task tracker
```



## Infrastructure deployment

See [docs/deployment.md](docs/deployment.md) for deployment, server management, monitoring, and troubleshooting.

## Logging & Debugging

**We use structured JSON logging with correlation IDs.** All services write JSON to stdout, captured by Docker.

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
- `request_id` - Auto-generated per API request
- `image_id` - Track one image through the entire pipeline
- `user_id` - Track user actions

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

