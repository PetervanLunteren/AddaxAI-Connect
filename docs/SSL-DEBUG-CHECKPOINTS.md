# SSL Debug Checkpoints - Updated Structure

## Checkpoint Overview

After applying the fix (moving finalization to post_tasks), the debug checkpoints are:

### Checkpoint 1: Before Certbot
**Location:** `ansible/roles/ssl/tasks/main.yml` (before certbot runs)
**Directory:** `01-before-certbot/`
**Purpose:** Capture initial state before SSL certificate generation

**Expected State:**
- ❌ SSL certificates: 0/3 present
- ❌ HTTPS block: 0 occurrences
- ❌ Port 443: NOT listening

---

### Checkpoint 2: After Certbot, Before Nginx Regeneration
**Location:** `ansible/roles/ssl/tasks/main.yml` (after certbot, before first nginx config update)
**Directory:** `02-after-certbot-before-nginx-regen/`
**Purpose:** Verify certificate was generated successfully

**Expected State:**
- ✅ SSL certificates: 3/3 present
- ❌ HTTPS block: 0 occurrences (not yet regenerated)
- ❌ Port 443: NOT listening

---

### Checkpoint 3: After Nginx Reload, Before Finalize
**Location:** `ansible/roles/ssl/tasks/main.yml` (after first nginx config regeneration and reload)
**Directory:** `03-after-nginx-reload-before-finalize/`
**Purpose:** Check if HTTPS block was rendered in SSL role

**Expected State (With Fix):**
- ✅ SSL certificates: 3/3 present
- ✅ HTTPS block: 1+ occurrences ← **FIXED!**
- ✅ Port 443: LISTENING ← **FIXED!**
- ⚠️  HTTPS health: May fail (containers not ready yet)

**Previous Broken State:**
- ✅ SSL certificates: 3/3 present
- ❌ HTTPS block: 0 occurrences ← **BUG**
- ❌ Port 443: NOT listening ← **BUG**

---

### Checkpoint 4: End of SSL Role
**Location:** `ansible/roles/ssl/tasks/main.yml` (end of SSL role, before post_tasks)
**Directory:** `04-end-of-ssl-role/`
**Purpose:** Capture state before finalize runs in post_tasks

**Expected State (With Fix):**
- ✅ SSL certificates: 3/3 present
- ✅ HTTPS block: 1+ occurrences
- ✅ Port 443: LISTENING
- ⚠️  HTTPS health: May fail (app-deploy role may not have run yet)

---

### Checkpoint 5: After Finalize (in post_tasks)
**Location:** `ansible/playbook.yml` post_tasks (after finalize runs)
**Directory:** `05-after-finalize-post-tasks/`
**Purpose:** Verify finalize ran successfully in post_tasks

**Expected State:**
- ✅ SSL certificates: 3/3 present
- ✅ HTTPS block: 1+ occurrences
- ✅ Port 443: LISTENING
- ✅ HTTPS health: 200 OK ← **Should work now!**

---

### Checkpoint 6: Final State
**Location:** `ansible/playbook.yml` post_tasks (after finalize and before completion message)
**Directory:** `06-final-state/`
**Purpose:** Final verification that everything works

**Expected State:**
- ✅ SSL certificates: 3/3 present
- ✅ HTTPS block: 1+ occurrences
- ✅ Port 443: LISTENING
- ✅ HTTPS health: 200 OK
- ✅ All containers running

---

## Comparing Before/After Fix

### Key Comparison: Checkpoint 3

**With Bug (finalize in SSL role):**
```
Checkpoint 3 (after nginx reload):
- HTTPS block: 0 ← nginx config not updated
- Port 443: NOT listening ← nginx not configured for HTTPS
```

**With Fix (finalize in post_tasks):**
```
Checkpoint 3 (after nginx reload):
- HTTPS block: 1+ ← nginx config properly updated!
- Port 443: LISTENING ← nginx serving HTTPS!
```

### Key Comparison: Checkpoint 5

**With Bug:**
```
Checkpoint 5 didn't exist (finalize never ran)
```

**With Fix:**
```
Checkpoint 5 (after finalize in post_tasks):
- Everything works!
- HTTPS health check passes
```

---

## Using Checkpoints to Verify Fix

After deploying with the fix:

```bash
# Collect evidence
./scripts/collect-ssl-debug.sh

# Get debug directory
DEBUG_DIR=$(ls -dt debug-evidence/ssl-debug-* | head -1)

# Check HTTPS block appears in checkpoint 3 (NOT just checkpoint 5)
grep -c "listen 443" "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/02-nginx-config.conf
# Should output: 1 or more (not 0!)

# Check port 443 listening in checkpoint 3
grep "Port 443" "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/08-network-ports.txt
# Should show: "✅ Port 443 (HTTPS) IS listening"

# Verify finalize ran in post_tasks
ls -la "$DEBUG_DIR"/05-after-finalize-post-tasks/
# Should exist

# Check final HTTPS health
cat "$DEBUG_DIR"/06-final-state/10-health-checks.txt
# Should show: "Status: 200"
```

---

## Timeline of Execution

```
1. nginx role runs
   └─ Creates initial HTTP-only config

2. SSL role runs
   ├─ [CHECKPOINT 1] Before certbot
   ├─ Certbot generates certificate
   ├─ [CHECKPOINT 2] After certbot
   ├─ Regenerate nginx config (with fix, this should work!)
   ├─ Reload nginx
   ├─ [CHECKPOINT 3] After nginx reload ← Should have HTTPS now!
   ├─ [CHECKPOINT 4] End of SSL role
   └─ SSL role ends

3. dev-tools role runs

4. app-deploy role runs
   └─ Docker containers start

5. security-check role runs

6. post_tasks run
   ├─ Finalize SSL configuration ← Runs here (not in SSL role!)
   ├─ [CHECKPOINT 5] After finalize ← Verifies everything
   ├─ [CHECKPOINT 6] Final state ← Last check
   └─ Display completion summary
```

---

## Success Indicators

A successful deployment should show:

1. **Checkpoint 3** has HTTPS block and port 443 listening
2. **Checkpoint 5** exists (proves finalize ran)
3. **Checkpoint 6** shows all green status
4. No `ERR_CONNECTION_REFUSED` when accessing https://dev.addaxai.com

---

## Troubleshooting

If checkpoint 3 still doesn't have HTTPS block:
- Check variable values in `03-.../11-ansible-variables.txt`
- Verify `ssl_cert_exists_after.stat.exists = true`
- Check nginx template rendering

If checkpoint 5 doesn't exist:
- Finalize didn't run in post_tasks
- Check playbook.yml has the post_tasks section
- Verify `enable_ssl: true` in group_vars

If HTTPS works in checkpoint 6 but not checkpoint 3:
- Finalize is doing the work (not ideal, but working)
- Investigate why SSL role's nginx regen isn't working
