# AddaxAI Connect
Containerized microservices platform based on [AddaxAI](https://github.com/PetervanLunteren/addaxai) that processes camera trap images through machine learning models and presents results via web interface. The system automatically ingests images from remote camera traps via FTPS, runs object detection and species classification, and provides real-time updates to users.

**A collaboration between [Addax Data Science](https://addaxdatascience.com) and [Smart Parks](https://www.smartparks.org)**

## Roadmap
*This repo is in development! It doesn't work yet...*

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for a more finegrained plan.
- [x] **Infrastructure** - Ansible automation, Docker configs, security hardening
- [x] **Database setup** - SQLAlchemy models, Alembic migrations, PostGIS integration
- [x] **ML Pipeline** - Ingestion, detection, classification workers
- [x] **Web App** - FastAPI backend + React frontend
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
   You can use a provider of your choice, like DigitalOcean or RunPod. The system is tested on DigitalOcean's `Ubuntu 24.04 (LTS) x64 - 8GB / 2 Intel CPUs / 160GB NVMe SSD ($48/mo)`, but other Ubuntu versions should also work. During VM creation, add your SSH public key (most providers have a field for this). After deployment, take note of the IPv4 address for later steps. All the following steps are on your local machine, not on the VM.

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
   | `letsencrypt_staging` | `false` | When set to `true`, it uses Let’s Encrypt’s staging environment with test certificates. This helps avoid rate limits during testing. Set it to `false` to request real, trusted certificates. |

7. **Configure email and server admin**
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `mail_server` | `"smtp.gmail.com"` | SMTP server address for outgoing email for password resets, invitations, and other notifications. |
   | `mail_port` | `587` | SMTP port number. |
   | `mail_username` | `"your.email@example.com"` | Username for authenticating with your mail provider. |
   | `mail_password` | `"securepassword"` | Password or app password for your mail provider. |
   | `mail_from` | `"your.email@example.com"` | Email address that will appear in the 'From' field of system emails. |
   | `admin_email` | `"admin@example.com"` | Email address for initial server admin account. During deployment, a temporary password will be generated for this account. You can change it after first login. |

8. **Add VM to known_hosts**  
   Connect to the VM once to accept its SSH host key. When prompted, type `yes`. You'll see a `Permission denied` message, which is expected. This step only ensures the VM’s IP address is added to your `known_hosts` file.
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

11. **Register your admin account**
    When the deployment finishes, a registration URL will be displayed in the Ansible output. Copy this URL and open it in a browser. You'll be directed to a registration page where you can set your password for the `admin_email` you configured. After registration, you're automatically assigned the 'server admin' role with full control. The registration URL expires in 7 days and can only be used once. 

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


## User roles

The system has three role levels:
- **Server admin** - Full access to all projects and system settings
- **Project admin** - Can manage specific projects (cameras, species, users)
- **Project viewer** - Read-only access to specific projects

The initial server admin is created during deployment via `admin_email`.
Other users are invited by server admins or project admins through the web interface.


## Possible Hiccups

### Email SMTP doesn't work

Some cloud providers (DigitalOcean, AWS, Google Cloud) block outbound SMTP ports (25, 465, 587) to prevent spam. This prevents verification and password reset emails from being sent. You can test this with the command below. If they are blocked, that is because of the cloud provider, and we can't really do anything about that. The solution would be to submit a support ticket to your cloud provider requesting SMTP access for transactional emails.

```bash
python3 -c "import socket; [print(f'Port {p}:', 'OPEN' if socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect_ex(('smtp.gmail.com', p)) == 0 else 'BLOCKED') for p in [25, 465, 587]]"
```

