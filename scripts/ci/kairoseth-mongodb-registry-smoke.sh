#!/usr/bin/env bash
set -euo pipefail

name="pv-kairoseth-mongodb"
port="${MONGODB_PORT:-27018}"
image="${MONGODB_IMAGE:-mongo:8.0}"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$name" -p "${port}:27017" "$image" >/dev/null

for _ in $(seq 1 90); do
  if docker exec "$name" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 1
done

docker exec "$name" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' | grep -q 1

MONGODB_URI="mongodb://127.0.0.1:${port}" node scripts/ci/kairoseth-mongodb-registry-smoke.mjs
MONGODB_URI="mongodb://127.0.0.1:${port}" node scripts/ci/kairoseth-import-batches-smoke.mjs
MONGODB_URI="mongodb://127.0.0.1:${port}" node scripts/ci/kairoseth-dataplane-smoke.mjs
MONGODB_URI="mongodb://127.0.0.1:${port}" node scripts/ci/kairoseth-runtime-mongodb-smoke.mjs
