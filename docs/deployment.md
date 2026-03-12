# Deployment guide

## Setup

1. **Deploy a VM**
   You can use a provider of your choice, like DigitalOcean or RunPod. The system is tested on DigitalOcean's `Ubuntu 24.04 (LTS) x64 (Premium Intel) - 8GB / 2 Intel CPUs / 160GB NVMe SSD ($48/mo)`, but other Ubuntu versions should also work. During VM creation, add your SSH public key (most providers have a field for this). After deployment, take note of the IPv4 address for later steps. All the following steps are on your local machine, not on the VM.

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


6. **Configure classification model**
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `classification_model` | `"deepfaune"` | `"deepfaune"` (38 European species) or `"speciesnet"` (2,498 global species). |

7. **Set domain and TLS settings**
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `domain_name` | `"dev.example.com"` | The domain name your application will use. You must own the domain and have access to its DNS records. |
   | `letsencrypt_email` | `"you@example.com"` | Email address used for Letsencrypt SSL certificate registration. |
   | `letsencrypt_staging` | `false` | When set to `true`, it uses Let's Encrypt's staging environment with test certificates. This helps avoid rate limits during testing. Set it to `false` to request real, trusted certificates. |

8. **Configure email and server admin**
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `mail_server` | `"smtp.gmail.com"` | SMTP server address for outgoing email for password resets, invitations, and other notifications. |
   | `mail_port` | `587` | SMTP port number. |
   | `mail_username` | `"your.email@example.com"` | Username for authenticating with your mail provider. |
   | `mail_password` | `"securepassword"` | Password or app password for your mail provider. |
   | `mail_from` | `"your.email@example.com"` | Email address that will appear in the 'From' field of system emails. |
   | `admin_email` | `"admin@example.com"` | Email address for initial server admin account. During deployment, a temporary password will be generated for this account. You can change it after first login. |

9. **Add VM to known_hosts**
   Add the VM's SSH host key to your known_hosts file.
    ```bash
    ssh-keyscan -H <your_vm_ipv4> >> ~/.ssh/known_hosts
    ```

10. **Test Ansible connection**
   Should return `pong` if successful.
    ```bash
    ansible -i inventory.yml dev -m ping
    ```

11. **Run playbook**
   Deploys entire infrastructure automatically. It will prompt you to do some manual tasks, like DNS record creation.
    ```bash
    ansible-playbook -i inventory.yml playbook.yml
    ```

12. **Register your admin account**
    When the deployment finishes, a registration URL will be displayed in the Ansible output. Copy this URL and open it in a browser. You'll be directed to a registration page where you can set your password for the `admin_email` you configured. After registration, you're automatically assigned the 'server admin' role with full control. The registration URL expires in 7 days and can only be used once.

13. **Configure camera traps**
    Set up your camera traps to upload via FTPS.

    | Setting | Value |
    |---------|-------|
    | Host | `<your_vm_ipv4>` |
    | Port | `21` (control), `990` (FTPS), `40000-50000` (passive) |
    | Username | `camera` |
    | Password | `<ftps_password>` |
    | Protocol | FTPS (explicit TLS) |

14. **Finish and manage your system**
    After configuration, camera traps will upload images automatically for processing on the server, and detections will be shown in the frontend. You can manage notifications, settings, users, and other features directly in the UI.

## Selective deployment

Run specific roles:
```bash
ansible-playbook -i inventory.yml playbook.yml --tags ssl
ansible-playbook -i inventory.yml playbook.yml --tags nginx,web
ansible-playbook -i inventory.yml playbook.yml --tags security-check  # Run only security verification
```

Available tags: `security`, `docker`, `vsftpd`, `nginx`, `ssl`, `dev-tools`, `app-deploy`, `security-check`

## Security verification

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

## FTPS testing

```bash
brew install lftp
lftp -u camera,PASSWORD -e "set ssl:verify-certificate no; set ftp:ssl-force true; put test.txt; bye" YOUR_VM_IP
```

## Endpoints

- **Web UI**: cameratrap.example.com
- **FTPS**: ftp://camera@YOUR_VM_IP:21
- **Uploads**: `/opt/addaxai-connect/uploads/`

## Monitoring and admin access

**Via HTTPS (password protected):**
- MinIO Console: `https://yourdomain.com/minio-console/`
- Prometheus: `https://yourdomain.com/prometheus/`
- Loki: `https://yourdomain.com/loki/`
- Username: `admin`
- Password: Set in `group_vars/dev.yml` as `monitoring_password`

**Via SSH tunnel (alternative):**
```bash
ssh -L 9090:localhost:9090 user@your_vm_ip  # Prometheus
ssh -L 3100:localhost:3100 user@your_vm_ip  # Loki
ssh -L 9001:localhost:9001 user@your_vm_ip  # MinIO console
```

**Direct container access:**
```bash
# PostgreSQL
docker exec -it addaxai-postgres psql -U addaxai

# Redis
docker exec -it addaxai-redis redis-cli -a YOUR_REDIS_PASSWORD

# MinIO client
docker exec -it addaxai-minio mc alias set local http://localhost:9000 minioadmin PASSWORD
```

## Security notes

**Docker and UFW firewall:**
Docker bypasses UFW firewall rules by directly manipulating iptables. This means:
- Ports exposed in `docker-compose.yml` are accessible even if UFW doesn't allow them
- **Never expose sensitive services (Redis, PostgreSQL) via port bindings**
- Always use Docker's internal networks for inter-service communication
- Only expose ports that need external access (web, API, FTPS)

**Redis security:**
Redis is configured with:
- No public port binding (only accessible within Docker network)
- Password authentication required (`REDIS_PASSWORD`)
- Connection URL format: `redis://:PASSWORD@redis:6379/0`

To verify Redis is secure: `scripts/verify-redis-security.sh`

## Troubleshooting

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

**Email SMTP doesn't work:**

Some cloud providers (DigitalOcean, AWS, Google Cloud) block outbound SMTP ports (25, 465, 587) to prevent spam. This prevents verification and password reset emails from being sent. You can test this with the command below. If they are blocked, that is because of the cloud provider, and we can't really do anything about that. The solution would be to submit a support ticket to your cloud provider requesting SMTP access for transactional emails.

```bash
python3 -c "import socket; [print(f'Port {p}:', 'OPEN' if socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect_ex(('smtp.gmail.com', p)) == 0 else 'BLOCKED') for p in [25, 465, 587]]"
```

## Related guides

- [Dev server setup](dev-server-setup.md)
- [Update guide](update-guide.md)
