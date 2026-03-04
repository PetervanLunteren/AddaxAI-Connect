# Update guide

How to safely update a production server to the latest version. Always test on a cloned test server first. Never update production directly. These instructions are written for DigitalOcean droplets. The general approach applies to other cloud providers too, but the snapshot steps will differ.

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

5. **Restart services.** *(on the production server)* SSH back in and start the services. Production is back online while you test the update separately.

   ```
   cd /opt/addaxai-connect && docker compose up -d
   ```

## 2. Test on a test server

1. **Create a new droplet from the snapshot.** *(in the DigitalOcean dashboard)* Go to *Images > Snapshots*, click *More* on the snapshot you just took, then click *Create Droplet*. Review the settings and click *Create*. This gives you an exact clone of production with real data.

2. **Create a DNS record for the test server.** *(at your DNS provider)* Add an A record pointing to the new droplet's IP address (e.g., test.addaxai.com). Then SSH into the test server and update the DOMAIN_NAME in the .env file so the app uses the correct domain for cookies and redirects.

   ```
   cd /opt/addaxai-connect && sed -i 's/^DOMAIN_NAME=.*/DOMAIN_NAME=test.addaxai.com/' .env
   ```

3. **Disable email notifications.** *(on the test server)* The notification workers run scheduled jobs (daily, weekly, and monthly reports) that will send real emails to your users if the test server is running during those windows. Replace the mail settings with dummy values before starting services.

   ```
   cd /opt/addaxai-connect && sed -i \
     -e 's/^MAIL_SERVER=.*/MAIL_SERVER=disabled/' \
     -e 's/^MAIL_USERNAME=.*/MAIL_USERNAME=disabled/' \
     -e 's/^MAIL_PASSWORD=.*/MAIL_PASSWORD=disabled/' \
     -e 's/^MAIL_FROM=.*/MAIL_FROM=disabled@localhost/' .env
   ```

4. **Pull the latest code.** *(on the test server)*

   ```
   cd /opt/addaxai-connect && git pull origin main
   ```

5. **Rebuild and start containers.** *(on the test server)* This rebuilds all service images with the new code.

   ```
   cd /opt/addaxai-connect && docker compose up -d --build --force-recreate
   ```

6. **Run database migrations.** *(on the test server)* This applies any new Alembic migrations to the cloned database. Watch the output carefully for errors. This is where most update issues surface.

   ```
   cd /opt/addaxai-connect && bash scripts/update-database.sh
   ```

7. **Verify everything works.** *(on the test server)* Your browser will show an SSL warning because the test server has a different IP than the original domain. This is expected. Click through it to continue. Check that:
   - The frontend loads and you can log in
   - Existing images display correctly with detections
   - Camera list and health data are intact
   - All services show as healthy on the /server/health page

8. **Destroy the test droplet** *(in the DigitalOcean dashboard)* once you've confirmed the update works.

## 3. Update production

1. **Take a fresh database dump.** *(on the production server)* The earlier backup may be hours old by now, and new data may have come in. This overwrites the previous backup.

   ```
   cd /opt/addaxai-connect && docker compose exec postgres pg_dump -U addaxai addaxai_connect > backup.sql
   ```

2. **Power off the droplet.** *(on the production server)* Power off before taking a snapshot to ensure full disk consistency. When prompted for a password, enter the `app_user_password` from `ansible/group_vars/dev.yml`.

   ```
   cd /opt/addaxai-connect && docker compose down && sudo shutdown -h now
   ```

3. **Take a fresh DigitalOcean snapshot.** *(in the DigitalOcean dashboard)* Go to your droplet, click *Snapshots*, and create one. Wait for it to complete. This is your rollback point if the update fails on production.

4. **Power on the droplet.** *(in the DigitalOcean dashboard)* Go back to your droplet and click the power on button. Wait until the status shows it's running again before continuing.

5. **Pull the latest code.** *(on the production server)* SSH back in and pull the new version.

   ```
   cd /opt/addaxai-connect && git pull origin main
   ```

6. **Rebuild and start containers.** *(on the production server)* This rebuilds all service images with the new code.

   ```
   cd /opt/addaxai-connect && docker compose up -d --build --force-recreate
   ```

7. **Run database migrations.** *(on the production server)* This applies any new Alembic migrations and backfills derived data. Watch the output carefully for errors. This is where most update issues surface.

   ```
   cd /opt/addaxai-connect && bash scripts/update-database.sh
   ```

8. **Verify on production.** *(on the production server)* Check that the frontend loads, you can log in, existing images display correctly, camera list and health data are intact, and all services show as healthy on the /server/health page. Monitor the logs for a few minutes to catch any runtime errors.

   ```
   cd /opt/addaxai-connect && docker compose logs -f --tail 50
   ```

## Rollback

**If something goes wrong:** restore the database from your SQL dump and redeploy the previous version *(on the production server)*. For a full server rollback, create a new droplet from the snapshot you took before updating *(in the DigitalOcean dashboard)*.

```
cd /opt/addaxai-connect && docker compose down && cat backup.sql | docker compose exec -T postgres psql -U addaxai addaxai_connect && docker compose up -d
```
