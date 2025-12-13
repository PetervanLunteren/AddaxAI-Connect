#!/bin/bash
# Collect SSL Debug Data from Remote VM
# This script retrieves all debug evidence collected during Ansible deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANSIBLE_DIR="$REPO_ROOT/ansible"
INVENTORY_FILE="$ANSIBLE_DIR/inventory.yml"
LOCAL_DEBUG_DIR="$REPO_ROOT/debug-evidence"

# Print colored message
log() {
    local color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Check prerequisites
check_prerequisites() {
    log "$BLUE" "Checking prerequisites..."

    if [[ ! -f "$INVENTORY_FILE" ]]; then
        log "$RED" "❌ Inventory file not found: $INVENTORY_FILE"
        exit 1
    fi

    if ! command -v ansible &> /dev/null; then
        log "$RED" "❌ Ansible not installed"
        exit 1
    fi

    log "$GREEN" "✅ Prerequisites OK"
}

# Extract VM IP from inventory
get_vm_ip() {
    local ip=$(grep -A5 "^\s*dev:" "$INVENTORY_FILE" | grep "ansible_host:" | awk '{print $2}' | tr -d '"' | head -1)
    if [[ -z "$ip" ]]; then
        log "$RED" "❌ Could not extract VM IP from inventory"
        exit 1
    fi
    echo "$ip"
}

# Extract SSH user from inventory
get_ssh_user() {
    local user=$(grep -A5 "^\s*dev:" "$INVENTORY_FILE" | grep "ansible_user:" | awk '{print $2}' | tr -d '"' | head -1)
    if [[ -z "$user" ]]; then
        # Default to ubuntu if not specified
        user="ubuntu"
    fi
    echo "$user"
}

# Main collection function
collect_debug_data() {
    local vm_ip="$1"
    local ssh_user="$2"

    log "$BLUE" "Collecting debug data from VM: $vm_ip"
    log "$BLUE" "SSH User: $ssh_user"

    # Create local debug directory
    mkdir -p "$LOCAL_DEBUG_DIR"

    # Check if debug data exists on remote
    log "$YELLOW" "Checking if debug data exists on remote VM..."
    if ssh "${ssh_user}@${vm_ip}" "test -d /tmp/ansible-ssl-debug"; then
        log "$GREEN" "✅ Debug data found on remote VM"
    else
        log "$RED" "❌ No debug data found at /tmp/ansible-ssl-debug on remote VM"
        log "$YELLOW" "This is normal if:"
        log "$YELLOW" "  1. You haven't run the playbook yet"
        log "$YELLOW" "  2. The SSL role was skipped"
        log "$YELLOW" "  3. enable_ssl is false"
        exit 1
    fi

    # Create timestamped directory
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local collection_dir="$LOCAL_DEBUG_DIR/ssl-debug-$timestamp"
    mkdir -p "$collection_dir"

    log "$BLUE" "Downloading debug data to: $collection_dir"

    # Download all debug data
    scp -r "${ssh_user}@${vm_ip}:/tmp/ansible-ssl-debug/*" "$collection_dir/" 2>/dev/null || {
        log "$RED" "❌ Failed to download debug data"
        exit 1
    }

    log "$GREEN" "✅ Debug data downloaded successfully"

    # Create analysis report
    generate_analysis_report "$collection_dir"

    # Display summary
    display_summary "$collection_dir"
}

# Generate analysis report
generate_analysis_report() {
    local debug_dir="$1"
    local report_file="$debug_dir/ANALYSIS_REPORT.md"

    log "$BLUE" "Generating analysis report..."

    cat > "$report_file" << 'EOFTEMPLATE'
# SSL Deployment Debug Analysis Report

**Generated:** $(date)

---

## Executive Summary

This report analyzes the SSL deployment workflow by examining system state at 5 critical checkpoints.

### Checkpoint Overview

1. **Before Certbot** - Initial state before SSL certificate generation
2. **After Certbot, Before Nginx Regen** - State immediately after certificate generation
3. **After Nginx Reload, Before Finalize** - State after first nginx configuration update
4. **After Finalize** - State after finalization step
5. **Final State** - End state after all SSL tasks

---

## Quick Diagnosis

EOFTEMPLATE

    # Add checkpoint summaries
    for checkpoint_dir in "$debug_dir"/*/; do
        if [[ -d "$checkpoint_dir" ]]; then
            local checkpoint_name=$(basename "$checkpoint_dir")
            local summary_file="$checkpoint_dir/00-SUMMARY.txt"

            if [[ -f "$summary_file" ]]; then
                cat >> "$report_file" << EOF

### Checkpoint: $checkpoint_name

\`\`\`
$(cat "$summary_file")
\`\`\`

EOF
            fi
        fi
    done

    # Add comparison section
    cat >> "$report_file" << 'EOF'

---

## Critical Comparison: Before Finalize vs After Finalize

This section compares state before and after the finalize step to identify what changes.

### Port 443 Status

EOF

    # Compare port 443 listening status
    local before_ports="$debug_dir/03-after-nginx-reload-before-finalize/08-network-ports.txt"
    local after_ports="$debug_dir/04-after-finalize/08-network-ports.txt"

    if [[ -f "$before_ports" ]] && [[ -f "$after_ports" ]]; then
        cat >> "$report_file" << EOF

**Before Finalize:**
\`\`\`
$(grep -A 20 "Listening Ports" "$before_ports" || echo "Data not available")
\`\`\`

**After Finalize:**
\`\`\`
$(grep -A 20 "Listening Ports" "$after_ports" || echo "Data not available")
\`\`\`

EOF
    fi

    # Compare nginx config
    cat >> "$report_file" << 'EOF'

### Nginx Configuration

EOF

    local before_config="$debug_dir/03-after-nginx-reload-before-finalize/02-nginx-config.conf"
    local after_config="$debug_dir/04-after-finalize/02-nginx-config.conf"

    if [[ -f "$before_config" ]] && [[ -f "$after_config" ]]; then
        local before_https=$(grep -c "listen 443" "$before_config" || echo "0")
        local after_https=$(grep -c "listen 443" "$after_config" || echo "0")

        cat >> "$report_file" << EOF

**Before Finalize:** $before_https HTTPS blocks
**After Finalize:** $after_https HTTPS blocks

EOF

        if [[ "$before_https" != "$after_https" ]]; then
            cat >> "$report_file" << EOF
⚠️ **CRITICAL FINDING:** HTTPS block count changed between before and after finalize!

This indicates the nginx configuration was regenerated during finalize.

EOF
        fi
    fi

    # Add recommendations
    cat >> "$report_file" << 'EOF'

---

## Recommendations

Based on the collected evidence, examine:

1. **Variable Scoping**: Check if `ssl_cert_exists` variable is correctly passed to nginx template
2. **Handler Execution**: Verify nginx reload/restart handlers executed at the right time
3. **Timing**: Check if Docker containers were fully ready before SSL verification
4. **Finalize Necessity**: Determine why finalize step is needed vs. earlier nginx regen

---

## Next Steps

1. Review all checkpoint summaries above
2. Compare nginx configs between checkpoints 2, 3, 4
3. Check Ansible variable values in `11-ansible-variables.txt` files
4. Examine nginx error logs for any SSL-related issues

---

## Files Included

EOF

    # List all collected files
    find "$debug_dir" -type f | sort | sed 's|^|  - |' >> "$report_file"

    log "$GREEN" "✅ Analysis report generated: $report_file"
}

# Display summary
display_summary() {
    local debug_dir="$1"

    log "$GREEN" ""
    log "$GREEN" "═══════════════════════════════════════════════════════"
    log "$GREEN" "  Debug Data Collection Complete"
    log "$GREEN" "═══════════════════════════════════════════════════════"
    log "$BLUE" ""
    log "$BLUE" "Location: $debug_dir"
    log "$BLUE" ""
    log "$YELLOW" "Available checkpoints:"

    for checkpoint_dir in "$debug_dir"/*/; do
        if [[ -d "$checkpoint_dir" ]]; then
            local checkpoint_name=$(basename "$checkpoint_dir")
            log "$YELLOW" "  📁 $checkpoint_name"
        fi
    done

    log "$BLUE" ""
    log "$GREEN" "Analysis report: $debug_dir/ANALYSIS_REPORT.md"
    log "$BLUE" ""
    log "$YELLOW" "To view the report:"
    log "$NC" "  cat $debug_dir/ANALYSIS_REPORT.md"
    log "$YELLOW" ""
    log "$YELLOW" "To view a specific checkpoint summary:"
    log "$NC" "  cat $debug_dir/01-before-certbot/00-SUMMARY.txt"
    log "$BLUE" ""
    log "$GREEN" "═══════════════════════════════════════════════════════"
}

# Main execution
main() {
    log "$BLUE" "╔════════════════════════════════════════════════════════╗"
    log "$BLUE" "║      SSL Debug Data Collection Script                 ║"
    log "$BLUE" "╚════════════════════════════════════════════════════════╝"
    log "$BLUE" ""

    check_prerequisites

    local vm_ip=$(get_vm_ip)
    local ssh_user=$(get_ssh_user)

    collect_debug_data "$vm_ip" "$ssh_user"
}

# Run main function
main "$@"
