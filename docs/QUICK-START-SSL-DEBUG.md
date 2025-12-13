# Quick Start: SSL Debugging

**Goal:** Diagnose why HTTPS fails on fresh deployments in under 30 minutes.

---

## Step 1: Commit Debug Infrastructure (2 minutes)

```bash
cd /Users/peter/Documents/Repos/AddaxAI-Connect

# Review what's changed
git status

# Add all debug infrastructure
git add ansible/roles/debug-ssl/
git add ansible/roles/ssl/tasks/main.yml
git add scripts/collect-ssl-debug.sh
git add docs/ssl-*.md
git add docs/QUICK-START-SSL-DEBUG.md

# Commit
git commit -m "Add comprehensive SSL debugging infrastructure

Captures system state at 5 checkpoints during SSL deployment:
- Before certbot
- After certbot, before nginx regen
- After nginx reload, before finalize
- After finalize
- Final state

Includes automated evidence collection and analysis tools.

See docs/ssl-debugging-guide.md for details."

# Push
git push origin main
```

---

## Step 2: Deploy to Fresh VM (15 minutes)

```bash
# Make sure you have a fresh VM ready
# Update inventory if needed
vim ansible/inventory.yml

# Verify DNS is pointing to VM
dig dev.addaxai.com

# Deploy with debug tags
cd ansible
ansible-playbook -i inventory.yml playbook.yml --tags debug,ssl,web
```

**Watch for:**
- `[DEBUG]` markers in output
- Does HTTPS health check pass or fail?
- Does playbook complete successfully?

---

## Step 3: Collect Evidence (1 minute)

```bash
cd /Users/peter/Documents/Repos/AddaxAI-Connect
./scripts/collect-ssl-debug.sh
```

**Output location:** `debug-evidence/ssl-debug-TIMESTAMP/`

---

## Step 4: Quick Analysis (5 minutes)

```bash
# Set variable for easy access
DEBUG_DIR=$(ls -dt debug-evidence/ssl-debug-* | head -1)

# View analysis report
cat "$DEBUG_DIR/ANALYSIS_REPORT.md" | less

# Check each checkpoint summary
for i in {01..05}; do
    echo "========== CHECKPOINT $i =========="
    find "$DEBUG_DIR" -name "00-SUMMARY.txt" | grep "0$i-" | xargs cat
    echo ""
done
```

**Key question:** When does the HTTPS block appear in nginx config?

```bash
# Count HTTPS blocks at each checkpoint
for dir in "$DEBUG_DIR"/*/; do
    count=$(grep -c "listen 443" "$dir/02-nginx-config.conf" 2>/dev/null || echo "0")
    echo "$(basename "$dir"): $count HTTPS blocks"
done
```

**Expected:** 0, 0, 0, 1, 1 ← **Problem!**
**Desired:** 0, 0, 1, 1, 1

---

## Step 5: Identify Root Cause (5 minutes)

If HTTPS block appears in checkpoint 4 but not 3:

```bash
# Compare before/after finalize
diff -u \
  "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/02-nginx-config.conf \
  "$DEBUG_DIR"/04-after-finalize/02-nginx-config.conf
```

**Root cause:** Variable scoping issue. Template sees wrong `ssl_cert_exists` value.

---

## Step 6: Apply Fix (2 minutes)

Edit `ansible/roles/ssl/tasks/main.yml`:

After line 94 (the `register: ssl_cert_exists_after` task), add:

```yaml
- name: Update ssl_cert_exists fact globally
  set_fact:
    ssl_cert_exists: "{{ ssl_cert_exists_after }}"
  when: ssl_cert_exists_after.stat.exists
```

And **remove** lines 124-125 (the `vars:` section in the template task):

```yaml
# DELETE THESE LINES:
  vars:
    ssl_cert_exists: "{{ ssl_cert_exists_after }}"
```

---

## Step 7: Test Fix (15 minutes)

```bash
# Commit fix
git add ansible/roles/ssl/tasks/main.yml
git commit -m "Fix SSL variable scoping issue

Use set_fact to create global ssl_cert_exists variable that nginx
template can access. This ensures HTTPS block is rendered on first
deployment without needing manual finalize step."
git push

# Deploy to fresh VM
# (Destroy old VM and provision new one, or use different inventory)

cd ansible
ansible-playbook -i inventory.yml playbook.yml

# Test HTTPS immediately
curl -I https://dev.addaxai.com
```

**Success if:**
- ✅ HTTPS loads immediately
- ✅ No manual finalize needed

**Verify with debug:**

```bash
./scripts/collect-ssl-debug.sh
DEBUG_DIR=$(ls -dt debug-evidence/ssl-debug-* | head -1)

# Check checkpoint 3 now has HTTPS block
grep -c "listen 443" "$DEBUG_DIR"/03-after-nginx-reload-before-finalize/02-nginx-config.conf
# Should output: 1 or more (not 0)
```

---

## Troubleshooting

### Debug data not found on VM

```bash
# SSH into VM
ssh ubuntu@YOUR_VM_IP

# Check if debug directory exists
ls -la /tmp/ansible-ssl-debug/

# If missing, debug tasks may have been skipped
# Re-run with explicit debug tag
cd /path/to/ansible
ansible-playbook -i inventory.yml playbook.yml --tags debug
```

### Collection script fails

```bash
# Manual download
scp -r ubuntu@YOUR_VM_IP:/tmp/ansible-ssl-debug/ ./debug-evidence/manual-collection/
```

### Still not working after fix

Collect new evidence and compare:

```bash
# After applying fix
./scripts/collect-ssl-debug.sh
DEBUG_DIR_AFTER=$(ls -dt debug-evidence/ssl-debug-* | head -1)

# Compare with before-fix evidence
DEBUG_DIR_BEFORE="debug-evidence/ssl-debug-PREVIOUS_TIMESTAMP"

diff -u \
  "$DEBUG_DIR_BEFORE"/03-after-nginx-reload-before-finalize/02-nginx-config.conf \
  "$DEBUG_DIR_AFTER"/03-after-nginx-reload-before-finalize/02-nginx-config.conf
```

If HTTPS block still missing in checkpoint 3, investigate variable values:

```bash
cat "$DEBUG_DIR_AFTER"/03-after-nginx-reload-before-finalize/11-ansible-variables.txt
```

---

## Alternative: Try the Fix Without Evidence First

If you're confident in the hypothesis and want to save time:

```bash
# Apply fix (Step 6)
# Test immediately (Step 7)
# If it works, you're done!
# If not, collect evidence (Steps 2-5) and investigate further
```

---

## Questions?

See full docs:
- `docs/ssl-debugging-guide.md` - Comprehensive guide
- `docs/ssl-investigation-summary.md` - Investigation details
- `docs/ssl-debug-deployment-plan.md` - Detailed plan
