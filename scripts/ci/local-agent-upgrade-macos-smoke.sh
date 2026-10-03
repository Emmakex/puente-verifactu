#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="${1:-}"
[[ -d "$BUNDLE_ROOT" ]] || { echo "bundle root required" >&2; exit 2; }

INSTALLER="$BUNDLE_ROOT/packages/local-agent/service/macos/install.sh"
UNINSTALLER="$BUNDLE_ROOT/packages/local-agent/service/macos/uninstall.sh"
FIXTURE="$(mktemp -d)"
TARGET="$FIXTURE/target"
CONFIG="$FIXTURE/agent.json"
ENV_FILE="$FIXTURE/agent.env"
SERVICE_USER="$(id -un)"
STATE_ROOT="/Library/Application Support/Kairoseth/LocalAgent"
DB="$STATE_ROOT/data/agent.sqlite"
SYNTHETIC_COMMIT="2222222222222222222222222222222222222222"

cleanup() {
  sudo bash "$UNINSTALLER" >/dev/null 2>&1 || true
  sudo rm -rf "$STATE_ROOT"
  rm -rf "$FIXTURE"
}
trap cleanup EXIT

cat > "$CONFIG" <<'JSON'
{
  "schemaVersion": 1,
  "installationId": "upgrade-macos",
  "dataDir": "/Library/Application Support/Kairoseth/LocalAgent/data",
  "bridge": {
    "baseUrl": "https://bridge.example",
    "apiKeyEnv": "PV_LOCAL_AGENT_API_KEY"
  },
  "source": {
    "kind": "watch-folder",
    "sourceId": "upgrade-watch",
    "profileId": "upgrade-profile",
    "root": "/Library/Application Support/Kairoseth/LocalAgent/data/files",
    "issueEnabled": false
  }
}
JSON
cat > "$ENV_FILE" <<'ENV'
PV_LOCAL_AGENT_API_KEY=upgrade-smoke
ENV

sudo bash "$INSTALLER" --bundle-dir "$BUNDLE_ROOT" --config-source "$CONFIG" --env-source "$ENV_FILE" --service-user "$SERVICE_USER" >/dev/null
PREVIOUS="$(readlink /Library/Kairoseth/LocalAgent/current)"

sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs create --db "$DB" --key before >/dev/null
sudo chown "$SERVICE_USER" "$DB" "$DB-wal" "$DB-shm" 2>/dev/null || true

mkdir -p "$TARGET"
cp -a "$BUNDLE_ROOT/." "$TARGET/"
node -e "const fs=require('fs');const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,'utf8'));m.sourceCommit=process.argv[2];fs.writeFileSync(p,JSON.stringify(m,null,2)+'\\n')" "$TARGET/bundle-manifest.json" "$SYNTHETIC_COMMIT"

sudo bash "$TARGET/packages/local-agent/service/macos/upgrade.sh" --bundle-dir "$TARGET" >/tmp/pv-macos-upgrade.json
ACTIVE="$(readlink /Library/Kairoseth/LocalAgent/current)"
[[ "$ACTIVE" != "$PREVIOUS" ]]
[[ "$ACTIVE" == *"$SYNTHETIC_COMMIT" ]]

RECEIPT="$STATE_ROOT/data/upgrades/last-upgrade.json"
sudo test -f "$RECEIPT"
BACKUP="$(sudo node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(r.backupPath||'')" "$RECEIPT")"
[[ -n "$BACKUP" ]]
sudo test -f "$BACKUP"

before_backup="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$BACKUP")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$before_backup")" == "1" ]]

sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs create --db "$DB" --key after >/dev/null
current_state="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$DB")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$current_state")" == "2" ]]

sudo bash "$TARGET/packages/local-agent/service/macos/rollback.sh" >/tmp/pv-macos-rollback.json
ROLLED_BACK="$(readlink /Library/Kairoseth/LocalAgent/current)"
[[ "$ROLLED_BACK" == "$PREVIOUS" ]]

after_rollback="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$DB")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$after_rollback")" == "2" ]]
backup_after="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$BACKUP")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$backup_after")" == "1" ]]
sudo grep -q '"databaseRestored": false' "$RECEIPT"

printf '{"status":"ok","check":"local-agent-upgrade-macos","backup_verified":true,"code_rollback":true,"database_rollback":false,"state_after_rollback":2}\n'
