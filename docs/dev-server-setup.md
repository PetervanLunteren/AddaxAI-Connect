# Setting up a dev server from a DigitalOcean snapshot

This guide explains how to create a new development server (e.g., `dev.addaxai.com`) from an existing DigitalOcean droplet snapshot.

## 1. Back up production

Before cloning the server, take both a database dump and a full DigitalOcean snapshot. The dump is portable and fast to restore if anything goes wrong with a schema migration. The snapshot is a full disk image (database, MinIO files, uploads, configs) so you can restore the entire server if needed.

1. **Create a database dump.** On the source server, export the postgres database to a file. This is your most important backup.

   ```bash
   cd /opt/addaxai-connect && docker compose exec postgres pg_dump -U addaxai addaxai_connect > backup.sql
   ```

2. **Power off the droplet.** DigitalOcean recommends powering off before taking a snapshot to ensure full disk consistency. This stops all services and the OS itself, so you will lose your SSH session. When prompted for a password, enter the `app_user_password` from `ansible/group_vars/dev.yml`.

   ```bash
   cd /opt/addaxai-connect && docker compose down && sudo shutdown -h now
   ```

3. **Take a DigitalOcean snapshot.** In the DigitalOcean dashboard, go to your droplet, click **Snapshots**, name it (e.g., `addaxai-connect-YYYY-MM-DD`), and create one. Wait for it to complete.

4. **Power on the droplet.** Back in the DigitalOcean dashboard, click the power on button. Wait until the status shows it's running again before continuing.

5. **Bring services back up.** SSH back into the source server and start the docker compose stack. Powering off ran `docker compose down`, which removed the containers, so they do not come back on their own after boot.

   ```bash
   cd /opt/addaxai-connect && docker compose up -d
   ```

## 2. Create the droplet

In the DigitalOcean dashboard:

1. Go to **Droplets → Create Droplet**
2. Choose **Custom images** (or **Snapshots** tab) and select your snapshot
3. Pick a plan (minimum 8 GB RAM / 2 vCPU, per README)
4. Choose a datacenter region (same as the source snapshot for speed)
5. Add your SSH key under **Authentication**
6. Name the droplet (e.g., `addaxai-connect-dev`)
7. Click **Create Droplet** and note the assigned IP address

## 3. Add an SSH alias

Add to your local `~/.ssh/config`:

```
Host dev
    HostName <NEW_DROPLET_IP>
    User ubuntu
```

Verify you can connect:

```bash
ssh dev
```

If the snapshot had a different SSH key, you may need to add yours first:

```bash
doctl compute ssh <DROPLET_ID> --ssh-command "cat >> ~/.ssh/authorized_keys" < ~/.ssh/id_rsa.pub
```

## 4. Point DNS to the new droplet

Add an A record in your DNS provider:

```
Type: A
Name: dev
Value: <NEW_DROPLET_IP>
TTL: 300
```

Verify propagation:

```bash
dig +short dev.addaxai.com
```

Wait until this returns the new IP before continuing.

## 5. Stop services and clean up old state

The snapshot carries over the old server's data and SSL certificates. SSH in and clean up:

```bash
ssh dev
```

```bash
cd /opt/addaxai-connect && docker compose down
```

Check that all containers have stopped:

```bash
docker compose ps
```

This should return an empty list. If any containers are still running, run `docker compose down` again.

Remove old SSL certificates (new ones will be generated for the new domain):

```bash
sudo rm -rf /etc/letsencrypt/live/* /etc/letsencrypt/renewal/* /etc/letsencrypt/archive/*
```

Check they're gone:

```bash
sudo certbot certificates
```

This should say "No certificates found".

## 6. Update the domain in the .env file

```bash
cd /opt/addaxai-connect
sed -i 's/^DOMAIN_NAME=.*/DOMAIN_NAME=dev.addaxai.com/' .env
sed -i 's|^MINIO_PUBLIC_ENDPOINT=.*|MINIO_PUBLIC_ENDPOINT=https://dev.addaxai.com/minio|' .env
sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=https://dev.addaxai.com,http://localhost:3000,http://localhost:5173|' .env
```

Verify the values were set correctly:

```bash
grep -E '^(DOMAIN_NAME|MINIO_PUBLIC_ENDPOINT|CORS_ORIGINS)=' .env
```

You should see the new domain in all three lines.

## 7. Update nginx and get a new SSL certificate

Update the server name in the nginx config:

```bash
sudo sed -i 's/server_name .*/server_name dev.addaxai.com;/' /etc/nginx/sites-available/addaxai-connect.conf
```

Test that the nginx config is valid:

```bash
sudo nginx -t
```

You should see "syntax is ok" and "test is successful". If not, check the config file for errors. Then reload:

```bash
sudo systemctl reload nginx
```

Get a new SSL certificate for the new domain:

```bash
sudo certbot --nginx -d dev.addaxai.com
```

Verify the certificate was issued:

```bash
sudo certbot certificates
```

You should see `dev.addaxai.com` listed with a valid expiry date.

## 8. Start services

```bash
cd /opt/addaxai-connect && docker compose up -d
```

Wait a few seconds, then check that all containers are running:

```bash
docker compose ps
```

All services should show `Up` or `running`. If any show `Restarting` or `Exit`, check their logs:

```bash
docker compose logs <service_name> --tail 20
```

## 9. Verify the deployment

```bash
# check HTTPS is working
curl -I https://dev.addaxai.com/health

# check all containers are running
docker compose ps

# check the frontend loads (from your local machine)
open https://dev.addaxai.com
```

## Things to watch out for

- **Old cron jobs**: the snapshot may have cron jobs from the source server (e.g., demo date shifting). Check with `crontab -l` and `ls /etc/cron.d/`.
- **FTPS passive IP**: if you need FTPS, update the passive IP to the new droplet's public IP in `/etc/pure-ftpd/conf/ForcePassiveIP` and restart pure-ftpd.
- **MinIO data**: the snapshot includes existing MinIO data (images, crops, thumbnails). If you want a clean slate, also remove the MinIO volume: `docker volume rm addaxai-connect_minio_data`.
- **Redis data**: Redis is ephemeral by default but may have queued jobs from the snapshot. Restarting containers clears this.
- **Firewall**: UFW rules carry over. Verify with `sudo ufw status` that the rules are appropriate.
