# Update guide

How to safely update a production server to the latest version. These instructions are written for DigitalOcean droplets. The general approach applies to other cloud providers too, but the snapshot steps will differ.

You have two safety nets: a SQL database dump (fast to restore, covers schema and data) and a full DigitalOcean snapshot (covers everything including MinIO files, uploads, and configs). Between the two, you can recover from any failed update.

## 1. Back up production

1. **Create a database dump.** *(on the production server)* This is your most important backup. It's portable and fast to restore if anything goes wrong with the schema migration.

   ```
   cd /opt/addaxai-connect && docker compose exec postgres pg_dump -U addaxai addaxai_connect > backup.sql
   ```

2. **Power off the droplet.** *(on the production server)* DigitalOcean recommends powering off before taking a snapshot to ensure full disk consistency. This stops all services and the OS itself. You will lose your SSH session. When prompted for a password, enter the `app_user_password` from `ansible/group_vars/dev.yml`.

   ```
   cd /opt/addaxai-connect && docker compose down && sudo shutdown -h now
   ```

3. **Take a DigitalOcean snapshot.** *(in the DigitalOcean dashboard)* Go to your droplet, click *Snapshots*, and create one. Wait for it to complete. This captures the full disk (database, MinIO files, uploads, configs) so you can restore the entire server if needed.

4. **Power on the droplet.** *(in the DigitalOcean dashboard)* Go back to your droplet and click the power on button. Wait until the status shows it's running again before continuing.

## 2. Update production

1. **Pull the latest code.** *(on the production server)* SSH back in and pull the new version.

   ```
   cd /opt/addaxai-connect && git pull origin main
   ```

2. **Rebuild and start containers.** *(on the production server)* This rebuilds all service images with the new code. The correct services are selected automatically based on the `COMPOSE_PROFILES` variable in `.env`.

   ```
   cd /opt/addaxai-connect && docker compose up -d --build --force-recreate
   ```

3. **Run database migrations.** *(on the production server)* This applies any new Alembic migrations and backfills derived data. Watch the output carefully for errors. This is where most update issues surface.

   ```
   cd /opt/addaxai-connect && bash scripts/update-database.sh
   ```

4. **Verify on production.** *(on the production server)* Check that the frontend loads, you can log in, existing images display correctly, camera list and health data are intact, and all services show as healthy on the /server/health page. Confirm the version shown on the About page matches the latest release. Monitor the logs for a few minutes to catch any runtime errors.

   ```
   cd /opt/addaxai-connect && docker compose logs -f --tail 50
   ```

## Rollback

You have two options depending on the severity of the issue.

### Option 1: restore the database from the SQL dump

Use this if only the database migration failed but the server is otherwise fine. This restores the database to the state before the update while keeping everything else intact.

```
cd /opt/addaxai-connect && docker compose down && cat backup.sql | docker compose exec -T postgres psql -U addaxai addaxai_connect && git checkout <previous-commit> && docker compose up -d --build
```

### Option 2: restore the full server from the snapshot

Use this if the server is in a bad state and you want to start fresh from the pre-update snapshot. This restores everything (database, MinIO files, uploads, configs) to exactly how it was before the update.

1. **Destroy or power off the broken droplet.** *(in the DigitalOcean dashboard)*
2. **Create a new droplet from the snapshot.** Go to *Images > Snapshots*, click *More* on the snapshot you took in step 1.3, then click *Create Droplet*.
3. **Update the DNS record** to point to the new droplet's IP address if it changed.
4. **Start services.** *(on the restored server)*

   ```
   cd /opt/addaxai-connect && docker compose up -d
   ```
