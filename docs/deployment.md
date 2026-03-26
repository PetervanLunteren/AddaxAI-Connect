# Deployment guide

Everything runs on a single Ubuntu server. You configure a few variables, run one Ansible command, and it sets up the entire stack: Docker, databases, ML workers, web interface, SSL certificates, security measures, etc.

**Before you start**, make sure you have:

- An Ubuntu server (tested on DigitalOcean's `Ubuntu 24.04 (LTS) x64 (Premium Intel) - 8GB / 2 Intel CPUs / 160GB NVMe SSD ($48/mo)`, but any Ubuntu with at least 8 GB RAM and enough storage for your images should work)
- A domain name you control (you'll need to create a DNS record)
- An SSH key pair (most cloud providers let you add your public key during VM creation)
- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html) installed on your local machine

## Setup

1.  **Deploy a VM**

    Use any cloud provider you like (DigitalOcean, Hetzner, AWS, etc.). Add your SSH public key during creation and note the IPv4 address. All the following steps happen on your local machine, not on the server.

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

4.  **Configure `ansible/inventory.yml`**

    | Variable | Example | Description |
    |---------|---------|-------------|
    | `your_vm_ipv4` | `123.456.789.01` | IPv4 address of your server |
    | `your_ssh_key` | `~/.ssh/id_rsa` | Path to your private SSH key |

5.  **Configure `ansible/group_vars/dev.yml`**

    This is where all your settings go. Generate secure passwords with `openssl rand -base64 32`.

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
    | `mail_password` | `"securepassword"` | SMTP password or app password |
    | `admin_email` | `"admin@example.com"` | Email for the first user account on the platform (gets server admin access). |

    ??? tip "Test your email settings before deploying"

        Replace the values below with your own and run it on your local machine. If you receive the email, your settings are correct.

        ```bash
        python3 -c "
        import smtplib
        s = smtplib.SMTP('smtp.gmail.com', 587)
        s.starttls()
        s.login('your.email@example.com', 'your-app-password')
        s.sendmail('your.email@example.com', 'your.email@example.com', 'Subject: SMTP test\n\nIt works!')
        s.quit()
        print('Email sent!')
        "
        ```

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

    This deploys everything.

    ```bash
    ansible-playbook -i ansible/inventory.yml ansible/playbook.yml
    ```

    ![Ansible terminal](https://github.com/user-attachments/assets/a23784ff-af28-418f-90fb-b1834d0f5d92)

9.  **Create a DNS record**

    The playbook will pause and ask you to set up DNS. Go to your DNS provider and add an `A` record pointing your domain to your server's IP address.

    | Type | Name | Value |
    |------|------|-------|
    | A | `cam.example.com` | `<your_vm_ipv4>` |

    DNS propagation can take a few minutes. You can verify it with:

    ```bash
    dig +short cam.example.com
    ```

    When this returns your server's IP, you're good. Press ENTER to continue. The playbook will then finish building and deploying all services.

    ![Playbook completed](https://github.com/user-attachments/assets/f8e96c86-c28c-40dd-8dbb-0c1874a1083d)

10. **Wait for the playbook to finish**

    This can take 30-60 minutes the first time since it builds all Docker images on the server. Good time to go outside and do some bird watching. When you see lots of green texts, checkmarks and `failed=0`, the server is deployed.

    ![Screenshot 2026-03-23 at 14 36 48](https://github.com/user-attachments/assets/5454f891-8358-4deb-a77e-2f9411dbb897)

Your server is live! Time to put it to work. Continue with the **[setup guide](setup-guide.md)** to register your account, configure settings, and start processing images.

## Troubleshooting

??? tip "Email not sending?"

    Some cloud providers (DigitalOcean, AWS, Google Cloud) block outbound SMTP ports (25, 465, 587) by default to prevent spam. You can check with:

    ```bash
    python3 -c "import socket; [print(f'Port {p}:', 'OPEN' if socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect_ex(('smtp.gmail.com', p)) == 0 else 'BLOCKED') for p in [25, 465, 587]]"
    ```

    If ports are blocked, submit a support ticket to your cloud provider requesting SMTP access for transactional emails.
