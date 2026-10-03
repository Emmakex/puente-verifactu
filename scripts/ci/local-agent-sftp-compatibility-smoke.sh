#!/usr/bin/env bash
set -euo pipefail

name="pv-local-agent-sftp"
port="${SFTP_PORT:-2222}"
image="${SFTP_IMAGE:-atmoz/sftp:alpine}"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$name" -p "${port}:22" "$image" "pvreader:ReadOnly!2026:1001" >/dev/null

ready=0
for _ in $(seq 1 90); do
  if ssh-keyscan -T 2 -p "$port" 127.0.0.1 >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker logs "$name" >&2 || true
  echo "SFTP server did not become ready" >&2
  exit 1
fi

docker exec "$name" sh -lc "
  mkdir -p /home/pvreader/drop &&
  printf 'invoice,total\\nSFTP-1,10.50\\nSFTP-2,20.75\\n' > /home/pvreader/drop/invoices.csv &&
  chown root:root /home/pvreader/drop /home/pvreader/drop/invoices.csv &&
  chmod 755 /home/pvreader/drop &&
  chmod 644 /home/pvreader/drop/invoices.csv
"

public_key_line="$(docker exec "$name" cat /etc/ssh/ssh_host_ed25519_key.pub)"
public_key="$(printf '%s\n' "$public_key_line" | cut -d' ' -f2)"
host_key_sha256="$(node -e "const {createHash}=require('node:crypto'); process.stdout.write(createHash('sha256').update(Buffer.from(process.argv[1],'base64')).digest('hex'))" "$public_key")"

SFTP_PORT="$port" SFTP_HOST_KEY_SHA256="$host_key_sha256" node scripts/ci/local-agent-sftp-runtime-smoke.mjs
