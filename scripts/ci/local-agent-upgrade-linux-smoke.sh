#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="${1:-}"
[[ -d "$BUNDLE_ROOT" ]] || { echo "bundle root required" >&2; exit 2; }

INSTALLER="$BUNDLE_ROOT/packages/local-agent/service/linux/install.sh"
UNINSTALLER="$BUNDLE_ROOT/packages/local-agent/service/linux/uninstall.sh"
FIXTURE="$(mktemp -d)"
TARGET="$FIXTURE/target"
CONFIG="$FIXTURE/agent.json"
ENV_FILE="$FIXTURE/agent.env"
DB="/var/lib/kairoseth-local-agent/agent.sqlite"
SYNTHETIC_COMMIT="1111111111111111111111111111111111111111"

cleanup() {
  sudo bash "$UNINSTALLER" >/dev/null 2>&1 || true
  sudo rm -rf /etc/kairoseth-local-agent /var/lib/kairoseth-local-agent
  sudo userdel kairoseth-agent >/dev/null 2>&1 || true
  rm -rf "$FIXTURE"
}
trap cleanup EXIT

cat > "$CONFIG" <<'JSON'
{
  "schemaVersion": 1,
  "installationId": "upgrade-linux",
  "dataDir": "/var/lib/kairoseth-local-agent",
  "bridge": {
    "baseUrl": "https://bridge.example",
    "apiKeyEnv": "PV_LOCAL_AGENT_API_KEY"
  },
  "source": {
    "kind": "watch-folder",
    "sourceId": "upgrade-watch",
    "profileId": "upgrade-profile",
    "root": "/var/lib/kairoseth-local-agent/files",
    "issueEnabled": false
  }
}
JSON
cat > "$ENV_FILE" <<'ENV'
PV_LOCAL_AGENT_API_KEY=upgrade-smoke
ENV

sudo bash "$INSTALLER" --bundle-dir "$BUNDLE_ROOT" --config-source "$CONFIG" --env-source "$ENV_FILE" >/dev/null
PREVIOUS="$(readlink -f /opt/kairoseth/local-agent/current)"

sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs create --db "$DB" --key before >/dev/null
sudo chown kairoseth-agent:kairoseth-agent "$DB" "$DB-wal" "$DB-shm" 2>/dev/null || true

mkdir -p "$TARGET"
cp -a "$BUNDLE_ROOT/." "$TARGET/"
node -e "const fs=require('fs');const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,'utf8'));m.sourceCommit=process.argv[2];fs.writeFileSync(p,JSON.stringify(m,null,2)+'\\n')" "$TARGET/bundle-manifest.json" "$SYNTHETIC_COMMIT"

sudo bash "$TARGET/packages/local-agent/service/linux/upgrade.sh" --bundle-dir "$TARGET" >/tmp/pv-linux-upgrade.json
ACTIVE="$(readlink -f /opt/kairoseth/local-agent/current)"
[[ "$ACTIVE" != "$PREVIOUS" ]]
[[ "$ACTIVE" == *"$SYNTHETIC_COMMIT" ]]

RECEIPT="/var/lib/kairoseth-local-agent/upgrades/last-upgrade.json"
sudo test -f "$RECEIPT"
BACKUP="$(sudo node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(r.backupPath||'')" "$RECEIPT")"
[[ -n "$BACKUP" ]]
sudo test -f "$BACKUP"

before_backup="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$BACKUP")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$before_backup")" == "1" ]]

sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs create --db "$DB" --key after >/dev/null
current_state="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$DB")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$current_state")" == "2" ]]

sudo bash "$TARGET/packages/local-agent/service/linux/rollback.sh" >/tmp/pv-linux-rollback.json
ROLLED_BACK="$(readlink -f /opt/kairoseth/local-agent/current)"
[[ "$ROLLED_BACK" == "$PREVIOUS" ]]

after_rollback="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$DB")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$after_rollback")" == "2" ]]
backup_after="$(sudo node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db "$BACKUP")"
[[ "$(node -e "console.log(JSON.parse(process.argv[1]).count)" "$backup_after")" == "1" ]]
sudo grep -q '"databaseRestored": false' "$RECEIPT"

printf '{"status":"ok","check":"local-agent-upgrade-linux","backup_verified":true,"code_rollback":true,"database_rollback":false,"state_after_rollback":2}\n'
