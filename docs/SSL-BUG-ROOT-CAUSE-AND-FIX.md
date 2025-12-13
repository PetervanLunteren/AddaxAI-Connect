# SSL Bug - Root Cause Analysis & Fix

**Date:** December 13, 2025
**Status:** ✅ ROOT CAUSE IDENTIFIED
**Severity:** CRITICAL - Breaks HTTPS on all fresh deployments

---

## Executive Summary

**The bug was introduced yesterday (December 12, 2025) in commit `ac76fbb`.**

The breaking change moved SSL finalization from `playbook.yml post_tasks` (where it ran **after all roles completed**) into the SSL role itself (where it runs **during role execution**).

**Impact:** HTTPS fails on fresh deployments because finalization never runs at the right time with the right variable scope.

**Fix:** Revert to the working configuration by moving finalization back to `post_tasks`.

---

## Timeline of Changes

### ✅ Working State (Commit 9b0f8e7 - Dec 12, 13:36)

**Commit:** `9b0f8e7` - "Add SSL finalization step to ensure HTTPS works on fresh deployments"

**Configuration:**
```yaml
# ansible/playbook.yml
post_tasks:
  - name: Finalize SSL configuration
    include_role:
      name: ssl
      tasks_from: finalize
    when: enable_ssl | default(false) and domain_name is defined
    tags: [ssl, web]
```

**Why it worked:**
- ✅ Runs **AFTER** all roles complete (post_tasks phase)
- ✅ Fresh variable scope (no interference from earlier role executions)
- ✅ `ssl_cert_exists_final` re-checks certificate (guaranteed to exist)
- ✅ nginx config regenerated with correct HTTPS block
- ✅ nginx reloaded with final configuration

### ❌ Breaking Change (Commit ac76fbb - Dec 12, 15:25)

**Commit:** `ac76fbb` - "Move SSL finalization into SSL role for automatic HTTPS configuration"

**What changed:**
1. **Removed** finalization from `playbook.yml post_tasks`
2. **Added** finalization inside `ansible/roles/ssl/tasks/main.yml`
3. **Changed** from `include_role` to `import_tasks`

**New configuration:**
```yaml
# ansible/roles/ssl/tasks/main.yml (line 107)
- name: Finalize nginx SSL config when a cert is present
  import_tasks: finalize.yml  # ← BROKEN: parse-time evaluation
  when:
    - enable_ssl | default(false)
    - domain_name is defined
    - ssl_cert_exists_after.stat.exists | default(false)
```

**Why it broke:**
1. ❌ `import_tasks` evaluated at **parse time** (before playbook runs)
2. ❌ Variable `ssl_cert_exists_after` doesn't exist at parse time
3. ❌ Condition uses `default(false)` → always evaluates to false
4. ❌ **finalize.yml never runs**
5. ❌ nginx config never regenerated with HTTPS block
6. ❌ Port 443 never starts listening

### Attempted Fix (Changed to include_tasks)

Later changed `import_tasks` to `include_tasks`, but **still broken** because:
- Running finalize **inside** the SSL role has different variable scope
- Still runs during role execution, not after all roles complete
- Timing and context are wrong

---

## Root Cause Explained

### The Core Issue: Execution Timing

**Working (post_tasks):**
```
1. nginx role runs → creates HTTP-only config
2. SSL role runs → generates certificate, tries to update config (may fail due to variables)
3. app-deploy role runs → starts Docker containers
4. security-check role runs
5. ✅ POST_TASKS: Finalize runs
   - All roles completed
   - All containers running
   - Fresh variable scope
   - Re-checks certificate (exists)
   - Regenerates nginx config with HTTPS
   - Reloads nginx
   - ✅ HTTPS works!
```

**Broken (inside SSL role with import_tasks):**
```
1. nginx role runs → creates HTTP-only config
2. SSL role starts:
   - Generates certificate
   - import_tasks finalize.yml evaluated
     ❌ ssl_cert_exists_after not defined yet
     ❌ default(false) used
     ❌ finalize SKIPPED
   - Continues with rest of SSL role
   - ❌ nginx still has HTTP-only config
3. app-deploy role runs
4. security-check role runs
5. Playbook ends
   ❌ HTTPS never configured
```

**Broken (inside SSL role with include_tasks):**
```
1. nginx role runs → creates HTTP-only config
2. SSL role starts:
   - Generates certificate
   - ssl_cert_exists_after now exists
   - include_tasks finalize.yml evaluated (runs!)
   - But: Variable scope is within SSL role
   - But: Other roles haven't run yet
   - nginx config regenerated
   - ⚠️  May or may not work depending on variable inheritance
3. app-deploy role runs (after finalize already happened)
4. ❌ Timing issues, inconsistent behavior
```

---

## Why Manual Finalize Works

When you run:
```bash
ansible-playbook -i inventory.yml playbook.yml --start-at-task="Finalize SSL configuration"
```

You're running the **post_tasks** version from the working commit, which:
- Runs after all roles have completed
- Has fresh variable scope
- Re-checks certificate (exists by now)
- Regenerates config successfully

**This proves the finalize logic is correct - it just needs to run at the right time!**

---

## The Fix

### Option A: Revert to Working Configuration (RECOMMENDED)

**Restore the working state from commit 9b0f8e7**

#### Step 1: Remove finalization from SSL role

Edit `ansible/roles/ssl/tasks/main.yml`:

**Remove lines 195-201:**
```yaml
# DELETE THESE LINES:
- name: Finalize nginx SSL config when a cert is present
  include_tasks: finalize.yml
  when:
    - enable_ssl | default(false)
    - domain_name is defined
    - ssl_cert_exists_after.stat.exists | default(false)
  tags: [ssl, web]
```

#### Step 2: Add finalization to post_tasks

Edit `ansible/playbook.yml`:

**After line 47 (before "Display completion summary"), add:**
```yaml
  post_tasks:
    - name: Finalize SSL configuration
      include_role:
        name: ssl
        tasks_from: finalize
      when: enable_ssl | default(false) and domain_name is defined
      tags: [ssl, web]

    - name: Display completion summary
      # ... (rest stays the same)
```

**Full context:**
```yaml
  # Phase 4: Security Verification
  - role: security-check
    tags: [security-check, verify]

post_tasks:
  - name: Finalize SSL configuration
    include_role:
      name: ssl
      tasks_from: finalize
    when: enable_ssl | default(false) and domain_name is defined
    tags: [ssl, web]

  - name: Display completion summary
    debug:
      msg: |
        # ... (existing completion message)
```

---

## Testing the Fix

### Test on Fresh VM

```bash
# 1. Apply fix
git add ansible/playbook.yml ansible/roles/ssl/tasks/main.yml
git commit -m "Fix SSL by moving finalization back to post_tasks

Reverts commit ac76fbb which broke HTTPS on fresh deployments.

The finalization step must run in post_tasks AFTER all roles
complete, not during SSL role execution. This ensures:
- All Docker containers are running
- Fresh variable scope for ssl_cert_exists
- Correct timing for nginx config regeneration

Fixes #<issue-number>"

# 2. Push
git push origin main

# 3. Deploy to fresh VM
cd ansible
ansible-playbook -i inventory.yml playbook.yml

# 4. Verify HTTPS works immediately
curl -I https://dev.addaxai.com
# Should return: HTTP/2 200
```

### Success Criteria

- ✅ Playbook completes without errors
- ✅ HTTPS works immediately (no manual finalize needed)
- ✅ `https://dev.addaxai.com` loads in browser
- ✅ Port 443 listening after playbook completes
- ✅ nginx config has HTTPS server block
- ✅ No `ERR_CONNECTION_REFUSED` errors

---

## Alternative: Keep It In SSL Role (NOT RECOMMENDED)

If you really want to keep finalization in the SSL role, you need to:

1. **Run it at the very END of the SSL role** (after all other tasks)
2. **Use include_tasks** (not import_tasks)
3. **Add explicit delays** to ensure everything is ready
4. **Set global facts** to avoid variable scoping issues

But this is more fragile than just putting it in post_tasks where it belongs.

---

## Lessons Learned

1. **Timing matters:** Some tasks need to run after all roles complete
2. **Variable scope matters:** Running in post_tasks provides clean variable scope
3. **import_tasks vs include_tasks:**
   - `import_tasks` = parse time (static)
   - `include_tasks` = runtime (dynamic)
4. **Test on fresh VMs:** Changes that work on existing VMs may fail on fresh ones
5. **Git history is valuable:** When bugs appear, check recent commits first!

---

## Verification After Fix

After applying the fix, verify with debug infrastructure (if you want extra confirmation):

```bash
# Deploy with debug
ansible-playbook -i inventory.yml playbook.yml --tags debug,ssl,web

# Collect evidence
./scripts/collect-ssl-debug.sh

# Verify finalization ran in post_tasks
grep "Finalize SSL configuration" /var/log/ansible.log  # or check Ansible output
```

Expected: finalize should run AFTER all roles, and HTTPS should work immediately.

---

## Commit to Apply

```bash
git add ansible/playbook.yml ansible/roles/ssl/tasks/main.yml
git commit -m "Fix SSL deployment by moving finalization to post_tasks

Root cause: Commit ac76fbb moved SSL finalization from post_tasks
into the SSL role, breaking HTTPS on fresh deployments.

The finalization step regenerates nginx config with HTTPS enabled
and MUST run:
- AFTER all roles complete (not during SSL role)
- With fresh variable scope
- After Docker containers are running

This reverts to the working configuration from commit 9b0f8e7.

Fixes SSL connection refused errors on fresh VM deployments."

git push origin main
```

---

## Status

- [x] Root cause identified (commit ac76fbb)
- [x] Breaking change understood (timing + variable scope)
- [x] Fix designed (revert to post_tasks)
- [ ] Fix applied
- [ ] Fix tested on fresh VM
- [ ] Fix verified and documented

---

**Ready to apply the fix!**
