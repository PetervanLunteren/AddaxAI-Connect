#!/bin/bash
# Give Pure-FTPd the current Let's Encrypt certificate.
#
# Pure-FTPd reads one combined file, /etc/ssl/private/pure-ftpd.pem, and only
# at start. Installed by ansible as a certbot deploy hook, so certbot runs it
# after every renewal, from the cron and from its own systemd timer alike.
# Ansible also runs it once with the certificate folder as argument.
#
# Before this hook the file was built once, before the certificate existed,
# so servers kept serving the self-signed fallback from deploy day.

set -euo pipefail

LINEAGE="${1:-${RENEWED_LINEAGE:-}}"
if [ -z "$LINEAGE" ]; then
  echo "usage: $0 /etc/letsencrypt/live/<domain>" >&2
  exit 1
fi

PEM=/etc/ssl/private/pure-ftpd.pem
TMP="$(mktemp /etc/ssl/private/pure-ftpd.pem.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

cat "$LINEAGE/fullchain.pem" "$LINEAGE/privkey.pem" > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$PEM"

systemctl restart pure-ftpd
echo "pure-ftpd now serves the certificate from $LINEAGE"
