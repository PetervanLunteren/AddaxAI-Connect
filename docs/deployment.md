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
    cp ansible/group_vars/all/main.yml.example ansible/group_vars/all/main.yml
    cp ansible/host_vars/example.yml.example ansible/host_vars/myserver.yml
    ```

    Open all three files in a text editor (VS Code, TextEdit, Notepad, etc.) and fill in your values. Rename `myserver` to whatever you called your server in the inventory.

4.  **Configure `ansible/inventory.yml`**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `myserver` | `cam-01` | Name of your server. The `host_vars` file must match it. |
    | `your_vm_ipv4` | `123.456.789.01` | IPv4 address of your server |
    | `your_ssh_key` | `~/.ssh/id_rsa` | Path to your private SSH key |

5.  **Configure your settings**

    Everything below goes in `ansible/host_vars/myserver.yml`, except `letsencrypt_email` and `letsencrypt_staging`, which live in `ansible/group_vars/all/main.yml` with the other settings shared by every server. The passwords don't belong to existing accounts. You're creating them now. Generate secure ones with `openssl rand -hex 32`.

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

    **GPU (optional)**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `use_gpu` | `true` | `true` when the server has an NVIDIA GPU. The detection and classification workers then run on it. Leave `false` on a normal server. |

    ??? tip "Running on an NVIDIA GPU"

        A GPU makes detection and classification many times faster. Measured on one server (8 CPUs, NVIDIA RTX 4000 Ada), per image: MegaDetector 6.9 s on the CPU against 0.08 s on the GPU, SpeciesNet 6.5 s against 0.07 s, DeepFaune 0.07 s on the GPU. It matters most for bulk uploads of SD cards; a server that only receives live camera images does fine on the CPU.

        Before you run the playbook, install the driver on the server and reboot. On Ubuntu 24.04:

        ```bash
        sudo apt install nvidia-driver-580-server
        sudo reboot
        nvidia-smi
        ```

        `nvidia-smi` must show driver version 580 or newer. The images carry CUDA 13, which needs that driver branch; an older driver (535, 550, 575) loads fine but the workers cannot see the GPU and refuse to start. The playbook checks this and stops with the fix spelled out. The `-server` package uses modules signed by Canonical, so it works with Secure Boot and needs no rebuild after kernel updates.

        Then set `use_gpu: true` in your `host_vars` file and run the playbook. It installs the NVIDIA container toolkit, registers it with Docker (one Docker restart, first run only) and starts the ML workers with the GPU.

        To check it worked: the health page (server admin menu) shows a GPU pill on the detection and classification workers, `docker compose logs detection | grep device` shows `cuda`, and `bash scripts/verify-server.sh` lists a `gpu` check that passes.

        Two things to know. A worker that is asked for the GPU and cannot see it stops on purpose instead of silently running on the CPU, and the hourly liveness alert then emails the server admins. And after a kernel or driver security update `nvidia-smi` can report a version mismatch until the automatic reboot at 04:30; a worker restarted in that window stops for the same reason and recovers after the reboot.

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

6.  **Add server to known_hosts**

    ```bash
    ssh-keyscan -H <your_vm_ipv4> >> ~/.ssh/known_hosts
    ```

7.  **Test the connection**

    Should return `pong`.

    ```bash
    ansible -i ansible/inventory.yml myserver -m ping
    ```

8.  **Run the playbook**

    This deploys everything. After a few minutes it will pause and ask you to set up DNS, see the next step.

    ```bash
    ansible-playbook -i ansible/inventory.yml ansible/playbook.yml --limit myserver
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

