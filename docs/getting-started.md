# Getting Started with AddaxAI Connect

This guide will help you set up your development environment and start building.

## Step 1: Provision a Development VM

### Option A: DigitalOcean (Recommended)

1. **Create a Droplet:**
   - Go to https://cloud.digitalocean.com/droplets/new
   - Choose: Ubuntu 22.04 LTS
   - Size: Basic plan, $12/month (2 GB RAM, 2 vCPUs) minimum
   - For better performance: $24/month (4 GB RAM, 2 vCPUs)
   - Add your SSH key (create one if needed: `ssh-keygen`)
   - Click "Create Droplet"

2. **Note the IP address** that appears after creation

### Option B: Other Cloud Providers

- **AWS EC2:** t3.medium (Ubuntu 22.04 LTS)
- **Google Cloud:** e2-medium (Ubuntu 22.04 LTS)
- **Azure:** Standard_B2s (Ubuntu 22.04 LTS)

All should work fine with the Ansible playbooks.

## Step 2: Set Up Your Mac

### Install Ansible

```bash
# Using Homebrew
brew install ansible

# Verify installation
ansible --version
```

### Check Your SSH Key

```bash
# Check if you have an SSH key
ls ~/.ssh/id_rsa.pub

# If not, create one:
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# Press Enter to accept defaults
```

## Step 3: Configure Ansible

### Clone this repository (if not already)

```bash
cd ~/Documents/Repos/
git clone YOUR_REPO_URL addaxai-connect
cd addaxai-connect
```

### Set up inventory

```bash
cd ansible/

# Copy the templates
cp inventory.yml.example inventory.yml
cp group_vars/dev.yml.example group_vars/dev.yml

# Edit inventory.yml
nano inventory.yml
# Replace YOUR_VM_IP_HERE with your actual VM IP
```

### Test connection

```bash
# Test if Ansible can reach your VM
ansible -i inventory.yml dev -m ping
```

If successful, you'll see:
```
addaxai-dev | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

## Step 4: Run Ansible Playbook

Deploy the development environment:

```bash
ansible-playbook -i inventory.yml playbook.yml
```

This takes ~5-10 minutes and installs:
- Docker and Docker Compose
- Git, Python, and development tools
- Firewall configuration
- Application user setup

## Step 5: SSH Into Your VM

```bash
ssh ubuntu@YOUR_VM_IP
```

You'll be in a fresh Ubuntu environment with Docker ready!

```bash
# Check Docker is installed
docker --version
docker compose version

# Navigate to the project
cd /opt/addaxai-connect

# Check what's here
ls -la
```

## Step 6: Start Building!

Now you're ready to follow the development plan:

1. **Create Docker Compose configuration**
   - Set up PostgreSQL, Redis, MinIO
   - Define service containers

2. **Build the database schema**
   - Design tables for images, cameras, detections, classifications
   - Create Alembic migrations

3. **Create the ingestion service**
   - Watch for new images
   - Queue them for processing

4. **Build the ML pipeline**
   - Detection worker
   - Classification worker

5. **Create the API and frontend**
   - FastAPI backend
   - React frontend

See `PROJECT_PLAN.md` for the full roadmap.

## Using VS Code Remote SSH (Optional but Recommended)

You can edit files on the VM directly from VS Code on your Mac:

1. **Install VS Code Remote SSH extension:**
   - Open VS Code
   - Install "Remote - SSH" extension

2. **Connect to your VM:**
   - Press `Cmd+Shift+P`
   - Type "Remote-SSH: Connect to Host"
   - Enter: `ubuntu@YOUR_VM_IP`

3. **Open the project:**
   - File → Open Folder
   - Navigate to `/opt/addaxai-connect`

Now you can edit files with VS Code's UI while they run on the Ubuntu VM!

## Quick Reference Commands

### On Your Mac

```bash
# Run Ansible playbook
cd ~/Documents/Repos/addaxai-connect/ansible
ansible-playbook -i inventory.yml playbook.yml

# SSH into VM
ssh ubuntu@YOUR_VM_IP

# Copy files to VM
scp local_file.txt ubuntu@YOUR_VM_IP:/opt/addaxai-connect/
```

### On the VM

```bash
# Navigate to project
cd /opt/addaxai-connect

# Docker commands
docker ps                    # List running containers
docker compose up -d         # Start all services in background
docker compose logs -f       # View logs (follow mode)
docker compose down          # Stop all services
docker compose ps            # List services

# Git commands
git status
git pull
git add .
git commit -m "message"
git push

# Check system resources
htop                         # Interactive process viewer
df -h                        # Disk usage
free -h                      # Memory usage
```

## Troubleshooting

### Can't connect via SSH

```bash
# Add VM to known hosts
ssh-keyscan -H YOUR_VM_IP >> ~/.ssh/known_hosts

# Try connecting with verbose output
ssh -v ubuntu@YOUR_VM_IP
```

### Docker permission denied

```bash
# On the VM, logout and login again
exit
ssh ubuntu@YOUR_VM_IP

# This refreshes your group membership (docker group)
```

### Repository not cloned

```bash
# On the VM, manually clone if needed
cd /opt
sudo chown ubuntu:ubuntu addaxai-connect
git clone https://github.com/YOUR_USERNAME/addaxai-connect.git
```

## Cost Estimates

**Development VM (DigitalOcean):**
- Basic: $12/month (2GB RAM)
- Recommended: $24/month (4GB RAM)
- With GPU (later): $60+/month

**You can destroy and recreate the VM anytime!** Ansible makes it reproducible.

## Next Steps

1. ✅ VM provisioned and configured
2. → Create `docker-compose.yml` (see Phase 1.1 in PROJECT_PLAN.md)
3. → Set up database schema (see Phase 1.2 in PROJECT_PLAN.md)
4. → Start building services!

Happy coding! 🚀
