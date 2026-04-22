# Restore guide

How to spin up a new AddaxAI Connect server from a Wasabi backup. Use this when the old server is lost, broken, or you are migrating to a new host. The result is a new server with the same database, users, projects, cameras, and images as the backup.

**What you need before you start:**

- A fresh Ubuntu VM, reachable over SSH.
- Your `ansible/group_vars/dev.yml` on your laptop. This holds every secret, so the new server can be rebuilt with the same passwords. If you lost this file, generate new ones and accept that cameras need reconfiguring with the new FTPS password.
- The backup bucket credentials (same `backup_*` vars used on the old server).
- About 45 minutes total. Most of that is ansible provisioning the VM.

## 1. Point ansible at the new VM

*(on your laptop)*

Open `ansible/inventory.yml` and set `ansible_host` to the new VM's IPv4 address.

## 2. Pick a fresh domain name

*(on your laptop)*

In `ansible/group_vars/dev.yml`, set `domain_name` to a domain that is not in use yet. 

## 3. Run the playbook on the new VM

*(on your laptop)*

Run the full playbook. 

```bash
ssh-keyscan -H <new_vm_ipv4> >> ~/.ssh/known_hosts
ansible-playbook -i ansible/inventory.yml ansible/playbook.yml
```

## 4. Restore the data

*(on the new server)*

SSH in and run the restore script. Give it the old server's `domain_name` as the source. 

```bash
ssh ubuntu@<new_vm_ipv4>
cd /opt/addaxai-connect
bash scripts/restore.sh <old-domain>
```

Example: `bash scripts/restore.sh prod.addaxai.com`.

The new server's nightly backup cron stays paused for 24 h after ansible runs, so there is no rush to get restore in before 02:00 UTC. The script also drops a lock file while it runs so a cron firing mid-restore would skip anyway.

## 5. Verify

*(in a browser)*

Open the new server's URL. Log in with a user that existed on the old server. Check:

- The project list looks right.
- A camera opens and shows its latest image.
- A recent image renders at full size.
- A old image renders at full size.
- `Server settings > System health` shows every row healthy.

## Restore a specific day

*(instead of latest)*

Pass a date as the second argument. The script looks for `YYYY-MM-DD.sql.gz` under the backup bucket.

```bash
bash scripts/restore.sh <old-domain> 2026-04-17
```

If that date is not in the bucket, the script prints the list of dates it found and exits.

## When things go wrong

**"source domain required"**. You forgot the first argument. Pass the old server's `domain_name`.

**"no postgres dumps found under ..."**. Wrong source domain, or the backup bucket credentials in `.env` point at the wrong bucket. Check `grep ^BACKUP_ /opt/addaxai-connect/.env` and compare against what the old server used.

**"refusing to restore onto a populated server"**. The new server already has users. Either you are on the wrong box, or something went wrong earlier. If you really want to overwrite, add `--force`.

**"dump YYYY-MM-DD.sql.gz not found"**. The date you asked for does not exist in the backup bucket. The script prints the list of dates that do exist. Pick one of those.

**Script fails midway with a postgres error**. The `--single-transaction` flag rolls back any partial load. You are back where you started. Read the error, fix the cause, re-run.

**Everything restored but images do not render**. Likely the cold tier registration is missing or misconfigured. The backup contains full image bytes, not stubs, so hot reads work without extra setup. But any old tier stubs from the old server need the cold-tier registration. Check `docker compose exec minio mc ilm tier ls local`.
