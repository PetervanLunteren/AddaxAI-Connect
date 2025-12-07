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

**Key principles:**
1. **Crash early and loudly** - Fail hard in development so bugs cannot hide. Never allow silent failures.
2. **Explicit configuration** - No defaults. If something is missing, stop and surface it immediately.
3. **Type hints everywhere** - Make expectations clear and support safe refactoring.
4. **Short and clear documentation** - Keep explanations concise without losing clarity.
5. **Open source friendly** - Never commit secrets or anything that should not be public.
6. **No backward compatibility** - The project is in motion and has no users. Refactor freely when needed.
7. **Prefer simple solutions** - Use straightforward approaches that follow the conventions. Avoid cleverness when simplicity works.
8. **Follow the established conventions** - Keep structure predictable so the codebase stays readable and easy to maintain. 

**Remember:** It's better to crash during development than to hide bugs that cause problems later. We'll add resilience (retries, fallbacks, graceful degradation) after the core functionality works.

## Repository Structure

Can change slightly, but should be something like this.

```
addaxai-connect/
├── services/                    # All microservices
│   ├── ingestion/              # FTPS watcher (Python)
│   ├── detection/              # Object detection worker (Python + PyTorch/TF)
│   ├── classification/         # Species classification worker (Python + PyTorch/TF)
│   ├── api/                    # FastAPI backend
│   └── frontend/               # React + Vite frontend
│
├── models/                     # Model weights (gitignored, downloaded from Hugging Face)
│   ├── detection/
│   └── classification/
│
├── monitoring/                 # Grafana, Prometheus, Loki configs
│   ├── prometheus.yml
│   ├── loki-config.yml
│   └── grafana-dashboards/
│
├── scripts/                    # Admin and deployment scripts
│   ├── create_user.py
│   ├── backup.sh
│   └── restore.sh
│
├── docs/                       # Documentation
│   ├── architecture.md
│   ├── development.md
│   └── deployment.md
│
├── docker-compose.yml          # Production config
├── docker-compose.dev.yml      # Development config
├── .env.example                # Environment variable template
├── .gitignore
├── README.md                   # User-facing documentation
├── PROJECT_PLAN.md             # Implementation roadmap
└── LLM.md                      # This file (AI assistant guidelines)
```



## Infrastructure Deployment

### Prerequisites
- Ansible installed locally (`brew install ansible` on macOS)
- Fresh Ubuntu 24.04 VM
- SSH access with root user
- Domain name with DNS A record pointing to VM IP

### Quick Start

1. **Configure inventory**
```bash
cp ansible/inventory.yml.example ansible/inventory.yml
# Edit inventory.yml with your VM IP
```

2. **Configure variables**
```bash
cp ansible/group_vars/dev.yml.example ansible/group_vars/dev.yml
# Edit dev.yml with passwords and domain name
```

3. **Add SSH host key**
```bash
ssh-keyscan -H YOUR_VM_IP >> ~/.ssh/known_hosts
```

4. **Deploy infrastructure**
```bash
cd ansible
ansible-playbook -i inventory.yml playbook.yml
```

### Deployed Services

**Host-level services:**
- FTPS server (vsftpd) on ports 21, 990, 40000-50000
- Nginx reverse proxy on ports 80, 443
- SSL/TLS certificates (Let's Encrypt)

**Docker containers:**
- PostgreSQL with PostGIS
- Redis message queue
- MinIO object storage
- Prometheus, Loki, Promtail (monitoring)

### Selective Deployment

Run specific roles:
```bash
ansible-playbook -i inventory.yml playbook.yml --tags ssl
ansible-playbook -i inventory.yml playbook.yml --tags nginx,web
ansible-playbook -i inventory.yml playbook.yml --tags security-check  # Run only security verification
```

Available tags: `security`, `docker`, `vsftpd`, `nginx`, `ssl`, `dev-tools`, `app-deploy`, `security-check`

### Security Verification

The playbook automatically runs security checks at the end of deployment. To skip security checks:
```bash
ansible-playbook -i inventory.yml playbook.yml --skip-tags security-check
```

To run only security checks (without deployment):
```bash
ansible-playbook -i inventory.yml playbook.yml --tags security-check
```

Manual security check on the VM:
```bash
sudo /usr/local/bin/security-check.sh
```

### FTPS Testing

```bash
brew install lftp
lftp -u camera,PASSWORD -e "set ssl:verify-certificate no; set ftp:ssl-force true; put test.txt; bye" YOUR_VM_IP
```

### Endpoints

- **Web UI**: cameratrap.example.com
- **FTPS**: ftp://camera@YOUR_VM_IP:21
- **Uploads**: `/opt/addaxai-connect/uploads/`

### Monitoring & Admin Access

**Via HTTPS (password protected):**
- MinIO Console: `https://yourdomain.com/minio-console/`
- Prometheus: `https://yourdomain.com/prometheus/`
- Loki: `https://yourdomain.com/loki/`
- Username: `admin`
- Password: Set in `group_vars/dev.yml` as `monitoring_password`

**Via SSH Tunnel (alternative):**
```bash
ssh -L 9090:localhost:9090 user@your_vm_ip  # Prometheus
ssh -L 3100:localhost:3100 user@your_vm_ip  # Loki
ssh -L 9001:localhost:9001 user@your_vm_ip  # MinIO console
```

**Direct Container Access:**
```bash
# PostgreSQL
docker exec -it addaxai-postgres psql -U addaxai

# Redis
docker exec -it addaxai-redis redis-cli -a YOUR_REDIS_PASSWORD

# MinIO client
docker exec -it addaxai-minio mc alias set local http://localhost:9000 minioadmin PASSWORD
```

### Security Notes

**Docker and UFW Firewall:**
Docker bypasses UFW firewall rules by directly manipulating iptables. This means:
- Ports exposed in `docker-compose.yml` are accessible even if UFW doesn't allow them
- **Never expose sensitive services (Redis, PostgreSQL) via port bindings**
- Always use Docker's internal networks for inter-service communication
- Only expose ports that need external access (web, API, FTPS)

**Redis Security:**
Redis is configured with:
- No public port binding (only accessible within Docker network)
- Password authentication required (`REDIS_PASSWORD`)
- Connection URL format: `redis://:PASSWORD@redis:6379/0`

To verify Redis is secure: `scripts/verify-redis-security.sh`

### Troubleshooting

**HTTPS not working after deployment:**
```bash
ansible-playbook -i inventory.yml playbook.yml --tags ssl
```

**FTPS uploads failing:**
```bash
# Check permissions
sudo ls -la /opt/addaxai-connect/uploads/
sudo chown camera:camera /opt/addaxai-connect/uploads
sudo chmod 775 /opt/addaxai-connect/uploads
```

**Redis connection refused:**
```bash
# Check if Redis is running
docker ps | grep redis
# Check logs
docker logs addaxai-redis
# Verify password in .env matches docker-compose
grep REDIS_PASSWORD /opt/addaxai-connect/.env
```
