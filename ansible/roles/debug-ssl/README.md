# Debug SSL Role

## Purpose

This role captures comprehensive system state during SSL deployment to help diagnose HTTPS configuration issues.

## What It Captures

For each checkpoint, the role collects:

1. **SSL Certificate State**
   - Certificate file existence and metadata
   - File permissions and timestamps

2. **Nginx Configuration**
   - Current config file content
   - Full parsed configuration (`nginx -T`)
   - Syntax validation results
   - HTTPS server block detection

3. **Nginx Service**
   - Systemd service state
   - Journal logs (last 100 lines)
   - Error logs

4. **Network State**
   - Listening ports (80, 443, 8000, 3000)
   - Port analysis

5. **Docker Containers**
   - Container status
   - Running containers list

6. **Health Endpoints**
   - HTTP health check results
   - HTTPS health check results

7. **Ansible Variables**
   - SSL-related variable values
   - Variable structure inspection

## Usage

### Include in a Playbook

```yaml
- name: Capture SSL deployment state
  include_role:
    name: debug-ssl
  vars:
    checkpoint_name: "my-checkpoint"
  when: enable_ssl | default(false)
```

### Variables

**Required:**
- `checkpoint_name`: Unique identifier for this checkpoint (e.g., "before-certbot", "after-finalize")

**Optional:**
- `domain_name`: Domain name for HTTPS checks (inherited from playbook)
- `enable_ssl`: Whether SSL is enabled (inherited from playbook)

## Output Location

All debug data is saved to: `/tmp/ansible-ssl-debug/`

Directory structure:
```
/tmp/ansible-ssl-debug/
├── timeline.log                    # Chronological log of checkpoints
├── checkpoint-name-1/
│   ├── 00-SUMMARY.txt             # Quick status overview
│   ├── 01-ssl-certificates.txt    # Certificate file status
│   ├── 02-nginx-config.conf       # Current nginx config
│   ├── 03-nginx-analysis.txt      # Config analysis
│   ├── 04-nginx-test.txt          # nginx -t results
│   ├── 05-nginx-parsed-full.conf  # nginx -T full config
│   ├── 06-nginx-service.txt       # Service state
│   ├── 07-nginx-error.log         # Error log
│   ├── 08-network-ports.txt       # Port listening status
│   ├── 09-docker-containers.txt   # Container status
│   ├── 10-health-checks.txt       # Health endpoint tests
│   └── 11-ansible-variables.txt   # Ansible variable values
├── checkpoint-name-2/
│   └── ... (same structure)
```

## Collecting Debug Data

Use the collection script to download data from remote VM:

```bash
./scripts/collect-ssl-debug.sh
```

This downloads all debug data to local `debug-evidence/` directory and generates an analysis report.

## Example: SSL Role Integration

The SSL role includes 5 checkpoints:

```yaml
# Checkpoint 1: Before certbot
- include_role:
    name: debug-ssl
  vars:
    checkpoint_name: "01-before-certbot"

# Run certbot...

# Checkpoint 2: After certbot
- include_role:
    name: debug-ssl
  vars:
    checkpoint_name: "02-after-certbot-before-nginx-regen"

# Regenerate nginx config...

# Checkpoint 3: After nginx reload
- include_role:
    name: debug-ssl
  vars:
    checkpoint_name: "03-after-nginx-reload-before-finalize"

# Run finalize...

# Checkpoint 4: After finalize
- include_role:
    name: debug-ssl
  vars:
    checkpoint_name: "04-after-finalize"

# Checkpoint 5: Final state
- include_role:
    name: debug-ssl
  vars:
    checkpoint_name: "05-final-state"
```

## Interpreting Results

### Healthy SSL Deployment

A successful deployment should show this progression:

**Checkpoint 1 (Before Certbot):**
- ❌ SSL Certs: 0/3 present
- ❌ HTTPS block: 0 occurrences
- ❌ Port 443: NOT listening

**Checkpoint 2 (After Certbot):**
- ✅ SSL Certs: 3/3 present ← Certificate generated
- ❌ HTTPS block: 0 occurrences
- ❌ Port 443: NOT listening

**Checkpoint 3 (After Nginx Reload):**
- ✅ SSL Certs: 3/3 present
- ✅ HTTPS block: 1+ occurrences ← Config updated
- ✅ Port 443: LISTENING ← Nginx listening
- ⚠️  HTTPS health: May fail (containers not ready)

**Checkpoint 4 (After Finalize):**
- ✅ SSL Certs: 3/3 present
- ✅ HTTPS block: 1+ occurrences
- ✅ Port 443: LISTENING
- ✅ HTTPS health: 200 OK ← Working!

### Common Problems

**HTTPS block appears in checkpoint 4 but not 3:**
- Indicates variable scoping issue
- Nginx config not properly regenerated after certbot
- Finalize step fixes it (but shouldn't be necessary)

**Port 443 listening but health check fails:**
- Backend containers (API/frontend) not ready
- Nginx config correct but proxying to non-existent backend

**Checkpoint 4 directory missing:**
- Finalize step didn't run
- Check finalize condition evaluation in debug output

## Disabling Debug

Debug tasks are tagged with `[debug]`:

```bash
# Skip debug tasks
ansible-playbook -i inventory.yml playbook.yml --skip-tags debug

# Run only debug tasks
ansible-playbook -i inventory.yml playbook.yml --tags debug
```

## Performance Impact

Each checkpoint takes ~5-10 seconds to complete. Total debug overhead: ~30-50 seconds per deployment.

For production deployments, consider using `--skip-tags debug`.

## Requirements

- Ansible 2.9+
- SSH access to target VM
- `nginx`, `docker`, `ss` commands available on target

## See Also

- [SSL Debugging Guide](../../../docs/ssl-debugging-guide.md) - Comprehensive debugging workflow
- [SSL Debug Deployment Plan](../../../docs/ssl-debug-deployment-plan.md) - Step-by-step deployment instructions
- [Collection Script](../../../scripts/collect-ssl-debug.sh) - Automated evidence collection
