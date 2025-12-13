# SSL Debugging - Deployment Plan

## Objective

Deploy the comprehensive SSL debugging infrastructure on a fresh VM to capture evidence of the HTTPS failure, identify the root cause, and implement a permanent fix.

---

## Prerequisites

- [ ] Fresh Ubuntu 24.04 VM provisioned
- [ ] DNS A record pointing to VM IP (dev.addaxai.com)
- [ ] SSH access configured
- [ ] Ansible inventory.yml configured with VM details
- [ ] group_vars/dev.yml configured with SSL settings

---

## Phase 1: Commit Debug Infrastructure

**What:** Commit the new debug role and modified SSL role to git

**Commands:**
```bash
cd /Users/peter/Documents/Repos/AddaxAI-Connect

# Review changes
git status
git diff

# Add new files
git add ansible/roles/debug-ssl/
git add scripts/collect-ssl-debug.sh
git add docs/ssl-debugging-guide.md
git add docs/ssl-debug-deployment-plan.md

# Add modified SSL role
git add ansible/roles/ssl/tasks/main.yml

# Commit
git commit -m "Add comprehensive SSL debugging infrastructure

- Create debug-ssl role to capture system state at 5 checkpoints
- Modify SSL role to include debug checkpoints
- Add collection script to download and analyze debug evidence
- Add comprehensive debugging guide

This infrastructure will help diagnose why HTTPS fails on fresh
deployments but works after manual finalize step rerun."

# Push to remote
git push origin main
```

**Verification:**
- [ ] All files committed
- [ ] No uncommitted changes
- [ ] Pushed to GitHub

---

## Phase 2: Deploy to Fresh VM

**What:** Run full Ansible playbook with debug mode enabled

**Commands:**
```bash
cd ansible

# Verify inventory is correct
cat inventory.yml

# Verify SSL settings
grep -E "enable_ssl|domain_name|letsencrypt" group_vars/dev.yml

# Run playbook with debug tags
ansible-playbook -i inventory.yml playbook.yml --tags debug,ssl,web
```

**What to observe:**
- [ ] Certbot successfully generates certificate
- [ ] Debug checkpoints execute (look for "[DEBUG]" in output)
- [ ] Playbook completes (may fail at HTTPS health check)
- [ ] Note whether HTTPS works immediately or not

**If playbook fails:**
- Don't worry! The debug data was still collected
- Note at which task it failed

---

## Phase 3: Collect Debug Evidence

**What:** Download all debug data from VM

**Commands:**
```bash
cd /Users/peter/Documents/Repos/AddaxAI-Connect

# Run collection script
./scripts/collect-ssl-debug.sh
```

**Expected output:**
```
╔════════════════════════════════════════════════════════╗
║      SSL Debug Data Collection Script                 ║
╚════════════════════════════════════════════════════════╝

Checking prerequisites...
✅ Prerequisites OK
Collecting debug data from VM: XXX.XXX.XXX.XXX
SSH User: ubuntu
✅ Debug data found on remote VM
Downloading debug data to: debug-evidence/ssl-debug-TIMESTAMP
✅ Debug data downloaded successfully
Generating analysis report...
✅ Analysis report generated
```

**Verification:**
- [ ] Data downloaded to `debug-evidence/ssl-debug-TIMESTAMP/`
- [ ] 5 checkpoint directories present (01 through 05)
- [ ] Each checkpoint has 11 evidence files
- [ ] ANALYSIS_REPORT.md generated

---

## Phase 4: Analyze Evidence

**What:** Examine debug data to identify root cause

### 4.1 Quick Overview

```bash
# Get latest debug directory
DEBUG_DIR=$(ls -dt debug-evidence/ssl-debug-* | head -1)

# View analysis report
cat "$DEBUG_DIR/ANALYSIS_REPORT.md"

# View all checkpoint summaries
for i in {01..05}; do
    echo "=== Checkpoint $i ==="
    cat "$DEBUG_DIR"/*-*/00-SUMMARY.txt 2>/dev/null | head -50
    echo ""
done
```

### 4.2 Critical Questions to Answer

**Question 1: Does finalize.yml run?**
```bash
ls -la "$DEBUG_DIR"/04-after-finalize/
```
- [ ] If directory exists → finalize ran
- [ ] If directory missing → finalize was skipped (Pattern 4)

**Question 2: When does HTTPS block appear in nginx config?**
```bash
# Check each checkpoint
grep -c "listen 443" "$DEBUG_DIR"/01-before-certbot/02-nginx-config.conf
grep -c "listen 443" "$DEBUG_DIR"/02-after-certbot-before-nginx-regen/02-nginx-config.conf
grep -c "listen 443" "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/02-nginx-config.conf
grep -c "listen 443" "$DEBUG_DIR"/04-after-finalize/02-nginx-config.conf
grep -c "listen 443" "$DEBUG_DIR"/05-final-state/02-nginx-config.conf
```

Expected: 0, 0, 1+, 1+, 1+
If actual: 0, 0, 0, 1+, 1+ → **Pattern 1: Variable scoping issue**

**Question 3: When does port 443 start listening?**
```bash
# Check each checkpoint
for dir in "$DEBUG_DIR"/*/; do
    echo "$(basename "$dir"):"
    grep "Port 443" "$dir"/08-network-ports.txt
done
```

**Question 4: What are Ansible variable values?**
```bash
# Check critical checkpoint (before finalize)
cat "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/11-ansible-variables.txt
```

Look for:
- `ssl_cert_exists` structure
- `ssl_cert_exists_after` structure
- Do they have `.stat.exists` attribute?

### 4.3 Compare Before/After Finalize

```bash
# Compare nginx configs
diff -u \
  "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/02-nginx-config.conf \
  "$DEBUG_DIR"/04-after-finalize/02-nginx-config.conf
```

- [ ] Are there differences?
- [ ] If yes, what changed?

---

## Phase 5: Determine Root Cause

Based on evidence, identify which pattern matches:

### Pattern 1: Variable Scoping Issue ✓ (Most Likely)

**Evidence:**
- HTTPS block appears in checkpoint 4 but not 3
- nginx config regenerated during finalize
- Template conditional uses wrong variable

**Root Cause:**
Line 125 in `ansible/roles/ssl/tasks/main.yml`:
```yaml
vars:
  ssl_cert_exists: "{{ ssl_cert_exists_after }}"
```

This passes the entire `ssl_cert_exists_after` object (from stat module) as the `ssl_cert_exists` variable to the template. However, the nginx template checks:
```jinja2
{% if ssl_cert_exists.stat.exists %}
```

The issue: Ansible variable precedence means the template might still see the nginx role's original `ssl_cert_exists` (false) instead of the SSL role's override.

### Pattern 2: Nginx Reload Issue

**Evidence:**
- HTTPS block present in config
- Port 443 not listening
- nginx journal shows errors

**Root Cause:**
Graceful reload doesn't pick up new server blocks on some nginx versions.

### Pattern 3: Docker Container Timing

**Evidence:**
- HTTPS works (port 443 listening, config correct)
- Health check returns 502/503
- Docker containers not running

**Root Cause:**
API/frontend containers not fully started when SSL verification runs.

### Pattern 4: Finalize Condition Failed

**Evidence:**
- Checkpoint 4 directory doesn't exist
- finalize.yml never ran
- Debug output shows "Will finalize run? False"

**Root Cause:**
Conditional check failed, likely due to undefined `ssl_cert_exists_after`.

---

## Phase 6: Implement Fix

### Fix for Pattern 1 (Variable Scoping)

**Option A: Use set_fact for global variable**

In `ansible/roles/ssl/tasks/main.yml`, after line 95:

```yaml
- name: Re-check SSL certificate exists after certbot
  stat:
    path: "/etc/letsencrypt/live/{{ domain_name | default('localhost') }}/fullchain.pem"
  register: ssl_cert_exists_after

# NEW: Set global fact
- name: Update global ssl_cert_exists fact
  set_fact:
    ssl_cert_exists: "{{ ssl_cert_exists_after }}"
  when: ssl_cert_exists_after.stat.exists
```

Then remove the `vars:` section from the template task (line 124-125).

**Option B: Change template variable name**

In nginx template `addaxai-connect.conf.j2`, change:
```jinja2
{% if enable_ssl | default(false) and domain_name is defined and ssl_cert_exists is defined and ssl_cert_exists.stat.exists %}
```

To:
```jinja2
{% if enable_ssl | default(false) and domain_name is defined and cert_is_present | default(false) %}
```

Then in SSL role, pass:
```yaml
vars:
  cert_is_present: "{{ ssl_cert_exists_after.stat.exists }}"
```

**Option C: Remove redundant nginx regeneration**

Remove the nginx regeneration in SSL role (lines 117-143), rely entirely on finalize.yml.

---

## Phase 7: Test Fix

**What:** Deploy fix on fresh VM and verify

```bash
# Commit fix
git add ansible/roles/ssl/tasks/main.yml
# Or git add ansible/roles/nginx/templates/addaxai-connect.conf.j2
git commit -m "Fix SSL variable scoping issue

[Describe what you changed and why]"
git push

# Destroy old VM and provision fresh one
# Update inventory.yml with new IP
# Point DNS to new IP

# Wait for DNS propagation (5-10 minutes)
dig dev.addaxai.com

# Deploy with debug mode
cd ansible
ansible-playbook -i inventory.yml playbook.yml --tags debug,ssl,web
```

**Success criteria:**
- [ ] Playbook completes without errors
- [ ] HTTPS works immediately (https://dev.addaxai.com loads)
- [ ] No manual finalize step needed

**Collect debug evidence again:**
```bash
./scripts/collect-ssl-debug.sh
```

**Verify fix:**
```bash
DEBUG_DIR=$(ls -dt debug-evidence/ssl-debug-* | head -1)

# Check checkpoint 3 now has HTTPS block
grep -c "listen 443" "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/02-nginx-config.conf
# Should be 1 or more (not 0)

# Check port 443 listening in checkpoint 3
grep "Port 443" "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/08-network-ports.txt
# Should show "✅ Port 443 (HTTPS) IS listening"
```

---

## Phase 8: Clean Up and Document

### 8.1 Remove Debug Infrastructure (Optional)

If you want to remove debug tasks for production:

```bash
# Revert SSL role changes (keep the fix, remove debug tasks)
# Edit ansible/roles/ssl/tasks/main.yml
# Remove all tasks with "[DEBUG]" in the name

# Or keep debug tasks but skip them in production
ansible-playbook -i inventory.yml playbook.yml --skip-tags debug
```

### 8.2 Document the Fix

Update `docs/ssl-debugging-guide.md` with:
- The root cause found
- The fix applied
- Verification steps

Add to "Common Failure Patterns" section.

### 8.3 Update README

Add a note in main README.md about SSL deployment being fixed.

---

## Phase 9: Final Verification

### 9.1 Full Fresh Deployment Test

Provision a completely new VM and run deployment end-to-end:

```bash
# Provision new VM
# Configure DNS
# Update inventory

# Run playbook WITHOUT debug tags
ansible-playbook -i inventory.yml playbook.yml

# Verify HTTPS works
curl -I https://dev.addaxai.com
```

### 9.2 Test Idempotency

Run playbook again on the same VM:

```bash
ansible-playbook -i inventory.yml playbook.yml
```

Should report "ok" (no changes) for SSL tasks.

---

## Success Criteria

The SSL deployment is fixed when:

- [x] Fresh VM deployment completes without errors
- [x] HTTPS works immediately after first playbook run
- [x] No manual finalize step needed
- [x] Port 443 listening after checkpoint 3
- [x] HTTPS server block present in nginx config after checkpoint 3
- [x] Health check returns 200 OK
- [x] Second playbook run is idempotent (no changes)
- [x] Root cause identified and documented
- [x] Fix tested on at least 2 fresh VMs

---

## Rollback Plan

If the fix doesn't work:

```bash
# Revert to previous commit
git revert HEAD
git push

# Or checkout previous version
git checkout <previous-commit-hash> ansible/roles/ssl/tasks/main.yml
git commit -m "Revert SSL fix - didn't work"
git push
```

Then analyze debug evidence again with fresh eyes.

---

## Timeline Estimate

- **Phase 1** (Commit): 10 minutes
- **Phase 2** (Deploy): 15-20 minutes
- **Phase 3** (Collect): 2 minutes
- **Phase 4** (Analyze): 30-60 minutes
- **Phase 5** (Determine cause): 15 minutes
- **Phase 6** (Implement fix): 30 minutes
- **Phase 7** (Test fix): 30 minutes (includes VM provisioning)
- **Phase 8** (Document): 20 minutes
- **Phase 9** (Final verification): 30 minutes

**Total:** ~3-4 hours

---

## Next Steps

Ready to proceed? Follow the phases in order:

1. ✅ Commit debug infrastructure (Phase 1)
2. ⏳ Deploy to fresh VM (Phase 2)
3. ⏳ Collect evidence (Phase 3)
4. ⏳ Analyze and identify root cause (Phase 4-5)
5. ⏳ Implement fix (Phase 6)
6. ⏳ Test and verify (Phase 7-9)
