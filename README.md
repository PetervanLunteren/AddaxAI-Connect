# AddaxAI Connect
Containerized microservices platform based on [AddaxAI](https://github.com/PetervanLunteren/addaxai) that processes camera trap images through machine learning models and presents results via web interface. The system automatically ingests images from remote camera traps via FTPS, runs object detection and species classification, and provides real-time updates to users.

**A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org)**

## WHEREWASI?
- I just built the ML workers, the frontend, and wanted to check if everything did what is is supposed to do on a fresh VM. So next time, rebuilt the VM and run ansible again. Fix all the errors down the line and check if you have read/write as ubuntu in the FTPS uploads dir. And whether or not the thumbs are actually thumbs. 

## Roadmap
*This repo is in development! It doesn't work yet...*

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for a more finegrained plan.
- [x] **Infrastructure** - Ansible automation, Docker configs, security hardening
- [x] **Database setup** - SQLAlchemy models, Alembic migrations, PostGIS integration
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

## Setup
1. **Deploy a VM**  
   You can use a provider of your choice, like DigitalOcean or RunPod. The system is tested on `Ubuntu 24.04 (LTS) x64`, but other Ubuntu versions should also work. During VM creation, add your SSH public key (most providers have a field for this). After deployment, take note of the IPv4 address for later steps. All the following steps are on your local machine, not on the VM.

2. **Clone this repo**  
   On your local machine
    ```bash
    git clone https://github.com/PetervanLunteren/AddaxAI-Connect.git
    cd AddaxAI-Connect
    ```

3. **Create Ansible inventory and dev files**
    ```bash
    cd ansible/
    cp inventory.yml.example inventory.yml
    cp group_vars/dev.yml.example group_vars/dev.yml
    ```

4. **Configure inventory variables**  
   Replace in `inventory.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `your_vm_ipv4` | `123.456.789.01` | The IPv4 address of the virtual machine you created in step 1. |
   | `your_ssh_key` | `~/.ssh/id_rsa` | The path to your private SSH key on your local device. |


5. **Set core passwords**  
   Replace in `group_vars/dev.yml`. Make sure to create secure passwords (for example with `openssl rand -base64 32`).

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `app_user_password` | `"securepassword"` | Password you define for `sudo` access on the server. |
   | `ftps_password` | `"securepassword"` | Password you define for FTPS access. |
   | `db_password` | `"securepassword"` | Password you define for the database user. |
   | `minio_password` | `"securepassword"` | Password you define for the Minio storage admin user. |
   | `redis_password` | `"securepassword"` | Password you define for the Redis instance. |
   | `jwt_secret` | `"securesecret"` | Secret key you define for signing JWT tokens. |
   | `monitoring_password` | `"securepassword"` | Password you define for accessing monitoring tools. |


6. **Set domain and tls settings**  
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `domain_name` | `"dev.example.com"` | The domain name your application will use. You must own the domain and have access to its DNS records. |
   | `letsencrypt_email` | `"you@example.com"` | Email address used for Letsencrypt SSL certificate registration. |


7. **Configure email and superadmin**  
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `mail_server` | `"smtp.gmail.com"` | SMTP server address for outgoing email for password resets, registration, and other notifications. |
   | `mail_port` | `587` | SMTP port number. |
   | `mail_username` | `"your.email@example.com"` | Username for authenticating with your mail provider. |
   | `mail_password` | `"securepassword"` | Password or app password for your mail provider. |
   | `mail_from` | `"your.email@example.com"` | Email address that will appear in the 'From' field of system emails. |
   | `superadmin_email` | `"admin@example.com"` or `"admin1@example.com;admin2@example.com"` | Email address(es) for initial superadmin account(s). Multiple emails can be separated by semicolons. These users will be automatically created and added to the allowlist. Other user management will be done from within the UI. |


8. **Add VM to known_hosts**  
   SSH to the VM to accept the host key. Type `yes` when prompted, then `exit` to disconnect.
    ```bash
    ssh -i <your_ssh_key> root@<your_vm_ipv4>
    ```

9. **Test Ansible connection**  
   Should return `pong` if successful.  
    ```bash
    ansible -i inventory.yml dev -m ping
    ```

10. **Run playbook**  
   Deploys entire infrastructure automatically. It will prompt you to do some manual tasks, like DNS record creation. 
    ```bash
    ansible-playbook -i inventory.yml playbook.yml
    ```
11. **Log in to the frontend**  
    When the deployment finishes, open `https://<domain_name>/register` in a browser and register using your `superadmin_email`. You will receive a verification email. Click the link to verify your account, then sign in. You're automatically assigned the 'superuser' role with full control. 

12. **Configure camera traps**  
    Set up your camera traps to upload via FTPS.

    | Setting | Value |
    |---------|-------|
    | Host | `<your_vm_ipv4>` |
    | Port | `21` (control), `990` (FTPS), `40000-50000` (passive) |
    | Username | `camera` |
    | Password | `<ftps_password>` |
    | Protocol | FTPS (explicit TLS) |

13. **Finish and manage your system**  
    After configuration, camera traps will upload images automatically for processing on the server, and detections will be shown in the frontend. You can manage notifications, settings, users, and other features directly in the UI.


## Possible Hiccups

### Email SMTP doesn't work

Some cloud providers (DigitalOcean, AWS, Google Cloud) block outbound SMTP ports (25, 465, 587) to prevent spam. This prevents verification and password reset emails from being sent. You can test this with the command below. If they are blocked, that is because of the cloud provider, and we can't really do anything about that. The solution would be to submit a support ticket to your cloud provider requesting SMTP access for transactional emails.

```bash
python3 -c "import socket; [print(f'Port {p}:', 'OPEN' if socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect_ex(('smtp.gmail.com', p)) == 0 else 'BLOCKED') for p in [25, 465, 587]]"
```

