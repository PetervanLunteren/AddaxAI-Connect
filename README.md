# AddaxAI Connect
Containerized microservices platform that processes camera trap images through machine learning models and presents results via web interface. The system automatically ingests images from remote camera traps via FTPS, runs object detection and species classification, and provides real-time updates to users.

**A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org)**

## Roadmap
*This repo is in development! It doesn't work yet...*

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for a more finegrained plan.
- [x] **Infrastructure** - Ansible automation, Docker configs, security hardening
- [ ] **ML Pipeline** - Ingestion, detection, classification workers
- [ ] **Web App** - FastAPI backend + React frontend
- [ ] **Production** - Testing, deployment, documentation

## Repository structure
- Ansible-based deployment with roles for security, Docker, vsftpd, nginx, SSL, and app deployment
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
- vsftpd for FTPS uploads
- Nginx as reverse proxy
- Docker Compose for orchestration

## Security
Multi-layered security with UFW firewall, TLS/SSL encryption, password authentication on all services, and network isolation. Sensitive services (PostgreSQL, Redis, MinIO, Prometheus, Loki) accessible only within Docker network. Monitoring endpoints protected via nginx reverse proxy with HTTP basic auth.

## Setup
1. **Deploy a VM** - You can use a provider of you choice, like DigitalOcean or RunPod. The system is tested on `Ubuntu 24.02 (LTS) x64`, but other Ubuntu versions should also work. After deployment, take note of the IPv4 address for later steps. All the following steps are on your local machine, not on the VM.

2. **Add to `.ssh/config`** - For easy termnial access. Log in via `ssh <friendly_name>` to test and add host to known hosts. Then exit again. 
    ```bash
    Host <friendly_name>
    HostName <your_vm_ipv4>
    User ubuntu
    IdentityFile ~/.ssh/id_rsa
    ```

3. **Clone current repo**
    ```bash
    git clone https://github.com/PetervanLunteren/addaxai-connect.git
    ```

4. **Create Ansible inventory and dev files**
    ```bash
    cd addaxai-connect/ansible/
    cp inventory.yml.example inventory.yml
    cp group_vars/dev.yml.example group_vars/dev.yml
    ```

5. **Configure variables** - Make sure to create secure passwords (e.g., with `openssl rand -base64 32`). 
    - Replace in `inventory.yml`:
        - `your_vm_ipv4`
    - Replace in `group_vars/dev.yml`:
        - `app_user_password`
        - `ftps_password`
        - `db_password`
        - `minio_password`
        - `redis_password`
        - `jwt_secret`
        - `monitoring_password`
        - `domain_name`
        - `letsencrypt_email`

6. **Test Asible connection** - Should return `"pong"` if succesful.
    ```bash
    ansible -i inventory.yml dev -m ping
    ```

7. **Run playbook**
    ```cmd
    ansible-playbook -i inventory.yml playbook.yml
    ```
