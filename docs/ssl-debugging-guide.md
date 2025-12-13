# SSL Deployment Debugging Guide

## Overview

This guide explains how to use the comprehensive SSL debugging infrastructure to diagnose and fix HTTPS deployment issues.

## Problem Statement

On fresh VM deployments, HTTPS may not work immediately even though Ansible reports successful SSL configuration. The debug infrastructure captures system state at 5 critical checkpoints during SSL deployment to identify the exact failure point.

---

## Debug Infrastructure Components

### 1. Debug Role (`ansible/roles/debug-ssl/`)

Captures comprehensive system state including:
- SSL certificate files and permissions
- Nginx configuration (current and parsed)
- Nginx service state and logs
- Network ports listening (80, 443, 8000, 3000)
- Docker container status
- Health endpoint tests (HTTP and HTTPS)
- Ansible variable values

### 2. Enhanced SSL Role

Modified to capture state at 5 checkpoints:

1. **Before Certbot** - Initial state
2. **After Certbot, Before Nginx Regen** - Post-certificate generation
3. **After Nginx Reload, Before Finalize** - After first nginx update
4. **After Finalize** - After finalization step
5. **Final State** - End of SSL role

### 3. Collection Script (`scripts/collect-ssl-debug.sh`)

Automated script to:
- Download all debug data from remote VM
- Generate analysis report
- Compare state across checkpoints
- Identify configuration differences

---

## How to Use

### Step 1: Deploy with Debug Mode

Run the Ansible playbook on a **fresh VM** with debug tags enabled:

```bash
cd ansible
ansible-playbook -i inventory.yml playbook.yml --tags debug,ssl,web
```

**Note:** Debug tasks are tagged with `[debug]` so they can be enabled/disabled as needed.

### Step 2: Collect Debug Data

After the playbook completes (whether HTTPS works or not), collect the debug evidence:

```bash
cd /path/to/AddaxAI-Connect
./scripts/collect-ssl-debug.sh
```

This will:
- Download all debug data from `/tmp/ansible-ssl-debug/` on the VM
- Save locally to `debug-evidence/ssl-debug-TIMESTAMP/`
- Generate an analysis report

### Step 3: Analyze the Evidence

Open the analysis report:

```bash
cat debug-evidence/ssl-debug-*/ANALYSIS_REPORT.md
```

Review checkpoint summaries:

```bash
# View summary of each checkpoint
cat debug-evidence/ssl-debug-*/01-before-certbot/00-SUMMARY.txt
cat debug-evidence/ssl-debug-*/02-after-certbot-before-nginx-regen/00-SUMMARY.txt
cat debug-evidence/ssl-debug-*/03-after-nginx-reload-before-finalize/00-SUMMARY.txt
cat debug-evidence/ssl-debug-*/04-after-finalize/00-SUMMARY.txt
cat debug-evidence/ssl-debug-*/05-final-state/00-SUMMARY.txt
```

### Step 4: Compare Nginx Configurations

The most critical comparison is between checkpoints 3 and 4 (before/after finalize):

```bash
# Compare nginx configs
diff debug-evidence/ssl-debug-*/03-after-nginx-reload-before-finalize/02-nginx-config.conf \
     debug-evidence/ssl-debug-*/04-after-finalize/02-nginx-config.conf
```

**Key questions to answer:**
- Does the HTTPS server block (`listen 443`) appear before finalize?
- Does it appear after finalize?
- If it only appears after finalize, **why wasn't it rendered earlier?**

### Step 5: Check Ansible Variables

Examine variable values at each checkpoint:

```bash
cat debug-evidence/ssl-debug-*/03-after-nginx-reload-before-finalize/11-ansible-variables.txt
```

**Critical variables to check:**
- `ssl_cert_exists` - Original check from nginx role
- `ssl_cert_exists_after` - Check after certbot runs
- `ssl_cert_exists_final` - Check in finalize.yml

**Are these variables correctly structured? Do they have `.stat.exists` attribute?**

---

## Common Failure Patterns

### Pattern 1: HTTPS Block Missing Before Finalize

**Symptoms:**
- Checkpoint 3 nginx config has NO `listen 443` block
- Checkpoint 4 nginx config HAS `listen 443` block
- Port 443 not listening before finalize
- Port 443 listening after finalize

**Root Cause:**
- Variable scoping issue: nginx template sees wrong `ssl_cert_exists` value
- Template conditional fails: `{% if ssl_cert_exists.stat.exists %}` evaluates to false

**Solution:**
- Check how `ssl_cert_exists` is passed to template in SSL role line 125
- Verify variable structure in checkpoint 2 ansible-variables.txt
- Possible fix: Use `set_fact` to create global variable instead of template `vars:`

### Pattern 2: Nginx Not Reloading Properly

**Symptoms:**
- Nginx config file has HTTPS block
- But port 443 not listening
- `journalctl -u nginx` shows errors

**Root Cause:**
- Nginx reload (graceful) doesn't pick up new server blocks
- Nginx needs hard restart

**Solution:**
- Change `notify: reload nginx` to `notify: restart nginx`
- Or ensure finalize.yml does hard restart (it already attempts this)

### Pattern 3: Docker Containers Not Ready

**Symptoms:**
- HTTPS health check fails
- Port 443 listening
- Nginx config correct
- But `/health` endpoint returns 502/503

**Root Cause:**
- API container (port 8000) or frontend container (port 3000) not fully started
- Nginx proxies to non-existent backend

**Solution:**
- Add explicit wait for Docker containers before SSL verification
- Check docker container status in checkpoint data

### Pattern 4: Finalize Condition Not Met

**Symptoms:**
- Checkpoint 3 exists
- Checkpoint 4 does NOT exist
- finalize.yml never ran

**Root Cause:**
- Condition check failed: `ssl_cert_exists_after.stat.exists | default(false)`
- Variable `ssl_cert_exists_after` undefined or malformed

**Solution:**
- Check debug output "[DEBUG] About to run finalize.yml"
- Verify condition evaluation shows "Will finalize run? True"
- If false, investigate why `ssl_cert_exists_after` is not set correctly

---

## Debugging Workflow

Follow this systematic approach:

```
1. Run playbook with debug tags
   ↓
2. Collect debug evidence
   ↓
3. Check if all 5 checkpoints exist
   ├─ If checkpoint 4 missing → finalize didn't run (Pattern 4)
   └─ If all exist → continue
   ↓
4. Compare checkpoints 3 vs 4
   ├─ HTTPS block appears in 4 but not 3 → Variable scoping issue (Pattern 1)
   ├─ HTTPS block in both, but port 443 not in 3 → Nginx reload issue (Pattern 2)
   └─ HTTPS block in both, port 443 in both → Continue
   ↓
5. Check health endpoint results
   ├─ 502/503 errors → Docker containers (Pattern 3)
   ├─ Connection refused → Port not listening
   └─ 200 OK → Everything works!
   ↓
6. If HTTPS works in checkpoint 5 but not initially:
   → Something in finalize.yml fixed it
   → Identify what finalize does differently
   → Apply that earlier in the workflow
```

---

## Manual Verification Commands

If you need to manually check state on the VM:

```bash
# SSH into VM
ssh -i ~/.ssh/your_key ubuntu@YOUR_VM_IP

# Check SSL certificates
ls -la /etc/letsencrypt/live/YOUR_DOMAIN/

# Check nginx config for HTTPS block
grep -c "listen 443" /etc/nginx/sites-available/addaxai-connect.conf

# Test nginx config syntax
sudo nginx -t

# View full parsed nginx config
sudo nginx -T | less

# Check listening ports
ss -tlnp | grep -E ':(80|443|8000|3000)'

# Check nginx status
sudo systemctl status nginx

# View nginx logs
sudo journalctl -u nginx -n 100 --no-pager
sudo tail -50 /var/log/nginx/error.log

# Check Docker containers
docker ps

# Test health endpoint
curl -I http://localhost/health
curl -Ik https://YOUR_DOMAIN/health
```

---

## Disabling Debug Mode

For production deployments, you can skip debug tasks:

```bash
# Run without debug tags
ansible-playbook -i inventory.yml playbook.yml --skip-tags debug

# Or remove debug checkpoints from SSL role
# Edit ansible/roles/ssl/tasks/main.yml and remove [DEBUG] tasks
```

---

## Understanding the Evidence Files

Each checkpoint directory contains:

| File | Description |
|------|-------------|
| `00-SUMMARY.txt` | Quick status overview |
| `01-ssl-certificates.txt` | Certificate file existence and metadata |
| `02-nginx-config.conf` | Current nginx configuration file |
| `03-nginx-analysis.txt` | HTTPS block detection analysis |
| `04-nginx-test.txt` | `nginx -t` syntax test result |
| `05-nginx-parsed-full.conf` | Complete parsed nginx config (`nginx -T`) |
| `06-nginx-service.txt` | Systemd service state and journal |
| `07-nginx-error.log` | Nginx error log |
| `08-network-ports.txt` | Listening ports analysis |
| `09-docker-containers.txt` | Docker container status |
| `10-health-checks.txt` | HTTP and HTTPS health endpoint tests |
| `11-ansible-variables.txt` | Ansible variable values |

---

## Next Steps After Diagnosis

Once you identify the root cause:

1. **Document the finding** in a new issue or this doc
2. **Propose a fix** based on the failure pattern
3. **Test the fix** on a fresh VM
4. **Verify with debug data** that the issue is resolved
5. **Update this guide** with the solution

---

## Example: Successful Deployment

A successful deployment should show:

**Checkpoint 1 (Before Certbot):**
- ❌ SSL certificates: 0/3 present
- ❌ HTTPS block: 0 occurrences
- ❌ Port 443: NOT listening

**Checkpoint 2 (After Certbot):**
- ✅ SSL certificates: 3/3 present
- ❌ HTTPS block: 0 occurrences (not yet regenerated)
- ❌ Port 443: NOT listening

**Checkpoint 3 (After Nginx Reload):**
- ✅ SSL certificates: 3/3 present
- ✅ HTTPS block: 1+ occurrences
- ✅ Port 443: LISTENING
- ❌ HTTPS health: May fail (containers not ready)

**Checkpoint 4 (After Finalize):**
- ✅ SSL certificates: 3/3 present
- ✅ HTTPS block: 1+ occurrences
- ✅ Port 443: LISTENING
- ✅ HTTPS health: 200 OK

**Checkpoint 5 (Final State):**
- All green ✅

---

## Troubleshooting the Debug Infrastructure Itself

If the debug role fails:

1. **Check role exists:**
   ```bash
   ls -la ansible/roles/debug-ssl/tasks/main.yml
   ```

2. **Verify it's being included:**
   ```bash
   ansible-playbook --list-tasks -i inventory.yml playbook.yml | grep DEBUG
   ```

3. **Check for syntax errors:**
   ```bash
   ansible-playbook --syntax-check -i inventory.yml playbook.yml
   ```

4. **Run with verbose mode:**
   ```bash
   ansible-playbook -i inventory.yml playbook.yml -vv --tags debug
   ```

---

## Contact & Support

If you discover a new failure pattern not covered here:

1. Collect the debug evidence
2. Document the symptoms, root cause, and solution
3. Update this guide
4. Consider creating an automated fix in the Ansible playbook
