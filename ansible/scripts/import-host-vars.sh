#!/bin/bash
# Build ansible/host_vars/<host>.yml from what a server is actually running.
#
# Usage:   bash ansible/scripts/import-host-vars.sh [-i inventory.yml] <host> [<host> ...]
# Example: bash ansible/scripts/import-host-vars.sh drenthe
# Example: bash ansible/scripts/import-host-vars.sh -i ../addaxai-connect-secrets/inventory.yml spw pwn
#
# The file is written to host_vars/ next to the inventory, which defaults to
# ansible/inventory.yml. When ANSIBLE_VAULT_PASSWORD_FILE is set the file is
# vault-encrypted before the script returns; without it, it is left plain and
# the script says so.
#
# Reads /opt/addaxai-connect/.env over SSH and turns it back into ansible
# variables. Read-only on the server: it runs one `cat` and changes nothing.
#
# The point is that adopting a running server into ansible cannot alter what
# that server does. The values come from the running box, not from a template,
# so re-running the playbook afterwards writes back the .env it already has.
#
# <host> must be a name from inventory.yml and must resolve over SSH, either
# through ~/.ssh/config or because it is also a hostname.
#
# The files it writes hold real passwords, mode 600. Keep them in a private
# repo, encrypted. See ansible/README.md.

set -euo pipefail

ANSIBLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY="$ANSIBLE_DIR/inventory.yml"
REMOTE_ENV="/opt/addaxai-connect/.env"

log() { echo "[import-host-vars] $*"; }
die() { echo "[import-host-vars] ERROR: $*" >&2; exit 1; }

while getopts "i:" opt; do
  case "$opt" in
    i) INVENTORY="$OPTARG" ;;
    *) die "Usage: bash ansible/scripts/import-host-vars.sh [-i inventory.yml] <host> [<host> ...]" ;;
  esac
done
shift $((OPTIND - 1))

[ $# -gt 0 ] || die "no host given. Usage: bash ansible/scripts/import-host-vars.sh [-i inventory.yml] <host> [<host> ...]"
[ -f "$INVENTORY" ] || die "inventory not found: $INVENTORY. Pass -i path/to/inventory.yml."

HOST_VARS_DIR="$(cd "$(dirname "$INVENTORY")" && pwd)/host_vars"

# .env key -> ansible variable. This is the reverse of
# roles/app-deploy/templates/.env.j2; keep the two in step. Keys that .env
# derives from another variable (DATABASE_URL, REDIS_URL, CORS_ORIGINS,
# MINIO_ENDPOINT, COLD_TIER_PREFIX, BACKUP_HOST_PREFIX, COMPOSE_PROFILES,
# COMPOSE_FILE) are deliberately absent, they are outputs and not inputs.
MAPPING="
POSTGRES_USER=db_user
POSTGRES_PASSWORD=db_password
POSTGRES_DB=db_name
REDIS_PASSWORD=redis_password
MINIO_ROOT_USER=minio_user
MINIO_ROOT_PASSWORD=minio_password
JWT_SECRET=jwt_secret
CLASSIFICATION_MODEL=classification_model
USE_GPU=use_gpu
FTPS_UPLOAD_DIR=ftps_upload_dir
FTPS_USERNAME=ftps_username
FTPS_PASSWORD=ftps_password
MAIL_SERVER=mail_server
MAIL_PORT=mail_port
MAIL_USERNAME=mail_username
MAIL_PASSWORD=mail_password
MAIL_FROM=mail_from
DOMAIN_NAME=domain_name
ADMIN_EMAIL=admin_email
DEMO_MODE=demo_mode
ENVIRONMENT=app_environment
LOG_LEVEL=log_level
DISK_ALERT_THRESHOLDS=disk_alert_thresholds
COLD_TIER_ENABLED=cold_tier_enabled
COLD_TIER_ENDPOINT=cold_tier_endpoint
COLD_TIER_BUCKET=cold_tier_bucket
COLD_TIER_REGION=cold_tier_region
COLD_TIER_ACCESS_KEY=cold_tier_access_key
COLD_TIER_SECRET_KEY=cold_tier_secret_key
COLD_TIER_HOT_BUDGET_GB=cold_tier_hot_budget_gb
BACKUP_ENABLED=backup_enabled
BACKUP_ENDPOINT=backup_endpoint
BACKUP_BUCKET=backup_bucket
BACKUP_REGION=backup_region
BACKUP_ACCESS_KEY=backup_access_key
BACKUP_SECRET_KEY=backup_secret_key
"

# Values that must not be quoted in the output, so ansible reads them as a
# boolean or a number rather than a string. Everything else is quoted, which
# matters for the Gmail app password because it contains spaces.
UNQUOTED="demo_mode use_gpu cold_tier_enabled backup_enabled mail_port cold_tier_hot_budget_gb"

# A single quote, held in a variable so it can be used inside a ${//} pattern
# without bash turning the escape into a literal backslash.
SQ="'"

is_unquoted() {
  local needle="$1" v
  for v in $UNQUOTED; do [ "$v" = "$needle" ] && return 0; done
  return 1
}

import_one() {
  local host="$1"
  local env_body out tmp

  log "reading $host:$REMOTE_ENV"
  env_body="$(ssh -o ConnectTimeout=15 -o BatchMode=yes "$host" "cat $REMOTE_ENV")" \
    || die "could not read $REMOTE_ENV on $host. Check 'ssh $host' works and the app is deployed there."

  [ -n "$env_body" ] || die "$REMOTE_ENV on $host is empty"

  mkdir -p "$HOST_VARS_DIR"
  out="$HOST_VARS_DIR/$host.yml"
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  # Secrets touch the disk in the clear between here and the encrypt at the
  # end, so keep that window inside a 600 temp file and clean it up on any exit.
  trap 'rm -f "$tmp"' RETURN

  {
    echo "---"
    echo "# $host"
    echo "#"
    echo "# Imported from $host:$REMOTE_ENV by ansible/scripts/import-host-vars.sh."
    echo "# These are the values the server is running right now, so applying the"
    echo "# playbook writes back the same .env it already has."
    echo "#"
    echo "# Holds real passwords. Gitignored here, keep your copy somewhere private."
    echo "# Re-run the import to rebuild this file from the server at any time."
    echo ""
    echo "# Deliberately not set here:"
    echo "#   app_user_password   sets the ubuntu login password"
    echo "#   monitoring_password sets the nginx metrics htpasswd entry"
    echo "# Neither is written to .env, so neither can be read back off the"
    echo "# server. Both roles skip the task when the variable is undefined, so"
    echo "# leaving them out keeps the passwords that are already in place."
    echo "# Setting one here rotates it on the next playbook run."
    echo ""
  } >> "$tmp"

  local env_key var_name value
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    env_key="${line%%=*}"
    var_name="${line#*=}"

    # First match only. `grep -E "^KEY="` would also match KEY=... appearing
    # twice, and .env is written once per key so the first is authoritative.
    value="$(printf '%s\n' "$env_body" | grep -E "^${env_key}=" | head -1 | cut -d= -f2-)" || true

    if [ -z "$value" ]; then
      echo "# $var_name: not set in .env on this server, falls back to the role default" >> "$tmp"
      continue
    fi

    if is_unquoted "$var_name"; then
      printf '%s: %s\n' "$var_name" "$value" >> "$tmp"
    else
      # Single-quoted YAML escapes an internal single quote by doubling it.
      # The quote goes through a variable on purpose: writing the pattern as
      # \' inside "${value//\'/\'\'}" makes bash emit a literal backslash, so
      # an apostrophe in a password came out as it\'\'s and broke the YAML.
      printf "%s: '%s'\n" "$var_name" "${value//$SQ/$SQ$SQ}" >> "$tmp"
    fi
  done <<< "$(printf '%s\n' "$MAPPING" | grep -E '=')"

  mv "$tmp" "$out"
  chmod 600 "$out"

  if [ -n "${ANSIBLE_VAULT_PASSWORD_FILE:-}" ]; then
    ansible-vault encrypt "$out" > /dev/null
    log "wrote $out (vault-encrypted)"
  else
    log "wrote $out (plain, ANSIBLE_VAULT_PASSWORD_FILE is not set)"
  fi
}

for host in "$@"; do
  import_one "$host"
done

log ""
log "Done. Confirm ansible agrees, without touching any server:"
log "  ansible-inventory -i ansible/inventory.yml --host <host>"
