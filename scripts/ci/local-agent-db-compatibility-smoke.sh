#!/usr/bin/env bash
set -euo pipefail

dialect="${DB_DIALECT:?DB_DIALECT is required}"
name="pv-local-agent-db-${dialect}"
sqlserver_log=""
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [ -n "$sqlserver_log" ]; then rm -f "$sqlserver_log"; fi
}
trap cleanup EXIT

case "$dialect" in
  postgresql)
    image="${DB_IMAGE:-postgres:16}"
    port="${DB_PORT:-5432}"
    docker run -d --name "$name" -e POSTGRES_PASSWORD=root -p "${port}:5432" "$image" >/dev/null
    for _ in $(seq 1 60); do
      if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
      sleep 1
    done
    docker exec "$name" pg_isready -U postgres >/dev/null
    ;;
  mysql)
    image="${DB_IMAGE:-mysql:8.4}"
    port="${DB_PORT:-3306}"
    docker run -d --name "$name" -e MYSQL_ROOT_PASSWORD=root -p "${port}:3306" "$image" >/dev/null
    for _ in $(seq 1 90); do
      if docker exec "$name" mysqladmin ping -h 127.0.0.1 -proot --silent >/dev/null 2>&1; then break; fi
      sleep 1
    done
    docker exec "$name" mysqladmin ping -h 127.0.0.1 -proot --silent >/dev/null
    ;;
  mariadb)
    image="${DB_IMAGE:-mariadb:11.4}"
    port="${DB_PORT:-3306}"
    docker run -d --name "$name" -e MARIADB_ROOT_PASSWORD=root -p "${port}:3306" "$image" >/dev/null
    for _ in $(seq 1 90); do
      if docker exec "$name" mariadb-admin ping -h 127.0.0.1 -proot --silent >/dev/null 2>&1; then break; fi
      sleep 1
    done
    docker exec "$name" mariadb-admin ping -h 127.0.0.1 -proot --silent >/dev/null
    ;;
  sqlserver)
    image="${DB_IMAGE:-mcr.microsoft.com/mssql/server:2022-latest}"
    port="${DB_PORT:-1433}"
    docker run -d --name "$name" \
      -e ACCEPT_EULA=Y \
      -e MSSQL_SA_PASSWORD='Puente!Test2026' \
      -p "${port}:1433" "$image" >/dev/null

    sqlserver_log="$(mktemp)"
    sqlserver_ready=0
    for _ in $(seq 1 120); do
      docker logs "$name" >"$sqlserver_log" 2>&1 || true
      if grep -q "SQL Server is now ready for client connections" "$sqlserver_log"; then
        sqlserver_ready=1
        break
      fi
      sleep 1
    done
    if [ "$sqlserver_ready" -ne 1 ]; then
      cat "$sqlserver_log" >&2
      echo "SQL Server did not become ready within the smoke-test window" >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported DB_DIALECT: $dialect" >&2
    exit 2
    ;;
esac

DB_HOST=127.0.0.1 DB_PORT="$port" node scripts/ci/local-agent-db-runtime-smoke.mjs
