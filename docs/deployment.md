# Deployment guide

Everything runs on a single Ubuntu server. You configure a few variables, run one Ansible command, and it sets up the entire stack: Docker, databases, ML workers, web interface, SSL certificates, security measures, etc.

**Before you start**, make sure you have:

- A domain name you control (you'll need to create a DNS record)
- An SSH key pair (most cloud providers let you add your public key during VM creation)
- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html) installed on your local machine
- A [supported camera](camera-requirements.md), or one that can be added
- Optional: an S3-compatible bucket for cold storage. Holds images that overflow from the local disk.
- Optional: an S3-compatible bucket for automated backups. Make sure bucket versioning is enabled so you can restore to any state in the last 90 days.

## Setup

1.  **Deploy a VM**

    Use any cloud provider you like (DigitalOcean, Hetzner, AWS, etc.). You need Ubuntu with at least 8 GB RAM and enough storage for your images (tested on DigitalOcean's `Ubuntu 24.04 (LTS) x64 (Premium Intel) - 8GB / 2 Intel CPUs / 160GB NVMe SSD ($48/mo)`). Add your SSH public key during creation and note the IPv4 address. All the following steps happen on your local machine, not on the server.

2.  **Clone this repo**

    ```bash
    git clone https://github.com/PetervanLunteren/AddaxAI-Connect.git
    cd AddaxAI-Connect
    ```

3.  **Create your config files**

    ```bash
    cp ansible/inventory.yml.example ansible/inventory.yml
    cp ansible/group_vars/dev.yml.example ansible/group_vars/dev.yml
    ```

    Open both files in a text editor (VS Code, TextEdit, Notepad, etc.) and fill in your values.

4.  **Configure `ansible/inventory.yml`**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `your_vm_ipv4` | `123.456.789.01` | IPv4 address of your server |
    | `your_ssh_key` | `~/.ssh/id_rsa` | Path to your private SSH key |

5.  **Configure `ansible/group_vars/dev.yml`**

    This is where all your settings go. The passwords below don't belong to existing accounts. You're creating them now. Generate secure ones with `openssl rand -hex 32`.

    **Passwords and secrets**

    | Variable | Description |
    |---------|-------------|
    | `app_user_password` | Password for `sudo` access on the server |
    | `ftps_password` | Password for FTPS camera uploads |
    | `db_password` | Database password |
    | `minio_password` | MinIO storage admin password |
    | `redis_password` | Redis password |
    | `jwt_secret` | Secret key for signing JWT tokens |
    | `monitoring_password` | Password for monitoring tools |

    **Classification model**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `classification_model` | `"speciesnet"` | `"deepfaune"` (38 European species) or `"speciesnet"` (2,498 global species) |

    **Domain and TLS**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `domain_name` | `"cam.example.com"` | Your domain. You need access to its DNS records. |
    | `letsencrypt_email` | `"you@example.com"` | Email for SSL certificate registration |
    | `letsencrypt_staging` | `false` | Set to `true` during testing to avoid rate limits, `false` for real certificates |

    **Email and admin account**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `mail_server` | `"smtp.gmail.com"` | SMTP server for outgoing email |
    | `mail_port` | `587` | SMTP port |
    | `mail_username` | `"your.email@example.com"` | Login for your SMTP server. This account sends all system emails. |
    | `mail_password` | `"securepassword"` | You might need an app password, see tip below |
    | `admin_email` | `"admin@example.com"` | Email for the first user account on the platform (gets server admin access). |

    ??? tip "Test your email settings before deploying"

        Some providers (Gmail, Outlook, etc.) don't allow you to log in with your regular password for automated sending. You'll need to create an app password in your provider's security settings first.

        Test your settings by replacing the values below and running it on your local machine. If you receive the email, your settings are correct. If it fails, check with your email provider whether app passwords or other authentication steps are required.

        ```bash
        python3 -c "
        import smtplib
        s = smtplib.SMTP('<mail_server>', <mail_port>)
        s.starttls()
        s.login('<mail_username>', '<mail_password>')
        s.sendmail('<mail_username>', '<mail_username>', 'Subject: SMTP test\n\nIt works!')
        s.quit()
        print('Email sent!')
        "
        ```

    **Cold storage tier (optional)**

    These settings enable overflow to remote storage when the disk fills up. Leave as defaults to skip. Can enable later if needed.

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `cold_tier_enabled` | `true` | `true` to run the cold tier. `false` skips it. |
    | `cold_tier_endpoint` | `"https://s3.eu-central-1.wasabisys.com"` | Endpoint of the remote S3 bucket. |
    | `cold_tier_bucket` | `"my-server-cold"` | Bucket name on the remote provider. |
    | `cold_tier_region` | `"eu-central-1"` | Region code of the bucket. |
    | `cold_tier_access_key` | `"AKIA..."` | Access key for the bucket. |
    | `cold_tier_secret_key` | `"secret..."` | Secret key for the bucket. |
    | `cold_tier_hot_budget_gb` | `80` | How many GB of raw images to keep on the server. Extra goes to the remote bucket. |

    **Automated backups (optional)**

    These settings enable daily backups of the database and all images to remote storage. Needed if you want to restore a new server from a backup. Leave as defaults to skip. Can enable later if needed.

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `backup_enabled` | `true` | `true` to run the daily backup cron. `false` skips it. |
    | `backup_endpoint` | `"https://s3.eu-central-1.wasabisys.com"` | Endpoint of the backup provider. |
    | `backup_bucket` | `"my-server-backups"` | Dedicated backup bucket. Do not reuse the cold-tier bucket. |
    | `backup_region` | `"eu-central-1"` | Region code of the backup bucket. |
    | `backup_access_key` | `"AKIA..."` | Access key for the backup bucket. |
    | `backup_secret_key` | `"secret..."` | Secret key for the backup bucket. |

    **Disk usage alerts (optional)**

    Server admins get an email when the root filesystem crosses a percentage. One email per threshold crossing. The default is sensible for most servers.

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `disk_alert_thresholds` | `"80,90,95"` | Comma-separated percentages. One email per crossing. Empty string disables alerts. |

6.  **Add server to known_hosts**

    ```bash
    ssh-keyscan -H <your_vm_ipv4> >> ~/.ssh/known_hosts
    ```

7.  **Test the connection**

    Should return `pong`.

    ```bash
    ansible -i ansible/inventory.yml dev -m ping
    ```

8.  **Run the playbook**

    This deploys everything. After a few minutes it will pause and ask you to set up DNS, see the next step.

    ```bash
    ansible-playbook -i ansible/inventory.yml ansible/playbook.yml
    ```

    ![Ansible terminal](https://github.com/user-attachments/assets/a23784ff-af28-418f-90fb-b1834d0f5d92)

9.  **Create a DNS record**

    Go to your DNS provider and add an `A` record pointing your domain to your server's IP address.

    | Type | Name | Value |
    |------|------|-------|
    | A | `<domain_name>` | `<your_vm_ipv4>` |

    DNS propagation can take a few minutes. Open a new terminal window and verify it with:

    ```bash
    dig +short <domain_name>
    ```

    When this returns your server's IP, you're good. Press ENTER to continue. The playbook will then finish building and deploying all services.

    ![Playbook completed](https://github.com/user-attachments/assets/f8e96c86-c28c-40dd-8dbb-0c1874a1083d)

10. **Wait for the playbook to finish**

    This can take 30-60 minutes since it builds all Docker images on the server. Good time to go outside and do some bird watching. When you see lots of green texts, checkmarks and `failed=0`, the server is deployed.

    ![Screenshot 2026-03-23 at 14 36 48](https://github.com/user-attachments/assets/5454f891-8358-4deb-a77e-2f9411dbb897)

    ??? tip "Email not sending after deployment?"

        Some cloud providers (DigitalOcean, AWS, Google Cloud) block outbound SMTP ports (25, 465, 587) by default to prevent spam. You can check with:

        ```bash
        python3 -c "import socket; [print(f'Port {p}:', 'OPEN' if socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect_ex(('<mail_server>', p)) == 0 else 'BLOCKED') for p in [25, 465, 587]]"
        ```

        If ports are blocked, submit a support ticket to your cloud provider requesting SMTP access for transactional emails.

Your server is live! Time to put it to work. Continue with the **[setup guide](setup-guide.md)** to register your account, configure settings, and start processing images.

