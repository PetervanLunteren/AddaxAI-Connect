# AddaxAI Connect
Containerized microservices platform based on [AddaxAI](https://github.com/PetervanLunteren/addaxai) that processes camera trap images through machine learning models and presents results via web interface. The system automatically ingests images from remote camera traps via FTPS, runs object detection and species classification, and provides real-time updates to users.

**A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org)**

## Roadmap
- [x] **Infrastructure** - Ansible automation, Docker configs, security hardening
- [x] **Database setup** - SQLAlchemy models, Alembic migrations, PostGIS integration
- [x] **ML Pipeline** - Ingestion, detection, classification workers
- [x] **Web App** - FastAPI backend + React frontend
- [ ] **Production** - Testing, deployment, documentation

## Repository structure
- Ansible-based deployment with roles for security, Docker, pure-ftpd, nginx, SSL, and app deployment
- Docker Compose stack defining PostgreSQL, Redis, MinIO, Prometheus, Loki, and Promtail
- Monitoring infrastructure already configured with Prometheus, Loki, and Promtail
- FTPS server for camera trap image uploads
- Infrastructure services (DB, queue, storage) deployed; application services (API, workers) are placeholders

## Key technologies
- PostgreSQL with PostGIS for spatial data
- Redis for message queuing
- MinIO for S3-compatible object storage
- FastAPI-Users for authentication with email verification
- SMTP for transactional emails (verification, password reset)
- Prometheus/Loki/Promtail for monitoring and logging
- Pure-FTPd for FTPS uploads
- Nginx as reverse proxy
- Docker Compose for orchestration

## Technology choices

| Component  | Tech                        | Notes                                      |
|------------|-----------------------------|--------------------------------------------|
| Queue      | Redis                       | FIFO lists with BRPOP, simple pub/sub      |
| Storage    | MinIO                       | S3-compatible, self-hosted                 |
| DB         | PostgreSQL 15 + PostGIS 3.3 | Spatial queries for GPS data               |
| API        | FastAPI                     | Async, auto docs, FastAPI-Users            |
| Auth       | FastAPI-Users               | Email verification, password reset         |
| Email      | SMTP                        | Port blocking possible on some providers   |
| Frontend   | React + Vite + TypeScript   | Modern, fast dev                           |
| Logging    | JSON + Loki + Promtail      | Structured logs, correlation IDs           |
| Metrics    | Prometheus                  | Alerts configured, metrics not exposed yet |
| Deployment | Ansible + Docker Compose    | Single-VM Ubuntu 24.04                     |
| SSL        | Let's Encrypt (certbot)     | Auto-renewal configured                    |

## Security
Multi-layered security with UFW firewall, TLS/SSL encryption, password authentication on all services, and network isolation. Sensitive services (PostgreSQL, Redis, MinIO, Prometheus, Loki) accessible only within Docker network. Monitoring endpoints protected via nginx reverse proxy with HTTP basic auth.

## Getting started

See [docs/deployment.md](docs/deployment.md) for the full setup guide.

## User roles

The system has three role levels:
- **Server admin** - Full access to all projects and system settings
- **Project admin** - Can manage specific projects (cameras, species, users)
- **Project viewer** - Read-only access to specific projects

The initial server admin is created during deployment via `admin_email`.
Other users are invited by server admins or project admins through the web interface.
