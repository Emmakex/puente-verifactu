#!/usr/bin/env bash
set -euo pipefail
name="pv-kairoseth-agent-registry-postgres"
port="${DB_PORT:-55432}"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=root -p "${port}:5432" postgres:16 >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -U postgres >/dev/null
DB_HOST=127.0.0.1 DB_PORT="$port" DB_USER=postgres DB_PASSWORD=root DB_NAME=postgres node scripts/ci/kairoseth-local-agent-postgres-registry-smoke.mjs
